// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno';

interface PushRequest {
  userIds?: string[];
  tokens?: string[];
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
}

type ExpoPushMessage = {
  to: string;
  sound?: 'default';
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const MAX_BATCH = 90;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const NOTIFY_SECRET = Deno.env.get('NOTIFY_SECRET');

const supabase: SupabaseClient | null =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-notify-secret',
    },
  });
}

async function getTokensFromUserIds(userIds: string[] = []) {
  if (!supabase) return [];
  if (!userIds.length) return [];

  const { data, error } = await supabase
    .from('notification_tokens')
    .select('token')
    .in('user_id', userIds);

  if (error) {
    console.error('[notify] Failed to fetch tokens', error);
    return [];
  }

  return data?.map((row: { token: string }) => row.token).filter(Boolean) ?? [];
}

function chunk<T>(arr: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function sendExpoMessages(messages: ExpoPushMessage[]) {
  const invalidTokens = new Set<string>();
  let sent = 0;

  for (const batch of chunk(messages, MAX_BATCH)) {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[notify] Expo push failed', response.status, errorText);
      continue;
    }

    const result = (await response.json()) as any;
    const receipts: any[] = Array.isArray(result?.data) ? result.data : [];

    receipts.forEach((receipt, idx) => {
      const token = batch[idx]?.to;
      if (!token) return;

      if (receipt?.status === 'ok') {
        sent += 1;
        return;
      }

      console.error('[notify] Push error', { token, receipt });

      const detailError = receipt?.details?.error;
      if (detailError === 'DeviceNotRegistered' || detailError === 'InvalidCredentials') {
        invalidTokens.add(token);
      }
    });
  }

  if (invalidTokens.size && supabase) {
    const tokens = Array.from(invalidTokens);
    const { error: deleteError } = await supabase
      .from('notification_tokens')
      .delete()
      .in('token', tokens);

    if (deleteError) {
      console.error('[notify] Failed to prune invalid tokens', deleteError);
    }
  }

  return { sent, invalid: invalidTokens.size };
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return jsonResponse({ ok: true });
  }

  if (!supabase) {
    return jsonResponse({ error: 'Missing server configuration' }, 500);
  }

  if (NOTIFY_SECRET) {
    const providedSecret = req.headers.get('x-notify-secret');
    if (providedSecret !== NOTIFY_SECRET) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
  }

  try {
    const payload = (await req.json()) as PushRequest;
    const title = payload.title?.trim();
    const body = payload.body?.trim();

    if (!title || !body) {
      return jsonResponse({ error: 'title and body are required' }, 400);
    }

    const tokenList: string[] = [];
    if (Array.isArray(payload.tokens)) {
      tokenList.push(...payload.tokens.filter((t) => typeof t === 'string' && t.length > 0));
    }

    if (Array.isArray(payload.userIds) && payload.userIds.length > 0) {
      const fetched = await getTokensFromUserIds(payload.userIds);
      tokenList.push(...fetched);
    }

    const uniqueTokens = Array.from(new Set(tokenList));
    if (uniqueTokens.length === 0) {
      return jsonResponse({ delivered: 0, message: 'No tokens to send' });
    }

    const messages: ExpoPushMessage[] = uniqueTokens.map((token) => ({
      to: token,
      sound: 'default',
      title: title.slice(0, 64),
      body: body.slice(0, 180),
      data: payload.data ?? {},
    }));

    const result = await sendExpoMessages(messages);

    return jsonResponse({
      delivered: result.sent,
      invalidTokens: result.invalid,
      attempted: uniqueTokens.length,
    });
  } catch (err) {
    console.error('[notify] request failed', err);
    return jsonResponse({ error: 'Invalid request' }, 400);
  }
});
