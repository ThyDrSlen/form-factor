/**
 * Post-deploy smoke test for the fault-synthesis Edge Function.
 *
 * Sends a canonical payload against `${SUPABASE_URL}/functions/v1/fault-synthesis`
 * and verifies the response end-to-end: status, schema, fault-id
 * constraint, confidence range, non-empty text, and latency.
 *
 * Env:
 *   SUPABASE_URL              required
 *   SUPABASE_ANON_KEY         required (the apikey header)
 *   SUPABASE_ACCESS_TOKEN     optional — a real user JWT. Without it the
 *                             function returns 401 by design, which the
 *                             script reports as a "reachable but unauth"
 *                             soft pass (exit 0 with warning).
 *   FAULT_SYNTHESIS_FN_NAME   optional, defaults to "fault-synthesis"
 *
 * Usage:
 *   SUPABASE_URL=https://… SUPABASE_ANON_KEY=… bun scripts/fault-synthesis-smoke.ts
 */

import { getGlossaryEntry } from '@/lib/services/fault-glossary-store';
import type { FaultGlossarySnippet } from '@/lib/services/fault-synthesis-prompt';

const CANONICAL_EXERCISE = 'squat';
const CANONICAL_FAULT_IDS = ['shallow_depth', 'forward_lean', 'hip_shift'];
const TIMEOUT_MS = 10_000;

interface EdgeResponse {
  synthesizedExplanation?: string;
  primaryFaultId?: string | null;
  rootCauseHypothesis?: string | null;
  confidence?: number;
  error?: string;
}

function fatal(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function buildSnippets(): FaultGlossarySnippet[] {
  const snippets: FaultGlossarySnippet[] = [];
  for (const faultId of CANONICAL_FAULT_IDS) {
    const entry = getGlossaryEntry(CANONICAL_EXERCISE, faultId);
    if (!entry) continue;
    snippets.push({
      faultId: entry.faultId,
      displayName: entry.displayName,
      shortExplanation: entry.shortExplanation,
      whyItMatters: entry.whyItMatters,
      fixTips: entry.fixTips,
      relatedFaults: entry.relatedFaults,
    });
  }
  return snippets;
}

function validateResponse(data: EdgeResponse, allowed: Set<string>): string[] {
  const issues: string[] = [];
  if (typeof data.synthesizedExplanation !== 'string' || !data.synthesizedExplanation.trim()) {
    issues.push('synthesizedExplanation missing or empty');
  }
  if (data.primaryFaultId !== null && typeof data.primaryFaultId !== 'string') {
    issues.push('primaryFaultId must be string or null');
  }
  if (typeof data.primaryFaultId === 'string' && !allowed.has(data.primaryFaultId)) {
    issues.push(`primaryFaultId "${data.primaryFaultId}" is not in the submitted fault ids`);
  }
  if (data.rootCauseHypothesis !== null && data.rootCauseHypothesis !== undefined && typeof data.rootCauseHypothesis !== 'string') {
    issues.push('rootCauseHypothesis must be string or null');
  }
  if (typeof data.confidence !== 'number' || Number.isNaN(data.confidence)) {
    issues.push('confidence must be a finite number');
  } else if (data.confidence < 0 || data.confidence > 1) {
    issues.push(`confidence ${data.confidence} is outside [0, 1]`);
  }
  return issues;
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  const fnName = process.env.FAULT_SYNTHESIS_FN_NAME || 'fault-synthesis';

  if (!supabaseUrl) fatal('SUPABASE_URL is required (e.g. https://<project>.supabase.co)');
  if (!anonKey) fatal('SUPABASE_ANON_KEY is required');

  const endpoint = `${supabaseUrl}/functions/v1/${fnName}`;
  const body = {
    exerciseId: CANONICAL_EXERCISE,
    faultIds: CANONICAL_FAULT_IDS,
    glossaryEntries: buildSnippets(),
  };

  console.log(`\nFault-synthesis smoke test\n`);
  console.log(`  Endpoint:   POST ${endpoint}`);
  console.log(`  Auth:       ${accessToken ? 'user JWT (SUPABASE_ACCESS_TOKEN)' : 'anon (no access token — expect 401 by design)'}`);
  console.log(`  Payload:    ${CANONICAL_FAULT_IDS.length} faults, ${body.glossaryEntries.length} glossary snippets`);
  console.log('');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${accessToken ?? anonKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err instanceof DOMException && err.name === 'AbortError';
    fatal(isTimeout ? `request timed out after ${TIMEOUT_MS}ms` : `fetch failed: ${String(err)}`);
  }
  clearTimeout(timeoutId);
  const elapsedMs = Date.now() - startedAt;

  console.log(`  Status:     ${response.status} ${response.statusText}`);
  console.log(`  Latency:    ${elapsedMs}ms`);

  const rawText = await response.text();
  let data: EdgeResponse = {};
  try {
    data = JSON.parse(rawText) as EdgeResponse;
  } catch {
    console.log(`  Raw body:   ${rawText.slice(0, 200)}`);
    fatal('response body was not valid JSON');
  }

  if (response.status === 401) {
    if (!accessToken) {
      console.log('\n• Function reachable but 401 Unauthorized — expected with no SUPABASE_ACCESS_TOKEN.');
      console.log('  Provide a user JWT to run the full end-to-end check.');
      process.exit(0);
    }
    fatal('401 with a supplied access token — is the token expired or from a different project?');
  }

  if (response.status === 500 && data.error?.includes('GEMINI_API_KEY')) {
    fatal('server config error: GEMINI_API_KEY is not set — `supabase secrets set GEMINI_API_KEY=…`');
  }

  if (response.status === 502) {
    fatal(`upstream (Gemini) unavailable or returned invalid shape. server said: ${data.error ?? 'no detail'}`);
  }

  if (response.status === 429) {
    console.log('\n• 429 rate-limited — function is live, but this user hit 30 req/min.');
    process.exit(0);
  }

  if (response.status !== 200) {
    fatal(`unexpected status ${response.status}. body: ${rawText.slice(0, 200)}`);
  }

  const issues = validateResponse(data, new Set(CANONICAL_FAULT_IDS));
  if (issues.length > 0) {
    console.error('\n✗ Response shape issues:');
    for (const issue of issues) console.error(`    - ${issue}`);
    process.exit(1);
  }

  console.log('\n  Response:');
  console.log(`    primaryFaultId:      ${data.primaryFaultId ?? '(null)'}`);
  console.log(`    rootCauseHypothesis: ${data.rootCauseHypothesis ?? '(null)'}`);
  console.log(`    confidence:          ${data.confidence}`);
  console.log(`    explanation:         "${data.synthesizedExplanation}"`);
  console.log('\n✓ Smoke test passed — function is live and returning valid Gemma output.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
