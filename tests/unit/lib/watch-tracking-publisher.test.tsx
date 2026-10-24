import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import ts from 'typescript';
import type { WatchTrackingPayload } from '@/lib/watch-connectivity/tracking-payload';
import { readScanScreenSource } from '../../helpers/scan-screen-source';

/**
 * Execute the checked-in screen's publisher refs + complete useEffect call
 * (including its real dependency array) with React. Only screen inputs and
 * transport boundaries are substituted; no copy of the publisher algorithm.
 * This deliberately avoids mounting unrelated camera/audio/native UI.
 */
const source = ts.createSourceFile(
  'scan-arkit.tsx',
  readScanScreenSource(),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const screen = source.statements.find(
  (node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'ScanARKitScreen',
);
if (!screen?.body) throw new Error('Scan screen function not found');
const refs = screen.body.statements.filter(
  (node) => ts.isVariableStatement(node) && node.declarationList.declarations.some(
    (declaration) => declaration.name.getText(source).startsWith('watchTracking'),
  ),
);
const effects = screen.body.statements.filter(
  (node) => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(source) === 'useEffect'
    && node.expression.arguments[0]?.getText(source).includes('watchTracking'),
);
const publishers = effects.filter((node) => node.getText(source).includes('buildWatchTrackingPayload('));
if (refs.length === 0 || publishers.length !== 1) throw new Error('Expected the production tracking publisher refs and effect');

type Inputs = {
  Platform: { OS: string };
  watchPaired: boolean;
  watchInstalled: boolean;
  watchReachable: boolean;
  isScreenFocused: boolean;
  isTracking: boolean;
  detectionMode: string;
  activePhase: string;
  repCount: number;
  primaryCue: string | null;
  activeMetrics: Record<string, number | null>;
  activeWorkoutDef: { ui: { buildWatchMetrics: (metrics: Record<string, number | null>) => Record<string, number | null> } };
  lastTrackingQualityRef: { current: number | null };
  livePullupPartialStatus: { visibility_badge: string } | null;
  sendMessage: jest.Mock<void, [WatchTrackingPayload]>;
  updateWatchContext: jest.Mock<void, [WatchTrackingPayload]>;
};
const inputNames = [
  'Platform', 'watchPaired', 'watchInstalled', 'watchReachable', 'isScreenFocused',
  'isTracking', 'detectionMode', 'activePhase', 'repCount', 'primaryCue',
  'activeMetrics', 'activeWorkoutDef', 'lastTrackingQualityRef', 'livePullupPartialStatus',
  'sendMessage', 'updateWatchContext',
];
const imports = source.statements.filter((node) =>
  ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
    && node.moduleSpecifier.text.startsWith('@/lib/watch-connectivity/'),
);
const compiled = ts.transpileModule(`
  ${imports.map((node) => node.getText(source)).join('\n')}
  const { useEffect, useRef } = React;
  function useScreenPublisher(inputs) {
    const { ${inputNames.join(', ')} } = inputs;
    ${refs.map((node) => node.getText(source)).join('\n')}
    ${effects.map((node) => node.getText(source)).join('\n')}
  }
`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
// Only trusted, checked-in TypeScript is evaluated; no runtime/user input enters
// this function body. New free variables fail loudly instead of falling back to
// a copied implementation of the screen's behavior.
const useScreenPublisher = new Function('React', 'require', 'exports', `${compiled}; return useScreenPublisher;`)(
  React, require, {},
) as (inputs: Inputs) => void;

function inputs(overrides: Partial<Inputs> = {}): Inputs {
  return {
    Platform: { OS: 'ios' }, watchPaired: true, watchInstalled: true,
    watchReachable: true, isScreenFocused: true, isTracking: true,
    detectionMode: 'pullup', activePhase: 'pulling', repCount: 2, primaryCue: 'Keep steady',
    activeMetrics: { elbowAngle: 80 },
    activeWorkoutDef: { ui: { buildWatchMetrics: (metrics) => metrics } },
    lastTrackingQualityRef: { current: 0.9 }, livePullupPartialStatus: null,
    sendMessage: jest.fn(), updateWatchContext: jest.fn(),
    ...overrides,
  };
}

function lastPayloads(state: Inputs) {
  return [state.sendMessage, state.updateWatchContext].map((transport) =>
    transport.mock.calls[transport.mock.calls.length - 1]?.[0],
  );
}

describe('scan screen Watch tracking publisher', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(1000); });
  afterEach(() => { jest.useRealTimers(); });

  it('uses the production payload builder import', () => {
    const builderImport = source.statements.find((node) =>
      ts.isImportDeclaration(node) && node.importClause?.namedBindings?.getText(source).includes('buildWatchTrackingPayload'),
    ) as ts.ImportDeclaration | undefined;
    expect(builderImport?.moduleSpecifier.getText(source)).toBe("'@/lib/watch-connectivity/tracking-payload'");
  });

  it('preserves metric throttling and deduplication without retaining a trailing snapshot', () => {
    const state = inputs();
    const { rerender } = renderHook(useScreenPublisher, { initialProps: state });
    act(() => { jest.advanceTimersByTime(100); });
    rerender({ ...state, repCount: 3 });
    expect(state.sendMessage).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    act(() => { jest.advanceTimersByTime(150); });
    rerender({ ...state, repCount: 4 });
    expect(lastPayloads(state).map((payload) => payload.reps)).toEqual([4, 4]);
    act(() => { jest.advanceTimersByTime(250); });
    rerender({ ...state, repCount: 4, activeMetrics: { ...state.activeMetrics } });
    expect(state.sendMessage).toHaveBeenCalledTimes(2);
    expect(state.updateWatchContext).toHaveBeenCalledTimes(2);
  });

  it('still submits stopped context when immediate messaging is unreachable', () => {
    const state = inputs({ watchReachable: false });
    const { rerender } = renderHook(useScreenPublisher, { initialProps: state });
    rerender({ ...state, isTracking: false });
    expect(lastPayloads(state).map((payload) => payload.isTracking)).toEqual([false, false]);
    expect(state.sendMessage.mock.calls).toEqual(state.updateWatchContext.mock.calls);
    expect(lastPayloads(state)[1].quality).toEqual({ trackingConfidence: 0.9, isDegraded: false });
  });

  it.each<Partial<Inputs>>([
    { Platform: { OS: 'android' } }, { Platform: { OS: 'web' } },
    { watchPaired: false }, { watchInstalled: false },
  ])('preserves unavailable transport gates: %j', (unavailable) => {
    const state = inputs(unavailable);
    const { rerender } = renderHook(useScreenPublisher, { initialProps: state });
    rerender({ ...state, isTracking: false });
    act(() => { jest.advanceTimersByTime(1000); });
    expect(state.sendMessage).not.toHaveBeenCalled();
    expect(state.updateWatchContext).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('publishes only current state when pairing returns, without replaying unavailable transitions', () => {
    const state = inputs();
    const { rerender } = renderHook(useScreenPublisher, { initialProps: state });
    rerender({ ...state, watchPaired: false, isTracking: false, repCount: 3 });
    act(() => { jest.advanceTimersByTime(250); });
    rerender({ ...state, watchPaired: true, isTracking: false, repCount: 4 });
    expect(state.sendMessage.mock.calls.map(([payload]) => payload.reps)).toEqual([2, 4]);
    expect(state.updateWatchContext.mock.calls).toEqual(state.sendMessage.mock.calls);
  });

  it('cannot replay old metrics after a scan mode change and stop/restart', () => {
    const state = inputs();
    const { rerender } = renderHook(useScreenPublisher, { initialProps: state });
    act(() => { jest.advanceTimersByTime(100); });
    rerender({ ...state, repCount: 99 }); // dropped ordinary metrics, not queued
    const nextScan = { ...state, detectionMode: 'squat', activePhase: 'rest', repCount: 0 };
    rerender({ ...nextScan, isTracking: false });
    rerender(nextScan);
    const submitted = state.sendMessage.mock.calls.length;
    act(() => { jest.advanceTimersByTime(1000); });
    expect(state.sendMessage).toHaveBeenCalledTimes(submitted);
    expect(state.updateWatchContext).toHaveBeenCalledTimes(submitted);
    expect(lastPayloads(state).map((payload) => payload.tracking)).toEqual([
      expect.objectContaining({ mode: 'squat', reps: 0, isTracking: true }),
      expect.objectContaining({ mode: 'squat', reps: 0, isTracking: true }),
    ]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('has no deferred work to cancel on blur or unmount', () => {
    const state = inputs();
    const { rerender, unmount } = renderHook(useScreenPublisher, { initialProps: state });
    act(() => { jest.advanceTimersByTime(100); });
    rerender({ ...state, repCount: 99 });
    rerender({ ...state, isScreenFocused: false });
    act(() => { jest.advanceTimersByTime(1000); });
    expect(state.sendMessage).toHaveBeenCalledTimes(1);
    expect(state.updateWatchContext).toHaveBeenCalledTimes(1);
    unmount();
    act(() => { jest.advanceTimersByTime(1000); });
    expect(state.sendMessage).toHaveBeenCalledTimes(1);
    expect(state.updateWatchContext).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not publish hidden-screen changes and submits current state on refocus', () => {
    const state = inputs();
    const { rerender } = renderHook(useScreenPublisher, { initialProps: state });
    rerender({ ...state, isScreenFocused: false });
    rerender({ ...state, isScreenFocused: false, isTracking: false, repCount: 50 });
    expect(state.sendMessage).toHaveBeenCalledTimes(1);
    expect(state.updateWatchContext).toHaveBeenCalledTimes(1);
    rerender({ ...state, isTracking: false, repCount: 0 });
    expect(lastPayloads(state).map((payload) => payload.isTracking)).toEqual([false, false]);
    expect(lastPayloads(state).map((payload) => payload.reps)).toEqual([0, 0]);
    expect(state.sendMessage.mock.calls.map(([payload]) => payload.ts)).toEqual([1000, 1001]);
  });

  it('invalidates deduplication on refocus without resetting timestamp ordering', () => {
    const state = inputs();
    const { rerender } = renderHook(useScreenPublisher, { initialProps: state });
    rerender({ ...state, isScreenFocused: false });
    rerender(state);
    expect(state.sendMessage.mock.calls.map(([payload]) => payload.ts)).toEqual([1000, 1001]);
    expect(state.updateWatchContext.mock.calls).toEqual(state.sendMessage.mock.calls);
  });

  it('publishes a new exercise immediately inside the old exercise throttle window', () => {
    const state = inputs();
    const { rerender } = renderHook(useScreenPublisher, { initialProps: state });
    rerender({ ...state, detectionMode: 'squat', repCount: 0 });
    expect(lastPayloads(state).map((payload) => payload.tracking.mode)).toEqual(['squat', 'squat']);
    expect(state.sendMessage.mock.calls.map(([payload]) => payload.ts)).toEqual([1000, 1001]);
    act(() => { jest.advanceTimersByTime(1000); });
    expect(state.sendMessage).toHaveBeenCalledTimes(2);
    expect(state.updateWatchContext).toHaveBeenCalledTimes(2);
  });

  it.each(['watchPaired', 'watchInstalled'] as const)('invalidates stale deduplication when %s returns', (gate) => {
    const state = inputs();
    const { rerender } = renderHook(useScreenPublisher, { initialProps: state });
    rerender({ ...state, [gate]: false });
    rerender(state);
    expect(state.sendMessage.mock.calls.map(([payload]) => payload.ts)).toEqual([1000, 1001]);
    expect(state.updateWatchContext.mock.calls).toEqual(state.sendMessage.mock.calls);
  });

  it('orders same-millisecond start/stop/restart transitions strictly increasingly', () => {
    const state = inputs({ isTracking: false });
    const { rerender } = renderHook(useScreenPublisher, { initialProps: state });
    rerender({ ...state, isTracking: true });
    rerender({ ...state, isTracking: false });
    rerender({ ...state, isTracking: true });
    for (const transport of [state.sendMessage, state.updateWatchContext]) {
      const payloads = transport.mock.calls.map(([payload]) => payload);
      expect(payloads.map((payload) => payload.isTracking)).toEqual([false, true, false, true]);
      expect(payloads.map((payload) => payload.ts)).toEqual([1000, 1001, 1002, 1003]);
    }
  });

  it('submits final stop to BOTH transports inside 250ms without another frame', () => {
    const state = inputs();
    const { rerender } = renderHook(useScreenPublisher, { initialProps: state });
    expect(lastPayloads(state).map((payload) => payload.isTracking)).toEqual([true, true]);
    act(() => { jest.advanceTimersByTime(100); });
    rerender({ ...state, isTracking: false, activePhase: 'rest', repCount: 3 });
    // No more effect/frame invocations after Stop.
    act(() => { jest.advanceTimersByTime(1000); });
    expect(lastPayloads(state).map((payload) => payload.isTracking)).toEqual([false, false]);
    expect(lastPayloads(state).map((payload) => payload.reps)).toEqual([3, 3]);
    expect(state.sendMessage).toHaveBeenCalledTimes(2);
    expect(state.updateWatchContext).toHaveBeenCalledTimes(2);
  });
});
