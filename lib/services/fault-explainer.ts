/**
 * Fault explainer — synthesizes a single root-cause explanation when
 * multiple correlated form faults fire on the same rep.
 *
 * This is the integration surface for an on-device LLM (Gemma via Cactus,
 * MediaPipe, Apple Foundation Models, or a cloud Edge Function) without
 * committing to a specific runtime. Callers talk to the `FaultExplainer`
 * interface; a deterministic static fallback ships today so consumers can
 * be built and tested before any model lands.
 *
 * The static fallback uses the `relatedFaults` graph from the offline
 * glossary to pick a likely root-cause fault and emit a templated summary.
 * It is deliberately low-confidence so the UI can choose to show per-fault
 * chips instead when a real model is not yet loaded.
 */

import {
  getGlossaryEntriesByFaultId,
  getGlossaryEntry,
  type FaultGlossaryEntry,
} from './fault-glossary-store';

// =============================================================================
// Types
// =============================================================================

export interface FaultSynthesisSetContext {
  /** 1-based rep index within the current set. */
  repNumber?: number;
  /** 1-based set index within the current session. */
  setNumber?: number;
  /** Self-reported or inferred RPE (1–10). */
  rpe?: number;
}

export interface FaultFrequencyHint {
  faultId: string;
  /** Number of sessions this fault appeared in within the recent window. */
  occurrencesInLastNSessions: number;
  /** Sessions since the fault was last observed (0 = current session). */
  sessionsSince: number;
}

export interface FaultSynthesisInput {
  exerciseId: string;
  /** Fault ids detected for the same rep/set. Order does not matter. */
  faultIds: string[];
  setContext?: FaultSynthesisSetContext;
  /** Recent-history summary for the same exercise. */
  recentHistory?: FaultFrequencyHint[];
}

/**
 * Glossary snippet shape the Edge Function receives. Callers that hit the
 * network runner enrich their payload with these so the server can stay
 * stateless and never drift from the client's glossary version.
 */
export interface FaultGlossaryEntrySnippet {
  faultId: string;
  displayName: string;
  shortExplanation: string;
  whyItMatters: string;
  fixTips: string[];
  relatedFaults: string[];
}

export type FaultSynthesisSource =
  | 'static-fallback'
  | 'gemma-local'
  | 'gemma-cloud'
  | 'edge-function';

export interface FaultSynthesisOutput {
  /** One-sentence user-facing synthesis (< 80 tokens). */
  synthesizedExplanation: string;
  /** Which input fault the runner believes is the primary driver. */
  primaryFaultId: string | null;
  /** Short root-cause hypothesis (e.g. "hip mobility"), null when unknown. */
  rootCauseHypothesis: string | null;
  /** Confidence 0..1. Static fallback caps at 0.4. */
  confidence: number;
  source: FaultSynthesisSource;
}

export interface FaultExplainer {
  synthesize(input: FaultSynthesisInput): Promise<FaultSynthesisOutput>;
}

// =============================================================================
// Static fallback runner
// =============================================================================

const FALLBACK_CONFIDENCE_MULTI = 0.35;
const FALLBACK_CONFIDENCE_SINGLE = 0.4;
const FALLBACK_CONFIDENCE_UNKNOWN = 0.2;

function scorePrimary(
  input: FaultSynthesisInput,
  entries: Map<string, FaultGlossaryEntry>,
): string | null {
  if (input.faultIds.length === 0) return null;
  if (input.faultIds.length === 1) return input.faultIds[0] ?? null;

  const inputSet = new Set(input.faultIds);
  let bestId: string | null = null;
  let bestScore = -1;

  for (const faultId of input.faultIds) {
    const entry = entries.get(faultId);
    if (!entry) continue;
    const overlap = entry.relatedFaults.filter((r) => inputSet.has(r)).length;
    const historyBoost =
      input.recentHistory?.find((h) => h.faultId === faultId)?.occurrencesInLastNSessions ?? 0;
    const score = overlap * 10 + Math.min(historyBoost, 5);
    if (score > bestScore) {
      bestScore = score;
      bestId = faultId;
    }
  }

  return bestId ?? input.faultIds[0] ?? null;
}

function resolveEntries(
  input: FaultSynthesisInput,
): Map<string, FaultGlossaryEntry> {
  const map = new Map<string, FaultGlossaryEntry>();
  for (const faultId of input.faultIds) {
    const scoped = getGlossaryEntry(input.exerciseId, faultId);
    if (scoped) {
      map.set(faultId, scoped);
      continue;
    }
    const anyEntry = getGlossaryEntriesByFaultId(faultId)[0];
    if (anyEntry) map.set(faultId, anyEntry);
  }
  return map;
}

function joinDisplayNames(entries: FaultGlossaryEntry[]): string {
  const names = entries.map((e) => e.displayName.toLowerCase());
  if (names.length === 0) return '';
  if (names.length === 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

function normalizeRecommendation(tip: string): string {
  const trimmed = tip.trim();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export const staticFallbackExplainer: FaultExplainer = {
  async synthesize(input: FaultSynthesisInput): Promise<FaultSynthesisOutput> {
    if (input.faultIds.length === 0) {
      return {
        synthesizedExplanation: '',
        primaryFaultId: null,
        rootCauseHypothesis: null,
        confidence: 0,
        source: 'static-fallback',
      };
    }

    const entries = resolveEntries(input);
    const primaryId = scorePrimary(input, entries);
    const primaryEntry = primaryId ? entries.get(primaryId) ?? null : null;

    if (!primaryEntry) {
      return {
        synthesizedExplanation: `Several form faults fired together — review the chips below for details.`,
        primaryFaultId: primaryId,
        rootCauseHypothesis: null,
        confidence: FALLBACK_CONFIDENCE_UNKNOWN,
        source: 'static-fallback',
      };
    }

    if (input.faultIds.length === 1) {
      return {
        synthesizedExplanation: primaryEntry.shortExplanation,
        primaryFaultId: primaryId,
        rootCauseHypothesis: null,
        confidence: FALLBACK_CONFIDENCE_SINGLE,
        source: 'static-fallback',
      };
    }

    const contributingEntries = input.faultIds
      .map((id) => entries.get(id))
      .filter((e): e is FaultGlossaryEntry => !!e);
    const faultsPhrase = joinDisplayNames(contributingEntries);
    const recommendation = normalizeRecommendation(
      primaryEntry.fixTips[0] ?? primaryEntry.shortExplanation,
    );

    const lead = `${faultsPhrase.charAt(0).toUpperCase()}${faultsPhrase.slice(1)}`;
    const summary = recommendation
      ? `${lead} often cluster together. ${recommendation}`
      : `${lead} often cluster together.`;

    return {
      synthesizedExplanation: summary,
      primaryFaultId: primaryId,
      rootCauseHypothesis: null,
      confidence: FALLBACK_CONFIDENCE_MULTI,
      source: 'static-fallback',
    };
  },
};

// =============================================================================
// Pluggable singleton — swap in a real runner at app init
// =============================================================================

let activeRunner: FaultExplainer = staticFallbackExplainer;

export function getFaultExplainer(): FaultExplainer {
  return activeRunner;
}

/**
 * Install a real runner (e.g. Gemma via Cactus) once it has loaded. Falls
 * back to the static explainer if `runner` is null. Safe to call multiple
 * times — last write wins.
 */
export function setFaultExplainerRunner(runner: FaultExplainer | null): void {
  activeRunner = runner ?? staticFallbackExplainer;
}

/** Reset hook for tests. */
export function __resetFaultExplainerForTests(): void {
  activeRunner = staticFallbackExplainer;
}
