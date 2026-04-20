// Coach output shaper.
//
// TODO(#446): merge with PR #448 canonical output shaper on land. PR #448
// owns the heuristic that strips LLM filler ("Let me help you with that..."),
// normalizes lists, and trims to the 180-word coach output budget. Until
// that lands, we ship a minimal stub that exposes:
//
// - shapeFinalResponse(text): identity passthrough placeholder so callers can
//   wire shape into the synchronous path today and inherit the canonical
//   logic when #448 lands.
// - shapeStreamChunk(chunk, isLast): the streaming-mode addition #465 Item 5
//   actually needs - sentence-boundary buffering for streamed chunks. This
//   IS the canonical shape function for the streaming flow; PR #448 will
//   compose it after the synchronous heuristic.
//
// The streaming shape is intentionally minimal: hold incoming text in a
// buffer and only emit when we cross a sentence boundary (.?! followed by
// whitespace/end). This avoids emitting half-sentences that look broken in
// the UI.

const SENTENCE_BOUNDARY = /([.?!])(\s+|$)/g;

export interface ShapeStreamResult {
  /** The chunk to emit downstream (may be empty). */
  emit: string;
  /**
   * The buffered text held back, awaiting more input. Useful for telemetry
   * (`stream_buffered_pct`).
   */
  buffered: string;
}

/**
 * Shape the synchronous (non-streamed) coach response.
 * For now this is identity; PR #448 will fold in the canonical heuristic.
 */
export function shapeFinalResponse(text: string): string {
  // TODO(#446): apply PR #448's canonical shape (filler-strip, list-normalize,
  // 180-word budget). Identity for now so callers can wire shape today.
  return text.trim();
}

/**
 * Shape one streamed chunk on sentence boundaries.
 *
 * Maintains the buffer in the closure of a returned function; callers create
 * one shaper per stream via `createStreamShaper()`. We expose a static helper
 * `shapeStreamChunk(chunk, isLast, buffer)` for tests / functional callers
 * that want to manage the buffer themselves.
 *
 * @param chunk    incoming text fragment
 * @param isLast   true when the upstream signaled stream completion;
 *                 forces flush of the trailing buffer
 * @param prevBuffer existing buffered text (caller-managed)
 */
export function shapeStreamChunk(
  chunk: string,
  isLast: boolean,
  prevBuffer = ''
): ShapeStreamResult {
  const combined = prevBuffer + chunk;

  if (isLast) {
    return { emit: combined, buffered: '' };
  }

  // Scan for the last sentence boundary; emit everything up to and including it.
  let lastBoundaryEnd = -1;
  // Reset regex lastIndex (RegExp objects with /g are stateful across calls).
  SENTENCE_BOUNDARY.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SENTENCE_BOUNDARY.exec(combined)) !== null) {
    lastBoundaryEnd = match.index + match[0].length;
  }

  if (lastBoundaryEnd === -1) {
    // No boundary - hold everything.
    return { emit: '', buffered: combined };
  }

  return {
    emit: combined.slice(0, lastBoundaryEnd),
    buffered: combined.slice(lastBoundaryEnd),
  };
}

/**
 * Stateful shaper. Returns `process(chunk, isLast)` that captures the buffer
 * across chunks so the caller doesn't have to.
 */
export function createStreamShaper(): {
  process: (chunk: string, isLast: boolean) => ShapeStreamResult;
  /** Current buffered (un-emitted) text. */
  getBuffered: () => string;
} {
  let buffer = '';
  return {
    process(chunk: string, isLast: boolean) {
      const result = shapeStreamChunk(chunk, isLast, buffer);
      buffer = result.buffered;
      return result;
    },
    getBuffered() {
      return buffer;
    },
  };
}
