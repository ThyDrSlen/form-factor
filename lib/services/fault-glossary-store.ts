/**
 * Offline fault glossary store — reads the hand-authored seed JSON and
 * exposes lookups by (exerciseId, faultId). Schema matches a future
 * Gemma-regenerated version so we can swap in a model-generated glossary
 * without changing consumers.
 *
 * No DB, no network, no AsyncStorage — just a memoized index over the
 * bundled JSON. Safe to call from any render path.
 */

import rawGlossary from '@/lib/data/fault-glossary.json';

// =============================================================================
// Types
// =============================================================================

export interface FaultGlossaryEntry {
  exerciseId: string;
  faultId: string;
  displayName: string;
  /** One-sentence summary for chips and short surfaces. */
  shortExplanation: string;
  /** Paragraph-form explanation for detail views. */
  fullExplanation: string;
  /** Why the user should care about this fault. */
  whyItMatters: string;
  /** 2-3 tips the user can act on. */
  fixTips: string[];
  /** Other fault ids that frequently co-occur. */
  relatedFaults: string[];
}

export interface FaultGlossary {
  schemaVersion: number;
  source: 'hand-authored' | 'gemma' | string;
  generatedAt: string;
  entries: FaultGlossaryEntry[];
}

// =============================================================================
// Index
// =============================================================================

const glossary = rawGlossary as FaultGlossary;
let indexByKey: Map<string, FaultGlossaryEntry> | null = null;
let indexByFaultId: Map<string, FaultGlossaryEntry[]> | null = null;

function keyOf(exerciseId: string, faultId: string): string {
  return `${exerciseId}:${faultId}`;
}

function ensureIndex(): Map<string, FaultGlossaryEntry> {
  if (indexByKey) return indexByKey;
  const byKey = new Map<string, FaultGlossaryEntry>();
  const byFaultId = new Map<string, FaultGlossaryEntry[]>();
  for (const entry of glossary.entries) {
    byKey.set(keyOf(entry.exerciseId, entry.faultId), entry);
    const existing = byFaultId.get(entry.faultId) ?? [];
    existing.push(entry);
    byFaultId.set(entry.faultId, existing);
  }
  indexByKey = byKey;
  indexByFaultId = byFaultId;
  return byKey;
}

function ensureFaultIdIndex(): Map<string, FaultGlossaryEntry[]> {
  if (indexByFaultId) return indexByFaultId;
  ensureIndex();
  return indexByFaultId!;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Look up a glossary entry by exercise + fault id. Returns `null` when the
 * pair is not present. Exercise-id pairs not in the seed just return null
 * today; once a Gemma regenerator lands, it can backfill.
 */
export function getGlossaryEntry(
  exerciseId: string,
  faultId: string,
): FaultGlossaryEntry | null {
  const index = ensureIndex();
  return index.get(keyOf(exerciseId, faultId)) ?? null;
}

/**
 * Find all glossary entries for a fault id across exercises. Useful when
 * the caller knows only the fault name (e.g. coach surface talking about
 * "rounded_back" without an exercise context).
 */
export function getGlossaryEntriesByFaultId(
  faultId: string,
): FaultGlossaryEntry[] {
  const index = ensureFaultIdIndex();
  return index.get(faultId) ?? [];
}

/** Returns the schema version of the currently loaded glossary. */
export function getGlossaryVersion(): {
  schemaVersion: number;
  source: string;
  generatedAt: string;
  entryCount: number;
} {
  return {
    schemaVersion: glossary.schemaVersion,
    source: glossary.source,
    generatedAt: glossary.generatedAt,
    entryCount: glossary.entries.length,
  };
}

/**
 * Internal test hook — re-seed the in-memory index with a different dataset.
 * Only called from tests; not exported for production use.
 */
export function __resetGlossaryIndexForTests(): void {
  indexByKey = null;
  indexByFaultId = null;
}
