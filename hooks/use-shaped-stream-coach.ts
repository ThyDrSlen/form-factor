// useShapedStreamCoach: composes useStreamCoach with the output shaper so
// downstream consumers only see complete sentences. Issue #465 Item 5.
//
// The raw streaming hook (useStreamCoach) appends every delta into `buffered`
// the moment it arrives. UI surfaces that need to render mid-stream usually
// want sentence-boundary buffering so they don't flicker on half-words.
// This hook layers `createStreamShaper()` on top so:
//
// - `buffered` holds shaper-emitted text (clean sentences only).
// - `pending` is the currently-buffered, not-yet-emitted fragment - useful
//   for showing a typing indicator without rendering broken text.
// - `complete` flips true once the upstream stream closes AND the buffer is
//   flushed.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createStreamShaper,
  type ShapeStreamResult,
} from '@/lib/services/coach-output-shaper';
import {
  streamCoachPrompt,
  type StreamCoachOptions,
  type StreamCoachResult,
} from '@/lib/services/coach-streaming';
import {
  recordCoachStreamAbort,
  recordCoachStreamBufferedPct,
  recordCoachStreamChunk,
  recordCoachStreamComplete,
  recordCoachStreamStart,
} from '@/lib/services/coach-telemetry';
import type { CoachContext, CoachMessage } from '@/lib/services/coach-service';

export interface ShapedStreamState {
  /** Shaped text emitted so far (complete sentences). */
  buffered: string;
  /** Text currently buffered inside the shaper, awaiting a sentence boundary. */
  pending: string;
  isStreaming: boolean;
  complete: boolean;
  error: Error | null;
  stats: StreamCoachResult | null;
}

export interface UseShapedStreamCoachReturn extends ShapedStreamState {
  start: (
    messages: CoachMessage[],
    context?: CoachContext,
    opts?: StreamCoachOptions
  ) => Promise<string | null>;
  abort: () => void;
  reset: () => void;
}

const INITIAL_STATE: ShapedStreamState = {
  buffered: '',
  pending: '',
  isStreaming: false,
  complete: false,
  error: null,
  stats: null,
};

export function useShapedStreamCoach(): UseShapedStreamCoachReturn {
  const [state, setState] = useState<ShapedStreamState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  const abort = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      recordCoachStreamAbort();
    }
  }, []);

  const start = useCallback(
    async (
      messages: CoachMessage[],
      context?: CoachContext,
      opts?: StreamCoachOptions
    ): Promise<string | null> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const shaper = createStreamShaper();
      let totalChars = 0;
      let bufferedChars = 0;

      if (mountedRef.current) {
        setState({ ...INITIAL_STATE, isStreaming: true });
      }
      recordCoachStreamStart();

      const applyShaperResult = (result: ShapeStreamResult) => {
        bufferedChars = result.buffered.length;
        if (totalChars > 0) {
          recordCoachStreamBufferedPct(bufferedChars / totalChars);
        }
        if (!mountedRef.current) return;
        if (result.emit.length > 0) {
          setState((prev) => ({
            ...prev,
            buffered: prev.buffered + result.emit,
            pending: result.buffered,
          }));
        } else {
          setState((prev) => ({ ...prev, pending: result.buffered }));
        }
      };

      try {
        const result = await streamCoachPrompt(
          messages,
          context,
          (delta) => {
            recordCoachStreamChunk(delta.length);
            totalChars += delta.length;
            const shaped = shaper.process(delta, false);
            applyShaperResult(shaped);
          },
          { ...opts, signal: opts?.signal ?? controller.signal }
        );

        // Flush any remaining buffered text.
        const flushed = shaper.process('', true);
        applyShaperResult(flushed);

        recordCoachStreamComplete({
          ttftMs: result.ttftMs,
          durationMs: result.durationMs,
          chunkCount: result.chunkCount,
          avgChunkDelayMs:
            result.chunkCount > 1 ? result.durationMs / result.chunkCount : 0,
        });

        if (mountedRef.current) {
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            complete: true,
            stats: result,
            // Once flushed, the shaper has no pending text.
            pending: '',
          }));
        }
        return result.text;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const wasAborted =
          error.name === 'AbortError' ||
          ('code' in error &&
            (error as { code?: string }).code === 'COACH_STREAM_ABORTED');
        if (wasAborted) recordCoachStreamAbort();
        if (mountedRef.current) {
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            complete: false,
            error,
          }));
        }
        return null;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    []
  );

  return { ...state, start, abort, reset };
}
