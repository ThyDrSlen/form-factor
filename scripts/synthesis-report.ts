/**
 * Generate a markdown report of the fault-synthesis static-fallback output
 * across every plausible co-occurrence cluster in the fault glossary.
 *
 * Why: before committing to shipping the synthesis chip to real users, the
 * team needs to read a representative sample of what the synthesizer would
 * actually say. This script produces that sample deterministically, so
 * `git diff` on the output file is a regression baseline for the static
 * algorithm.
 *
 * Run (static only — no API key needed):
 *   bun scripts/synthesis-report.ts
 *   bun scripts/synthesis-report.ts --out docs/evals/fault-synthesis-report.md
 *
 * Run (side-by-side Gemma comparison — requires GEMINI_API_KEY in env):
 *   GEMINI_API_KEY=... bun scripts/synthesis-report.ts --gemma
 *   GEMINI_API_KEY=... bun scripts/synthesis-report.ts --gemma --model gemma-3-12b-it
 *
 * Cost: 0 for static-only; Gemini API token cost when --gemma is passed.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import rawGlossary from '@/lib/data/fault-glossary.json';
import { staticFallbackExplainer } from '@/lib/services/fault-explainer';
import type { FaultGlossaryEntry } from '@/lib/services/fault-glossary-store';
import { getGlossaryEntry } from '@/lib/services/fault-glossary-store';
import {
  SYSTEM_INSTRUCTION,
  buildFaultSynthesisUserPrompt,
  type FaultGlossarySnippet,
} from '@/lib/services/fault-synthesis-prompt';

interface Glossary {
  schemaVersion: number;
  source: string;
  generatedAt: string;
  entries: FaultGlossaryEntry[];
}

const DEFAULT_OUT = 'docs/evals/fault-synthesis-report.md';
const DEFAULT_MODEL = 'gemma-3-4b-it';
const GEMMA_CALL_DELAY_MS = 500;
const GEMMA_TIMEOUT_MS = 8_000;
const MAX_OUTPUT_TOKENS = 240;
const TEMPERATURE = 0.4;

function parseArgs(argv: string[]): { out: string; gemma: boolean; model: string } {
  let out = DEFAULT_OUT;
  let gemma = false;
  let model = DEFAULT_MODEL;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out' && typeof argv[i + 1] === 'string') {
      out = argv[i + 1]!;
      i += 1;
    } else if (argv[i] === '--gemma') {
      gemma = true;
    } else if (argv[i] === '--model' && typeof argv[i + 1] === 'string') {
      model = argv[i + 1]!;
      i += 1;
    }
  }
  return { out, gemma, model };
}

// =============================================================================
// Gemma integration
// SYSTEM_INSTRUCTION + buildFaultSynthesisUserPrompt come from
// lib/services/fault-synthesis-prompt.ts — the single source of truth the
// Edge Function also tracks (keep-in-sync enforced by the snapshot test at
// tests/unit/services/fault-synthesis-prompt.test.ts).
// =============================================================================

type GlossarySnippet = FaultGlossarySnippet;

interface SynthesisResult {
  synthesizedExplanation: string;
  primaryFaultId: string | null;
  rootCauseHypothesis: string | null;
  confidence: number;
}

interface GeminiContent {
  parts?: { text?: string }[];
  role?: string;
}

interface GeminiResponse {
  candidates?: { content?: GeminiContent; finishReason?: string }[];
  error?: { message?: string };
}

function parseModelJson(raw: string): Partial<SynthesisResult> | null {
  let text = raw.trim();
  // Strip markdown fences if the model ignores the JSON mime type hint.
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      synthesizedExplanation:
        typeof parsed.synthesizedExplanation === 'string'
          ? parsed.synthesizedExplanation
          : undefined,
      primaryFaultId:
        typeof parsed.primaryFaultId === 'string'
          ? parsed.primaryFaultId
          : parsed.primaryFaultId === null
            ? null
            : undefined,
      rootCauseHypothesis:
        typeof parsed.rootCauseHypothesis === 'string'
          ? parsed.rootCauseHypothesis
          : parsed.rootCauseHypothesis === null
            ? null
            : undefined,
      confidence:
        typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
          ? parsed.confidence
          : undefined,
    };
  } catch {
    return null;
  }
}

async function callGemmaApi(
  exerciseId: string,
  faultIds: string[],
  snippets: GlossarySnippet[],
  apiKey: string,
  modelId: string,
): Promise<string> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    modelId,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const prompt = buildFaultSynthesisUserPrompt({ exerciseId, faultIds, snippets });

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      responseMimeType: 'application/json',
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMMA_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err instanceof DOMException && err.name === 'AbortError';
    const msg = isTimeout ? 'request timed out' : String(err);
    return `(gemma error: ${msg})`;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return `(gemma error: HTTP ${response.status} — ${text.slice(0, 120)})`;
  }

  let parsed: GeminiResponse;
  try {
    parsed = (await response.json()) as GeminiResponse;
  } catch {
    return '(gemma error: invalid upstream JSON)';
  }

  if (parsed.error) {
    return `(gemma error: ${parsed.error.message ?? 'unknown model error'})`;
  }

  const rawText = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    return '(gemma error: empty response)';
  }

  const result = parseModelJson(rawText);
  if (!result?.synthesizedExplanation) {
    return `(gemma error: unparseable response — ${rawText.slice(0, 120)})`;
  }

  return result.synthesizedExplanation.trim();
}

function buildGlossarySnippets(exerciseId: string, faultIds: string[]): GlossarySnippet[] {
  const snippets: GlossarySnippet[] = [];
  for (const faultId of faultIds) {
    const entry = getGlossaryEntry(exerciseId, faultId);
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Cluster types
// =============================================================================

interface Cluster {
  exerciseId: string;
  faultIds: string[];
}

function clusterKey(cluster: Cluster): string {
  return `${cluster.exerciseId}::${[...cluster.faultIds].sort().join('|')}`;
}

function enumerateClusters(glossary: Glossary): Cluster[] {
  const byExercise = new Map<string, Map<string, FaultGlossaryEntry>>();
  for (const entry of glossary.entries) {
    const bucket = byExercise.get(entry.exerciseId) ?? new Map<string, FaultGlossaryEntry>();
    bucket.set(entry.faultId, entry);
    byExercise.set(entry.exerciseId, bucket);
  }

  const seen = new Set<string>();
  const out: Cluster[] = [];

  for (const [exerciseId, bucket] of byExercise) {
    for (const entry of bucket.values()) {
      // Full cluster: primary + up to 3 related (if present in this exercise)
      const related = entry.relatedFaults.filter((id) => bucket.has(id)).slice(0, 3);
      if (related.length >= 1) {
        const cluster: Cluster = {
          exerciseId,
          faultIds: [entry.faultId, ...related],
        };
        const k = clusterKey(cluster);
        if (!seen.has(k)) {
          seen.add(k);
          out.push(cluster);
        }
      }

      // Pairwise combinations so small clusters are covered too
      for (const relatedId of entry.relatedFaults) {
        if (!bucket.has(relatedId)) continue;
        const cluster: Cluster = {
          exerciseId,
          faultIds: [entry.faultId, relatedId],
        };
        const k = clusterKey(cluster);
        if (!seen.has(k)) {
          seen.add(k);
          out.push(cluster);
        }
      }
    }
  }

  return out;
}

interface GemmaOptions {
  enabled: boolean;
  apiKey: string;
  modelId: string;
}

async function generateReport(glossary: Glossary, gemmaOpts: GemmaOptions): Promise<string> {
  const clusters = enumerateClusters(glossary);

  const byExercise = new Map<string, Cluster[]>();
  for (const c of clusters) {
    const bucket = byExercise.get(c.exerciseId) ?? [];
    bucket.push(c);
    byExercise.set(c.exerciseId, bucket);
  }

  const lines: string[] = [];

  if (gemmaOpts.enabled) {
    lines.push('# Fault Synthesis Report — static vs Gemma');
    lines.push('');
    lines.push(
      'Side-by-side comparison of `staticFallbackExplainer` and the Gemma model across every plausible co-occurrence cluster derived from the glossary\'s `relatedFaults` graph.',
    );
  } else {
    lines.push('# Fault Synthesis Report — static fallback');
    lines.push('');
    lines.push(
      'Deterministic output of `staticFallbackExplainer` across every plausible co-occurrence cluster derived from the glossary\'s `relatedFaults` graph.',
    );
  }
  lines.push('');
  lines.push(
    'Regenerate with `bun scripts/synthesis-report.ts`. Do not hand-edit. When the Edge Function is live, a Gemma column will land next to each static synthesis for side-by-side review.',
  );
  lines.push('');
  lines.push(`- Glossary source: **${glossary.source}** (schema v${glossary.schemaVersion}, generated ${glossary.generatedAt})`);
  lines.push(`- Entries: **${glossary.entries.length}**`);
  lines.push(`- Clusters evaluated: **${clusters.length}**`);
  if (gemmaOpts.enabled) {
    lines.push(`- Gemma model: **${gemmaOpts.modelId}**`);
  }
  lines.push('');

  for (const [exerciseId, bucket] of [...byExercise.entries()].sort()) {
    lines.push(`## ${exerciseId}`);
    lines.push('');
    const sorted = [...bucket].sort((a, b) => {
      if (a.faultIds.length !== b.faultIds.length) return a.faultIds.length - b.faultIds.length;
      return clusterKey(a).localeCompare(clusterKey(b));
    });
    let idx = 1;
    for (const cluster of sorted) {
      const output = await staticFallbackExplainer.synthesize(cluster);
      lines.push(`### ${idx}. \`${cluster.faultIds.join(' + ')}\``);
      lines.push('');

      if (gemmaOpts.enabled) {
        // Two-column: static blockquote then Gemma blockquote
        lines.push(`> **Static:** ${output.synthesizedExplanation}`);
        lines.push('');
        process.stdout.write(
          `  [${idx}/${clusters.length}] calling Gemma for ${cluster.exerciseId} ${cluster.faultIds.join('+')} …`,
        );
        const snippets = buildGlossarySnippets(cluster.exerciseId, cluster.faultIds);
        const gemmaExplanation = await callGemmaApi(
          cluster.exerciseId,
          cluster.faultIds,
          snippets,
          gemmaOpts.apiKey,
          gemmaOpts.modelId,
        );
        process.stdout.write(' done\n');
        lines.push(`> **Gemma:** ${gemmaExplanation}`);
        lines.push('');
        await delay(GEMMA_CALL_DELAY_MS);
      } else {
        lines.push(`> ${output.synthesizedExplanation}`);
        lines.push('');
      }

      lines.push(`- **Primary fault:** \`${output.primaryFaultId ?? '—'}\``);
      lines.push(
        `- **Root-cause hint:** ${output.rootCauseHypothesis ? `\`${output.rootCauseHypothesis}\`` : '—'}`,
      );
      lines.push(`- **Confidence:** ${(output.confidence * 100).toFixed(0)}%`);
      lines.push('');
      idx += 1;
    }
  }

  if (gemmaOpts.enabled) {
    lines.push('---');
    lines.push('');
    lines.push(
      `_Generated ${new Date().toISOString().slice(0, 10)} · model: ${gemmaOpts.modelId}_`,
    );
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  const { out, gemma, model } = parseArgs(process.argv.slice(2));
  const glossary = rawGlossary as unknown as Glossary;

  let gemmaOpts: GemmaOptions;
  if (gemma) {
    const apiKey = process.env['GEMINI_API_KEY'];
    if (!apiKey) {
      console.error(
        'Error: --gemma requires the GEMINI_API_KEY environment variable to be set.\n' +
          '  Example: GEMINI_API_KEY=<your-key> bun scripts/synthesis-report.ts --gemma',
      );
      process.exit(1);
    }
    gemmaOpts = { enabled: true, apiKey, modelId: model };
    console.log(`Running side-by-side comparison with model: ${model}`);
  } else {
    gemmaOpts = { enabled: false, apiKey: '', modelId: model };
  }

  const report = await generateReport(glossary, gemmaOpts);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, report);
  console.log(`Wrote ${out}`);
  console.log(`  Glossary entries: ${glossary.entries.length}`);
  console.log(`  Clusters evaluated: ${enumerateClusters(glossary).length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
