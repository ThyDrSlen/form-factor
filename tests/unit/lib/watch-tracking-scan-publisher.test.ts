import React, { useEffect } from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { readFileSync } from 'fs';
import path from 'path';
import ts from 'typescript';
import type { WatchTrackingPayload } from '@/lib/watch-connectivity/tracking-payload';
import { readScanScreenSource } from '../../helpers/scan-screen-source';

/**
 * Execute the actual screen's publisher slice, not a copied throttle or a mock
 * publisher. AST selection keeps unrelated camera/native/UI dependencies out
 * while real React runs the source refs, dependency arrays and cleanup bodies.
 * The real imports used by that slice are evaluated through Jest's resolver.
 */
function loadScreenPublisher(sendMessage: jest.Mock, updateWatchContext: jest.Mock) {
  const filename = path.resolve(__dirname, '../../..', 'app/(tabs)/scan-arkit.tsx');
  const source = ts.createSourceFile(filename, readScanScreenSource(), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const screen = source.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'ScanARKitScreen');
  if (!screen?.body) throw new Error('Scan screen function not found');
  const refs = screen.body.statements.filter((node) =>
    ts.isVariableStatement(node) && node.declarationList.declarations.some((decl) =>
      ts.isIdentifier(decl.name) && decl.name.text.startsWith('watchTracking')));
  const effects = screen.body.statements.filter((node) =>
    ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
    node.expression.expression.getText(source) === 'useEffect' &&
    /watchTracking/.test(node.getText(source)));
  if (!refs.length || !effects.length) throw new Error('Production tracking publisher slice not found');
  const imports = source.statements.filter((node) =>
    ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) &&
    node.moduleSpecifier.text.startsWith('@/lib/watch-connectivity/'));
  const code = ts.transpileModule(`
    ${imports.map((node) => node.getText(source)).join('\n')}
    export function useScreenPublisher(input) {
      const { isTracking, activePhase, activeMetrics, activeWorkoutDef,
        detectionMode, primaryCue, repCount, livePullupPartialStatus,
        lastTrackingQualityRef, watchInstalled, watchPaired, watchReachable,
        isScreenFocused } = input;
      ${refs.map((node) => node.getText(source)).join('\n')}
      ${effects.map((node) => node.getText(source)).join('\n')}
    }
  `, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} as { useScreenPublisher: (props: ReturnType<typeof input>) => void } };
  // Only trusted repository source is evaluated; no external/user text enters this test harness.
  new Function('require', 'module', 'exports', 'React', 'useEffect', 'Platform', 'sendMessage', 'updateWatchContext', code)(
    require, module, module.exports, React, useEffect, { OS: 'ios' }, sendMessage, updateWatchContext,
  );
  return module.exports.useScreenPublisher;
}

function input() {
  return {
    isTracking: true,
    activePhase: 'ascending',
    activeMetrics: { elbow: 90 },
    activeWorkoutDef: { ui: { buildWatchMetrics: (metrics: Record<string, number>) => metrics } },
    detectionMode: 'pullup',
    primaryCue: 'Keep steady',
    repCount: 2,
    livePullupPartialStatus: { visibility_badge: 'full' },
    lastTrackingQualityRef: { current: 0.9 },
    watchInstalled: true,
    watchPaired: true,
    watchReachable: false,
    isScreenFocused: true,
  };
}

const lastPayload = (transport: jest.Mock): WatchTrackingPayload =>
  transport.mock.calls[transport.mock.calls.length - 1][0];

describe('scan screen Watch tracking publisher (actual production wiring)', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(1000); });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('publishes changed reps to both transports after phone clock rollback without adding timers', () => {
    const message = jest.fn();
    const context = jest.fn();
    const usePublisher = loadScreenPublisher(message, context);
    const initial = input();
    const { rerender, unmount } = renderHook(usePublisher, { initialProps: initial });
    const previousTimestamp = lastPayload(context).ts;
    act(() => { jest.setSystemTime(500); });
    rerender({ ...initial, repCount: 3 });
    expect(context).toHaveBeenCalledTimes(2);
    expect(lastPayload(context).reps).toBe(3);
    expect(lastPayload(context).ts).toBeGreaterThan(previousTimestamp);
    expect(message.mock.calls).toEqual(context.mock.calls);
    expect(jest.getTimerCount()).toBe(0);
    unmount();
  });

  it('submits final Stop inside 250ms to message AND context without another frame, even unreachable', () => {
    const message = jest.fn();
    const context = jest.fn();
    const usePublisher = loadScreenPublisher(message, context);
    const initial = input();
    const { rerender, unmount } = renderHook(usePublisher, { initialProps: initial });
    expect(lastPayload(context).isTracking).toBe(true);
    act(() => { jest.advanceTimersByTime(100); });
    rerender({ ...initial, isTracking: false });
    act(() => { jest.advanceTimersByTime(1000); });
    expect(lastPayload(message).isTracking).toBe(false);
    expect(lastPayload(context).isTracking).toBe(false);
    expect(message.mock.calls).toEqual(context.mock.calls);
    unmount();
  });

  it('gives same-millisecond Start/Stop strictly increasing timestamps accepted by the Watch', () => {
    const message = jest.fn();
    const context = jest.fn();
    const usePublisher = loadScreenPublisher(message, context);
    const initial = input();
    const { rerender, unmount } = renderHook(usePublisher, { initialProps: initial });
    rerender({ ...initial, isTracking: false });
    rerender(initial);
    rerender({ ...initial, isTracking: false });
    expect(context.mock.calls.map(([payload]) => payload.isTracking)).toEqual([true, false, true, false]);
    const timestamps = context.mock.calls.map(([payload]) => payload.ts);
    expect(timestamps).toEqual([1000, 1001, 1002, 1003]);
    expect(message.mock.calls).toEqual(context.mock.calls);
    expect(jest.getTimerCount()).toBe(0);
    unmount();
  });

  it('invalidates a blurred scan scope and republishes current state on focus without resetting ordering', () => {
    const message = jest.fn();
    const context = jest.fn();
    const usePublisher = loadScreenPublisher(message, context);
    const initial = input();
    const { rerender, unmount } = renderHook(usePublisher, { initialProps: initial });
    rerender({ ...initial, isScreenFocused: false });
    // Frames/lifecycle changes in an inactive screen cannot publish old scope work.
    rerender({ ...initial, isScreenFocused: false, isTracking: false });
    expect(context).toHaveBeenCalledTimes(1);
    rerender(initial);
    expect(context).toHaveBeenCalledTimes(2);
    expect(lastPayload(context).ts).toBeGreaterThan(context.mock.calls[0][0].ts);
    expect(lastPayload(context).isTracking).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    unmount();
    act(() => { jest.advanceTimersByTime(1000); });
    expect(context).toHaveBeenCalledTimes(2);
  });

  it.each(['watchPaired', 'watchInstalled'] as const)('invalidates the publisher when %s is lost and restored', (flag) => {
    const message = jest.fn();
    const context = jest.fn();
    const usePublisher = loadScreenPublisher(message, context);
    const initial = input();
    const { rerender, unmount } = renderHook(usePublisher, { initialProps: initial });
    rerender({ ...initial, [flag]: false });
    expect(context).toHaveBeenCalledTimes(1);
    rerender(initial);
    expect(context).toHaveBeenCalledTimes(2);
    expect(lastPayload(context).ts).toBeGreaterThan(context.mock.calls[0][0].ts);
    unmount();
  });

  it('submits the new exercise scope immediately instead of throttling it against the old scan', () => {
    const message = jest.fn();
    const context = jest.fn();
    const usePublisher = loadScreenPublisher(message, context);
    const initial = input();
    const { rerender, unmount } = renderHook(usePublisher, { initialProps: initial });
    rerender({ ...initial, detectionMode: 'squat', repCount: 0 });
    expect(lastPayload(context).tracking.mode).toBe('squat');
    expect(lastPayload(context).ts).toBeGreaterThan(context.mock.calls[0][0].ts);
    expect(jest.getTimerCount()).toBe(0);
    unmount();
  });
});
