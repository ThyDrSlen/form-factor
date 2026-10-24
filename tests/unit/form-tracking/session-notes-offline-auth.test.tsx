import React from 'react';
import { Text } from 'react-native';
import { DatabaseSync } from 'node:sqlite';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthRetryableFetchError, type AuthChangeEvent, type Session } from '@supabase/supabase-js';
import { AuthProvider, useAuth } from '@/features/auth/contexts/AuthContext';
import { SessionNotesSheet } from '@/features/form-tracking/components/debrief/SessionNotesSheet';
import { SessionManager } from '@/lib/services/SessionManager';
import { localDB } from '@/lib/services/database/local-db';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/services/OAuthHandler', () => ({ OAuthHandler: { getInstance: () => ({}) } }));
jest.mock('@/lib/services/database/sync-service', () => ({ syncService: { cleanupRealtimeSync: jest.fn() } }));
jest.mock('@/lib/services/notifications', () => ({
  registerDevicePushToken: jest.fn(async () => ({ error: null })),
  unregisterDevicePushToken: jest.fn(),
}));
jest.mock('@/lib/services/onboarding', () => ({ clearOnboardingFlag: jest.fn() }));
jest.mock('@/lib/auth-utils', () => ({ signInWithApple: jest.fn() }));
jest.mock('@/lib/network-utils', () => ({ runDiagnostics: jest.fn() }));
jest.mock('expo-linking', () => ({ createURL: () => 'formfactor:///callback' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/lib/logger', () => ({ warnWithTs: jest.fn(), logWithTs: jest.fn(), errorWithTs: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ supabase: { auth: {
  getSession: jest.fn(), setSession: jest.fn(), refreshSession: jest.fn(),
  signOut: jest.fn(), onAuthStateChange: jest.fn(),
} } }));

const auth = supabase.auth as unknown as Record<string, jest.Mock>;
const listeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>();
const emit = (event: AuthChangeEvent, session: Session | null) => listeners.forEach(listener => listener(event, session));
const inputId = 'session-notes-sheet-notes-input';
let sqlite: DatabaseSync;
let previous: typeof localDB.db;
let cached: Session;
let latestAuth: ReturnType<typeof useAuth>;
function Identity() {
  latestAuth = useAuth();
  const { user } = latestAuth;
  return <Text testID="provider-owner">{user?.id ?? 'signed-out'}</Text>;
}
function mount() {
  return render(<AuthProvider><Identity /><SessionNotesSheet sessionId="owned-session" /></AuthProvider>);
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-04T10:00:00Z'));
  jest.clearAllMocks();
  listeners.clear();
  cached = {
    access_token: 'expired-access-fixture', refresh_token: 'refresh-fixture', token_type: 'bearer',
    expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) - 120,
    user: { id: 'offline-owner', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' },
  };
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => key === '@fitness_app_session' ? JSON.stringify({
    session: cached, timestamp: Date.now() - 3600_000, expiresAt: cached.expires_at! * 1000,
  }) : null);
  const offline = { data: { session: null }, error: new AuthRetryableFetchError('Network request failed', 0) };
  auth.getSession.mockResolvedValue(offline);
  auth.setSession.mockResolvedValue(offline);
  auth.refreshSession.mockResolvedValue(offline);
  auth.onAuthStateChange.mockImplementation(listener => {
    listeners.add(listener);
    return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
  });
  sqlite = new DatabaseSync(':memory:');
  previous = localDB.db;
  type Bind = string | number | null;
  Object.assign(localDB, { db: {
    execAsync: async (sql: string) => sqlite.exec(sql),
    getAllAsync: async (sql: string, args: Bind[] = []) => sqlite.prepare(sql).all(...args),
    getFirstAsync: async (sql: string, args: Bind[] = []) => sqlite.prepare(sql).get(...args) ?? null,
    prepareAsync: async (sql: string) => {
      const statement = sqlite.prepare(sql);
      return {
        executeAsync: async (args: Bind[]) => statement.run(...args),
        finalizeAsync: async () => undefined,
      };
    },
  } });
  await (localDB as unknown as { createTables(): Promise<void> }).createTables();
  sqlite.prepare('INSERT INTO workout_sessions (id, user_id, started_at, deleted) VALUES (?, ?, ?, 0)')
    .run('owned-session', 'offline-owner', '2026-01-01');
  sqlite.prepare('INSERT INTO debrief_notes (session_id, notes, starred_fault_ids, saved_cues, updated_at) VALUES (?, ?, ?, 0, ?)')
    .run('owned-session', 'saved offline notes', '[]', '2026-01-01');
  // Cleanup policy is unchanged; isolate its side effects from note persistence assertions.
  jest.spyOn(localDB, 'clearAllData').mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  localDB.db = previous;
  sqlite.close();
  jest.useRealTimers();
});

test('real provider restores expired offline identity and real SQLite notes remain editable until explicit logout', async () => {
  const view = mount();
  act(() => emit('INITIAL_SESSION', null));
  await act(async () => {});
  expect(auth.setSession).toHaveBeenCalledWith({ access_token: cached.access_token, refresh_token: cached.refresh_token });
  expect(SessionManager.getInstance().isSessionValid(cached)).toBe(false);
  expect(view.getByTestId('provider-owner').props.children).toBe('offline-owner');
  expect(view.getByTestId(inputId).props.value).toBe('saved offline notes');
  fireEvent.changeText(view.getByTestId(inputId), 'edited while offline');
  // A late null initial event must not erase the already-hydrated draft either.
  act(() => emit('INITIAL_SESSION', null));
  await act(async () => { jest.advanceTimersByTime(350); });
  expect(await localDB.getDebriefNotes('offline-owner', 'owned-session')).toEqual(expect.objectContaining({ notes: 'edited while offline' }));
  expect(auth.getSession).not.toHaveBeenCalled();
  expect(localDB.clearAllData).not.toHaveBeenCalled();

  fireEvent.changeText(view.getByTestId(inputId), 'must not save after logout');
  act(() => { emit('SIGNED_OUT', null); jest.advanceTimersByTime(350); });
  await act(async () => {});
  expect(view.queryByTestId(inputId)).toBeNull();
  expect(view.getByTestId('provider-owner').props.children).toBe('signed-out');
  expect(await localDB.getDebriefNotes('offline-owner', 'owned-session')).toEqual(expect.objectContaining({ notes: 'edited while offline' }));
  expect(localDB.clearAllData).toHaveBeenCalledTimes(1);
});

test('invalid refresh credentials do not expose cached-owner notes', async () => {
  auth.setSession.mockResolvedValue({ data: { session: null }, error: { code: 'refresh_token_not_found', status: 400 } });
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  const read = jest.spyOn(localDB, 'getDebriefNotes');
  const view = mount();
  await act(async () => {});
  expect(view.getByTestId('provider-owner').props.children).toBe('signed-out');
  expect(view.queryByTestId(inputId)).toBeNull();
  expect(read).not.toHaveBeenCalled();
  expect(sqlite.prepare('SELECT notes FROM debrief_notes').get()).toEqual({ notes: 'saved offline notes' });
});

test('older B→A→B provider publications cannot restore A notes after the latest SDK identity is B', async () => {
  const read = jest.spyOn(localDB, 'getDebriefNotes');
  const view = mount();
  await act(async () => {});
  expect(view.getByTestId(inputId).props.value).toBe('saved offline notes');
  const gates = Array.from({ length: 3 }, () => {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
  });
  for (const gate of gates) jest.mocked(localDB.clearAllData).mockImplementationOnce(() => gate.promise);
  const b = { ...cached, user: { ...cached.user, id: 'owner-b' } };
  const initialPublication = latestAuth.isAuthStateCurrent;
  expect(initialPublication()).toBe(true);
  try {
    act(() => {
      emit('SIGNED_IN', b);
      emit('SIGNED_IN', cached);
      emit('SIGNED_IN', b);
      jest.advanceTimersByTime(0);
    });
    expect(initialPublication()).toBe(false);
    await act(async () => {});
    expect(view.getByTestId(inputId).props.value).toBe('');
    await act(async () => { gates[0].resolve(); });
    expect(view.getByTestId('provider-owner').props.children).toBe('owner-b');
    expect(latestAuth.isAuthStateCurrent()).toBe(false);
    await act(async () => { gates[1].resolve(); });
    expect(view.getByTestId('provider-owner').props.children).toBe('offline-owner');
    expect(latestAuth.isAuthStateCurrent()).toBe(false);
    // The first matching B was stale. It must not release the guard and let
    // the next stale A publication read private notes or revive its editor.
    expect(read.mock.calls.filter(([owner]) => owner === 'offline-owner')).toHaveLength(1);
    expect(view.getByTestId(inputId).props.value).toBe('');
  } finally {
    await act(async () => { gates.forEach(gate => gate.resolve()); });
  }
  expect(view.getByTestId('provider-owner').props.children).toBe('owner-b');
  expect(latestAuth.isAuthStateCurrent()).toBe(true);
  expect(view.getByTestId(inputId).props.value).toBe('');

  // Once the genuine latest B has caught up, provider-only logout must work.
  auth.signOut.mockResolvedValue({ error: null });
  await act(async () => { await latestAuth.signOut(); });
  expect(latestAuth.isAuthStateCurrent()).toBe(true);
  expect(view.queryByTestId(inputId)).toBeNull();
});

test('same-owner refresh publishes freshness without replacing the draft, then local logout revokes it', async () => {
  const view = mount();
  await act(async () => {});
  const oldPublication = latestAuth.isAuthStateCurrent;
  fireEvent.changeText(view.getByTestId(inputId), 'same-owner pending draft');
  act(() => emit('TOKEN_REFRESHED', cached));
  expect(oldPublication()).toBe(false);
  await act(async () => { jest.advanceTimersByTime(0); });
  expect(latestAuth.isAuthStateCurrent()).toBe(true);
  expect(view.getByTestId(inputId).props.value).toBe('same-owner pending draft');
  // Simulate offline sign-out without an SDK SIGNED_OUT notification.
  auth.signOut.mockResolvedValue({ error: null });
  await act(async () => { await latestAuth.signOut(); });
  expect(latestAuth.isAuthStateCurrent()).toBe(true);
  expect(view.queryByTestId(inputId)).toBeNull();
  await act(async () => { jest.advanceTimersByTime(350); });
  expect(sqlite.prepare('SELECT notes FROM debrief_notes').get()).toEqual({ notes: 'saved offline notes' });
});

test('StrictMode effect replay retains current offline publication and releases both subscriptions', async () => {
  const view = render(<React.StrictMode><AuthProvider><Identity /><SessionNotesSheet sessionId="owned-session" /></AuthProvider></React.StrictMode>);
  await act(async () => {});
  // Each effect subscribed twice but only one provider and one sheet listener remain.
  expect(auth.onAuthStateChange).toHaveBeenCalledTimes(4);
  expect(listeners.size).toBe(2);
  expect(latestAuth.isAuthStateCurrent()).toBe(true);
  expect(view.getByTestId(inputId).props.value).toBe('saved offline notes');
  act(() => emit('INITIAL_SESSION', null));
  expect(latestAuth.isAuthStateCurrent()).toBe(true);
  expect(view.getByTestId(inputId).props.value).toBe('saved offline notes');
  view.unmount();
  expect(listeners.size).toBe(0);
});
