/**
 * Preflight check for deploying the fault-synthesis Edge Function.
 *
 * Exit code 0 when every blocking check passes; 1 otherwise. Non-blocking
 * checks (secrets, Supabase-link) emit warnings but do not fail the
 * process — the user may be running this from a dev machine that is not
 * yet authenticated.
 *
 * Usage:
 *   bun scripts/fault-synthesis-preflight.ts
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

type CheckStatus = 'ok' | 'warn' | 'fail';

interface CheckResult {
  label: string;
  status: CheckStatus;
  detail: string;
}

const results: CheckResult[] = [];

function add(label: string, status: CheckStatus, detail: string): void {
  results.push({ label, status, detail });
}

function safeExec(cmd: string): string | null {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

// =============================================================================
// Checks
// =============================================================================

const ROOT = process.cwd();

// 1. Supabase CLI available
const supabaseVersion = safeExec('supabase --version');
if (supabaseVersion) {
  add('Supabase CLI installed', 'ok', `version ${supabaseVersion}`);
} else {
  add(
    'Supabase CLI installed',
    'fail',
    'install via `brew install supabase/tap/supabase` or https://github.com/supabase/cli',
  );
}

// 2. Edge Function file present and non-trivial
const functionPath = resolve(ROOT, 'supabase/functions/fault-synthesis/index.ts');
if (existsSync(functionPath)) {
  const size = statSync(functionPath).size;
  if (size > 1000) {
    add('Edge Function file present', 'ok', `${functionPath.replace(ROOT + '/', '')} (${size} bytes)`);
  } else {
    add('Edge Function file present', 'fail', `file exists but suspiciously small (${size} bytes)`);
  }
} else {
  add('Edge Function file present', 'fail', `missing: ${functionPath.replace(ROOT + '/', '')}`);
}

// 3. _shared prompt mirror is in sync
const canonical = resolve(ROOT, 'lib/services/fault-synthesis-prompt.ts');
const mirror = resolve(ROOT, 'supabase/functions/_shared/fault-synthesis-prompt.ts');
if (existsSync(canonical) && existsSync(mirror)) {
  const a = readFileSync(canonical, 'utf8');
  const b = readFileSync(mirror, 'utf8');
  if (a === b) {
    add('Shared prompt mirror in sync', 'ok', 'lib ↔ _shared byte-identical');
  } else {
    add(
      'Shared prompt mirror in sync',
      'fail',
      `${mirror.replace(ROOT + '/', '')} diverged from ${canonical.replace(ROOT + '/', '')}`,
    );
  }
} else {
  add('Shared prompt mirror in sync', 'fail', 'one or both files missing');
}

// 4. Edge Function exports a POST handler (smoke-check)
if (existsSync(functionPath)) {
  const src = readFileSync(functionPath, 'utf8');
  const hasServe = /serve\(.*async.*req.*Request/.test(src);
  const hasPost = /req\.method\s*[!=]==?\s*'POST'/.test(src) || /method\s*!==\s*'POST'/.test(src);
  if (hasServe && hasPost) {
    add('Handler shape looks right', 'ok', 'serve() + POST guard both present');
  } else if (hasServe) {
    add('Handler shape looks right', 'warn', 'serve() present but no explicit POST guard');
  } else {
    add('Handler shape looks right', 'fail', 'no serve() call detected — did this get refactored?');
  }
}

// 5. Supabase project link status (non-blocking)
const supabaseStatus = safeExec('supabase status 2>&1');
if (supabaseStatus && /API URL/i.test(supabaseStatus)) {
  add('Supabase project linked', 'ok', 'local stack reachable');
} else if (supabaseStatus && /not.*started|not.*running/i.test(supabaseStatus)) {
  add(
    'Supabase project linked',
    'warn',
    'local stack not running (OK if deploying directly to a remote project)',
  );
} else {
  add(
    'Supabase project linked',
    'warn',
    'run `supabase link --project-ref <ref>` before `supabase functions deploy`',
  );
}

// 6. GEMINI_API_KEY presence (non-blocking — user may provide at deploy time)
if (process.env.GEMINI_API_KEY) {
  add('GEMINI_API_KEY available', 'ok', 'set in current shell env');
} else {
  add(
    'GEMINI_API_KEY available',
    'warn',
    'grab one at https://aistudio.google.com/apikey — pass it via `supabase secrets set` before the first invoke',
  );
}

// 7. EXPO_PUBLIC_FAULT_SYNTHESIS_FUNCTION (non-blocking — defaults to 'fault-synthesis')
if (process.env.EXPO_PUBLIC_FAULT_SYNTHESIS_FUNCTION) {
  add(
    'EXPO_PUBLIC_FAULT_SYNTHESIS_FUNCTION override',
    'ok',
    `"${process.env.EXPO_PUBLIC_FAULT_SYNTHESIS_FUNCTION}"`,
  );
} else {
  add(
    'EXPO_PUBLIC_FAULT_SYNTHESIS_FUNCTION override',
    'ok',
    'not set — client will call function named `fault-synthesis` by default',
  );
}

// =============================================================================
// Output
// =============================================================================

const ICON: Record<CheckStatus, string> = { ok: '✓', warn: '•', fail: '✗' };

console.log('\nFault-synthesis deploy preflight\n');
for (const r of results) {
  console.log(`  ${ICON[r.status]} ${r.label}`);
  console.log(`      ${r.detail}`);
}

const failed = results.filter((r) => r.status === 'fail');
const warned = results.filter((r) => r.status === 'warn');

console.log('\nDeploy commands when ready:');
console.log('  supabase functions deploy fault-synthesis');
console.log('  supabase secrets set GEMINI_API_KEY=<your-key>');
console.log(
  '  # optional model override: supabase secrets set FAULT_SYNTHESIS_MODEL=gemma-3-12b-it\n',
);

if (failed.length > 0) {
  console.error(`Preflight FAILED: ${failed.length} blocking issue${failed.length === 1 ? '' : 's'}.`);
  process.exit(1);
}
if (warned.length > 0) {
  console.log(
    `Preflight passed with ${warned.length} warning${warned.length === 1 ? '' : 's'} — review above before pushing the deploy button.`,
  );
} else {
  console.log('Preflight passed clean — good to deploy.');
}
process.exit(0);
