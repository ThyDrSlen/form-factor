import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';
import { stringify } from 'yaml';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const limitArg = process.argv.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 50;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function exportConversations() {
  const { data, error } = await supabase
    .from('coach_conversations')
    .select('user_message, assistant_message, context, turn_index, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Failed to fetch conversations:', error.message);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.log('No conversations found.');
    process.exit(0);
  }

  const scenarios = data.map((row, i) => {
    const focus = row.context?.focus ?? 'fitness_coach';
    const truncatedMsg = row.user_message.length > 60
      ? row.user_message.slice(0, 57) + '...'
      : row.user_message;

    return {
      description: `[real-conversation] Turn ${row.turn_index} - ${truncatedMsg}`,
      vars: {
        user_name: 'Anonymous',
        focus,
        message: row.user_message,
      },
      assert: [
        {
          type: 'similar',
          value: row.assistant_message,
          threshold: 0.6,
        },
      ],
    };
  });

  const outputPath = 'evals/scenarios/coach-real-conversations.yaml';
  writeFileSync(outputPath, stringify(scenarios), 'utf-8');
  console.log(`Exported ${scenarios.length} conversations to ${outputPath}`);
}

exportConversations();
