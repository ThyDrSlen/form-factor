// useStreamCoach: opens a streaming coach request and surfaces incremental
// state for UI consumers. Issue #465 Item 1.
//
// Telemetry (Item 4): records `stream_chunks`, `stream_chunk_delay_ms_avg`,
// `stream_abort_count`, `stream_buffered_pct` via lib/services/coach-telemetry.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  streamCoachPrompt,
  type StreamCoachOptions,
  type StreamCoachResult,
} from '@/lib/services/coach-streaming';
import {
  recordCoachStreamAbort,
  recordCoachStreamChunk,
  recordCoachStreamComplete,
  recordCoachStreamStart,
} from '@/lib/services/coach-telemetry';
import type { CoachContext, CoachMessage } from '@/lib/services/coach-service';

export interface StreamCoachState {
  /** Cumulative streamed text. */
  buffered: string;
  /** True between `start()` and resolution/abort. */
  isStreaming: boolean;
  /** True once the stream resolved cleanly. */
  complete: boolean;
  /** Last error, if any. */
  error: Error | null;
  /** Final stats once `complete` flips true. */
  stats: StreamCoachResult | null;
}

export interface UseStreamCoachReturn extends StreamCoachState {
  /** Open the stream. Resolves to the full text or null on abort/error. */
  start: (
    messages: CoachMessage[],
    context?: CoachContext,
    opts?: StreamCoachOptions
  ) => Promise<string | null>;
  /** Abort an in-flight stream. */
  abort: () => void;
  /** Reset state to initial. */
  reset: () => void;
}

const INITIAL_STATE: StreamCoachState = {
  buffered: '',
  isStreaming: false,
  complete: false,
  error: null,
  stats: null,
};

export function useStreamCoach(): UseStreamCoachReturn {
  const [state, setState] = useState<StreamCoachState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const lastChunkAtRef = useRef<number>(0);
  const chunkDelaysRef = useRef<number[]>([]);

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
    chunkDelaysRef.current = [];
    lastChunkAtRef.current = 0;
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
      // Cancel any in-flight stream before starting a new one.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      chunkDelaysRef.current = [];
      lastChunkAtRef.current = Date.now();

      if (mountedRef.current) {
        setState({ ...INITIAL_STATE, isStreaming: true });
      }
      recordCoachStreamStart();

      try {
        const result = await streamCoachPrompt(
          messages,
          context,
          (delta) => {
            const now = Date.now();
            if (lastChunkAtRef.current > 0) {
              chunkDelaysRef.current.push(now - lastChunkAtRef.current);
            }
            lastChunkAtRef.current = now;
            recordCoachStreamChunk(delta.length);
            if (!mountedRef.current) return;
            setState((prev) => ({
              ...prev,
              buffered: prev.buffered + delta,
            }));
          },
          { ...opts, signal: opts?.signal ?? controller.signal }
        );

        const avgDelay =
          chunkDelaysRef.current.length > 0
            ? chunkDelaysRef.current.reduce((a, b) => a + b, 0) /
              chunkDelaysRef.current.length
            : 0;
        recordCoachStreamComplete({
          ttftMs: result.ttftMs,
          durationMs: result.durationMs,
          chunkCount: result.chunkCount,
          avgChunkDelayMs: avgDelay,
        });

        if (mountedRef.current) {
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            complete: true,
            stats: result,
          }));
        }
        return result.text;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        // Surface as abort if it's an AbortError or our explicit abort code.
        const wasAborted =
          error.name === 'AbortError' ||
          ('code' in error && (error as { code?: string }).code === 'COACH_STREAM_ABORTED');
        if (wasAborted) {
          recordCoachStreamAbort();
        }
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
