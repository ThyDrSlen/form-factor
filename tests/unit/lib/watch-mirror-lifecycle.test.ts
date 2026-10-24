import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { readFileSync } from 'fs';
import path from 'path';
import ts from 'typescript';

// Execute the actual screen slice, including its effect cleanup and callback,
// rather than duplicating the publisher or importing unrelated native UI.
function loadMirror(snapshot: jest.Mock, sendMessage: jest.Mock) {
  const filename = path.resolve(__dirname, '../../..', 'app/(tabs)/scan-arkit.tsx');
  const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const screen = source.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'ScanARKitScreen');
  if (!screen?.body) throw new Error('Missing screen');
  const names = new Set(['watchMirrorTimerRef', 'watchMirrorPublisher', 'watchMirrorSvgRef',
    'canMirrorFromArkit', 'watchMirrorActive', 'captureAndSendWatchMirror']);
  const selected = screen.body.statements.filter((node) => {
    if (ts.isVariableStatement(node)) return node.declarationList.declarations.some((decl) =>
      ts.isIdentifier(decl.name) ? names.has(decl.name.text) :
        ts.isArrayBindingPattern(decl.name) && decl.name.elements.some((el) =>
          ts.isBindingElement(el) && ts.isIdentifier(el.name) && names.has(el.name.text)));
    return ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
      ['useEffect', 'useLayoutEffect', 'React.useLayoutEffect'].includes(node.expression.expression.getText(source)) &&
      /captureAndSendWatchMirror/.test(node.getText(source));
  });
  const code = ts.transpileModule(`
    const { createWatchMirrorPublisher } = require('@/lib/watch-connectivity/mirror-publisher');
    export function useMirror(input) {
      const { isTracking, isScreenFocused, watchMirrorEnabled, watchReachable,
        watchInstalled, watchPaired, cameraPosition, appStatePause, detectionMode } = input;
      const activePhaseRef = React.useRef('ascending');
      const restPhaseRef = React.useRef('idle');
      const overlayLayout = React.useRef({ width: 320, height: 640 });
      const DEV = false;
      const logTrackingDebug = React.useCallback(() => {}, []);
      ${selected.map((node) => node.getText(source)).join('\n')}
    }
  `, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} as { useMirror: (props: ReturnType<typeof input>) => void } };
  // Only trusted repository AST/source is evaluated, never external input.
  new Function('require', 'module', 'exports', 'React', 'useEffect', 'useLayoutEffect', 'useCallback', 'useState',
    'Platform', 'BodyTracker', 'sendMessage', 'WATCH_MIRROR_INTERVAL_MS', 'WATCH_MIRROR_MAX_WIDTH',
    'WATCH_MIRROR_AR_QUALITY', 'warnWithTs', 'captureWatchMirrorOverlay', code)(require, module, module.exports, React, useEffect,
    useLayoutEffect, useCallback, useState, { OS: 'ios' }, { getCurrentFrameSnapshot: snapshot },
    sendMessage, 1000, 320, 0.5, jest.fn(), async () => undefined);
  return module.exports.useMirror;
}

function input() {
  return { isTracking: true, isScreenFocused: true, watchMirrorEnabled: true,
    watchReachable: true, watchInstalled: true, watchPaired: true,
    cameraPosition: 'back', appStatePause: { isPaused: false }, detectionMode: 'pullup' };
}

function deferred() {
  let resolve!: (value: { frame: string }) => void;
  const promise = new Promise<{ frame: string }>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('Watch mirror asynchronous lifecycle (actual screen wiring)', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it.each<[string, Partial<ReturnType<typeof input>>]>([
    ['Stop', { isTracking: false }],
    ['screen blur', { isScreenFocused: false }],
    ['mirror disabled', { watchMirrorEnabled: false }],
    ['background pause', { appStatePause: { isPaused: true } }],
    ['Watch disconnect', { watchReachable: false }],
    ['Watch unpaired', { watchPaired: false }],
    ['Watch app removed', { watchInstalled: false }],
    ['camera change', { cameraPosition: 'front' }],
  ])('drops a pending snapshot after %s and stops polling', async (_, change) => {
    const pending = deferred();
    const snapshot = jest.fn(() => pending.promise);
    const send = jest.fn();
    const initial = input();
    const { rerender, unmount } = renderHook(loadMirror(snapshot, send), { initialProps: initial });
    await act(async () => { await Promise.resolve(); });
    expect(snapshot).toHaveBeenCalledTimes(1);
    rerender({ ...initial, ...change });
    await act(async () => { pending.resolve({ frame: 'old-run' }); await pending.promise; });
    expect(send).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(3000); });
    expect(snapshot).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('drops an old exercise capture after the tracking mode changes', async () => {
    const pending = deferred();
    const snapshot = jest.fn(() => pending.promise);
    const send = jest.fn();
    const initial = input();
    const { rerender, unmount } = renderHook(loadMirror(snapshot, send), { initialProps: initial });
    await act(async () => { await Promise.resolve(); });
    rerender({ ...initial, detectionMode: 'squat' });
    await act(async () => { pending.resolve({ frame: 'old-exercise' }); await pending.promise; });
    expect(send).not.toHaveBeenCalled();
    unmount();
  });

  it('drops pending work on unmount', async () => {
    const pending = deferred();
    const snapshot = jest.fn(() => pending.promise);
    const send = jest.fn();
    const { unmount } = renderHook(loadMirror(snapshot, send), { initialProps: input() });
    await act(async () => { await Promise.resolve(); });
    unmount();
    await act(async () => { pending.resolve({ frame: 'unmounted' }); await pending.promise; });
    act(() => { jest.advanceTimersByTime(3000); });
    expect(send).not.toHaveBeenCalled();
    expect(snapshot).toHaveBeenCalledTimes(1);
  });

  it('drops the pre-Stop capture after restart and then sends a fresh image', async () => {
    const pending = deferred();
    const snapshot = jest.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({ frame: 'fresh', timestamp: 11 });
    const send = jest.fn();
    const initial = input();
    const { rerender, unmount } = renderHook(loadMirror(snapshot, send), { initialProps: initial });
    await act(async () => { await Promise.resolve(); });
    rerender({ ...initial, isTracking: false });
    rerender(initial);
    await act(async () => { pending.resolve({ frame: 'old-run' }); await pending.promise; });
    expect(send).not.toHaveBeenCalled();
    await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ frame: 'fresh' }));
    unmount();
  });

  it('recovers when a native capture rejects without wedging the poller', async () => {
    const snapshot = jest.fn().mockRejectedValueOnce(new Error('camera unavailable')).mockResolvedValue({ frame: 'fresh' });
    const send = jest.fn();
    const { unmount } = renderHook(loadMirror(snapshot, send), { initialProps: input() });
    await act(async () => { await Promise.resolve(); });
    expect(send).not.toHaveBeenCalled();
    await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
    expect(send).toHaveBeenCalledTimes(1);
    unmount();
  });
});
