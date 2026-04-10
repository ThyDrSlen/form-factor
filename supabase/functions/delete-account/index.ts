import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno';

interface DeleteAccountRequestBody {
  confirm_delete?: boolean;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  let requestBody: DeleteAccountRequestBody;
  try {
    requestBody = await req.json() as DeleteAccountRequestBody;
  } catch (error) {
    console.error('[delete-account] Invalid JSON body:', error);
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 });
  }

  if (requestBody.confirm_delete !== true) {
    return new Response(
      JSON.stringify({ error: 'Request body must include { confirm_delete: true }' }),
      { status: 400 },
    );
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), { status: 401 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    const missing = [
      !supabaseUrl && 'SUPABASE_URL',
      !supabaseAnonKey && 'SUPABASE_ANON_KEY',
      !supabaseServiceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY',
    ].filter(Boolean).join(', ');
    console.error(`[delete-account] Missing required env vars: ${missing}`);
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500 },
    );
  }

  // Create a client with the user's JWT to verify identity
  const userClient = createClient(
    supabaseUrl,
    supabaseAnonKey,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  // Use service role to delete the auth user (cascades to all user data)
  const adminClient = createClient(
    supabaseUrl,
    supabaseServiceRoleKey,
  );

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error('[delete-account] Failed to delete user:', deleteError);
    return new Response(JSON.stringify({ error: 'Failed to delete account' }), { status: 500 });
  }

  console.log(
    `[delete-account] Deletion event ${JSON.stringify({
      timestamp: new Date().toISOString(),
      user_id: user.id,
    })}`,
  );
  return new Response(JSON.stringify({ success: true }), { status: 200 });
});
