import React from 'react';
import { DatabaseSync } from 'node:sqlite';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { SessionNotesSheet } from '@/features/form-tracking/components/debrief/SessionNotesSheet';
import { localDB } from '@/lib/services/database/local-db';
import { supabase } from '@/lib/supabase';
import { warnWithTs } from '@/lib/logger';

let mockOwner: string | null = 'owner-a';
let mockProviderOwner: string | null = 'owner-a';
const mockIsAuthStateCurrent = () => true;
jest.mock('@/features/auth/contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockProviderOwner ? { id: mockProviderOwner } : null, isAuthStateCurrent: mockIsAuthStateCurrent }),
}));
let mockListener: ((event: string, session: { user: { id: string } } | null) => void) | undefined;
const mockUnsubscribe = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { auth: {
  getSession: jest.fn(async () => ({ data: { session: mockOwner ? { user: { id: mockOwner } } : null }, error: null })),
  onAuthStateChange: jest.fn(listener => {
    mockListener = listener;
    return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
  }),
} } }));
jest.mock('@/lib/services/database/local-db', () => ({ localDB: {
  getDebriefNotes: jest.fn(), saveDebriefNotes: jest.fn(),
} }));
jest.mock('@/lib/logger', () => ({ warnWithTs: jest.fn(), logWithTs: jest.fn(), errorWithTs: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const inputId = 'session-notes-sheet-notes-input';
const saved = { sessionId: 'session-a', notes: 'private notes A', starredFaultIds: ['depth'], savedCues: true, updatedAt: '2026-01-01' };
function changeOwner(owner: string | null) {
  mockOwner = owner;
  mockListener?.(owner ? 'SIGNED_IN' : 'SIGNED_OUT', owner ? { user: { id: owner } } : null);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { await act(async () => {}); }

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockOwner = 'owner-a';
  mockProviderOwner = 'owner-a';
  mockListener = undefined;
  jest.mocked(localDB.getDebriefNotes).mockReset().mockResolvedValue(saved);
  jest.mocked(localDB.saveDebriefNotes).mockReset();
});
afterEach(() => { cleanup(); jest.useRealTimers(); });

test('signed-out notes neither read nor save persisted session data', async () => {
  mockOwner = null;
  mockProviderOwner = null;
  const view = render(<SessionNotesSheet sessionId="session-a" />);
  await flush();
  expect(localDB.getDebriefNotes).not.toHaveBeenCalled();
  expect(view.queryByTestId(inputId)).toBeNull();
  expect(localDB.saveDebriefNotes).not.toHaveBeenCalled();
});

test('provider-retained offline identity can read and save despite null SDK INITIAL_SESSION', async () => {
  mockOwner = null;
  jest.mocked(localDB.saveDebriefNotes).mockResolvedValue(true);
  const view = render(<SessionNotesSheet sessionId="session-a" />);
  act(() => mockListener?.('INITIAL_SESSION', null));
  await flush();
  expect(supabase.auth.getSession).not.toHaveBeenCalled();
  expect(localDB.getDebriefNotes).toHaveBeenCalledWith('owner-a', 'session-a', expect.any(Function));
  expect(view.getByTestId(inputId).props.value).toBe(saved.notes);
  fireEvent.changeText(view.getByTestId(inputId), 'offline edit');
  await act(async () => { jest.advanceTimersByTime(350); });
  expect(localDB.saveDebriefNotes).toHaveBeenCalledWith('owner-a', 'session-a', 'offline edit', ['depth'], true, expect.any(Function));
});

test('an auth event wins over a delayed provider bootstrap identity', async () => {
  mockProviderOwner = null;
  mockOwner = null;
  const view = render(<SessionNotesSheet sessionId="session-a" />);
  act(() => changeOwner('owner-b'));
  await flush();
  mockProviderOwner = 'owner-a';
  view.rerender(<SessionNotesSheet sessionId="session-a" />);
  await flush();
  expect(localDB.getDebriefNotes).toHaveBeenCalledTimes(1);
  expect(localDB.getDebriefNotes).toHaveBeenCalledWith('owner-b', 'session-a', expect.any(Function));
});

test('delayed offline provider restoration hydrates without an SDK session', async () => {
  mockOwner = null;
  mockProviderOwner = null;
  const view = render(<SessionNotesSheet sessionId="session-a" />);
  act(() => mockListener?.('INITIAL_SESSION', null));
  await flush();
  expect(localDB.getDebriefNotes).not.toHaveBeenCalled();
  mockProviderOwner = 'owner-a';
  view.rerender(<SessionNotesSheet sessionId="session-a" />);
  await flush();
  expect(view.getByTestId(inputId).props.value).toBe(saved.notes);
  expect(supabase.auth.getSession).not.toHaveBeenCalled();
});

test('StrictMode effect replay retains offline access and invalidates guards on unmount', async () => {
  mockOwner = null;
  jest.mocked(localDB.saveDebriefNotes).mockResolvedValue(true);
  const view = render(<React.StrictMode><SessionNotesSheet sessionId="session-a" /></React.StrictMode>);
  await flush();
  expect(view.getByTestId(inputId).props.value).toBe(saved.notes);
  fireEvent.changeText(view.getByTestId(inputId), 'strict offline draft');
  await act(async () => { jest.advanceTimersByTime(350); });
  expect(localDB.saveDebriefNotes).toHaveBeenCalledTimes(1);
  const guard = jest.mocked(localDB.saveDebriefNotes).mock.calls[0][5];
  expect(guard?.()).toBe(true);
  view.unmount();
  expect(guard?.()).toBe(false);
});

test('signed-out event prevents delayed offline provider restoration from resurrecting notes', async () => {
  mockOwner = null;
  mockProviderOwner = null;
  const view = render(<SessionNotesSheet sessionId="session-a" />);
  act(() => changeOwner(null));
  mockProviderOwner = 'owner-a';
  view.rerender(<SessionNotesSheet sessionId="session-a" />);
  await flush();
  expect(localDB.getDebriefNotes).not.toHaveBeenCalled();
  expect(view.queryByTestId(inputId)).toBeNull();
});

test.each(['signed-out', 'foreign', 'round-trip'] as const)('%s synchronously cancels a pending autosave', async transition => {
  jest.mocked(localDB.saveDebriefNotes).mockResolvedValue(true);
  const view = render(<SessionNotesSheet sessionId="session-a" />);
  await flush();
  fireEvent.changeText(view.getByTestId(inputId), 'unsaved A');
  // Deliver the timer before React has committed effect cleanup. Auth lifetime
  // must be invalidated synchronously, not only during the next render.
  act(() => {
    changeOwner(transition === 'signed-out' ? null : 'owner-b');
    if (transition === 'round-trip') changeOwner('owner-a');
    jest.advanceTimersByTime(350);
  });
  await flush();
  expect(localDB.saveDebriefNotes).not.toHaveBeenCalled();
  if (transition === 'signed-out') expect(view.queryByTestId(inputId)).toBeNull();
  else expect(view.getByTestId(inputId).props.value).not.toBe('unsaved A');
});

test('A→B→A cancels an old hydration even if React batches both auth events', async () => {
  const gate = deferred<typeof saved | null>();
  jest.mocked(localDB.getDebriefNotes).mockReturnValueOnce(gate.promise).mockResolvedValue({ ...saved, notes: 'new lifetime' });
  const view = render(<SessionNotesSheet sessionId="session-a" />);
  await flush();
  act(() => { changeOwner('owner-b'); changeOwner('owner-a'); });
  await flush();
  await act(async () => { gate.resolve(saved); });
  expect(view.getByTestId(inputId).props.value).toBe('new lifetime');
  const guard = jest.mocked(localDB.getDebriefNotes).mock.calls[0][2];
  expect(guard?.()).toBe(false);
});

test.each(['pending', 'failed'])('a %s hydration cannot accept edits that overwrite unread notes', async state => {
  const gate = deferred<typeof saved | null>();
  jest.mocked(localDB.getDebriefNotes).mockReturnValueOnce(gate.promise);
  jest.mocked(localDB.saveDebriefNotes).mockResolvedValue(true);
  const view = render(<SessionNotesSheet sessionId="session-a" topFaults={[{ id: 'depth', label: 'Depth' }]} />);
  await flush();
  if (state === 'failed') await act(async () => { gate.reject(new Error('storage unavailable')); });
  fireEvent.changeText(view.getByTestId(inputId), 'overwrite');
  act(() => jest.advanceTimersByTime(350));
  await flush();
  expect(localDB.saveDebriefNotes).not.toHaveBeenCalled();
  expect(view.getByTestId(inputId).props.editable).toBe(false);
  expect(view.getByTestId('session-notes-sheet-save-cues-toggle').props.disabled).toBe(true);
  expect(view.getByTestId('session-notes-sheet-fault-depth').props.accessibilityState.disabled).toBe(true);
  if (state === 'failed') expect(view.getByText('Notes could not be loaded. Reopen this session to retry.')).toBeTruthy();
});

test('authorized hydrated notes autosave under the captured owner and lifetime', async () => {
  jest.mocked(localDB.saveDebriefNotes).mockResolvedValue(true);
  const view = render(<SessionNotesSheet sessionId="session-a" />);
  await flush();
  expect(view.getByTestId(inputId).props.value).toBe(saved.notes);
  fireEvent.changeText(view.getByTestId(inputId), 'latest edit');
  act(() => jest.advanceTimersByTime(349));
  expect(localDB.saveDebriefNotes).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(1));
  await flush();
  expect(localDB.saveDebriefNotes).toHaveBeenCalledWith('owner-a', 'session-a', 'latest edit', ['depth'], true, expect.any(Function));
  const guard = jest.mocked(localDB.saveDebriefNotes).mock.calls[0][5];
  expect(guard?.()).toBe(true);
  act(() => changeOwner('owner-b'));
  await flush();
  expect(guard?.()).toBe(false);
});

test('same-owner token refresh retains the editable draft and its pending save', async () => {
  jest.mocked(localDB.saveDebriefNotes).mockResolvedValue(true);
  const view = render(<SessionNotesSheet sessionId="session-a" />);
  await flush();
  fireEvent.changeText(view.getByTestId(inputId), 'draft');
  act(() => mockListener?.('TOKEN_REFRESHED', { user: { id: 'owner-a' } }));
  act(() => jest.advanceTimersByTime(350));
  await flush();
  expect(localDB.getDebriefNotes).toHaveBeenCalledTimes(1);
  expect(localDB.saveDebriefNotes).toHaveBeenCalledTimes(1);
  expect(view.getByTestId(inputId).props.value).toBe('draft');
});

test('same-owner refresh does not block a subsequent provider-only revocation', async () => {
  jest.mocked(localDB.saveDebriefNotes).mockResolvedValue(true);
  const view = render(<SessionNotesSheet sessionId="session-a" />);
  await flush();
  fireEvent.changeText(view.getByTestId(inputId), 'must be cancelled');
  act(() => mockListener?.('TOKEN_REFRESHED', { user: { id: 'owner-a' } }));
  mockProviderOwner = null;
  view.rerender(<SessionNotesSheet sessionId="session-a" />);
  await act(async () => { jest.advanceTimersByTime(350); });
  expect(view.queryByTestId(inputId)).toBeNull();
  expect(localDB.saveDebriefNotes).not.toHaveBeenCalled();
});

test('a newer draft invalidates an already-started save before the next debounce fires', async () => {
  const first = deferred<boolean>();
  jest.mocked(localDB.saveDebriefNotes).mockReturnValueOnce(first.promise).mockResolvedValue(true);
  const view = render(<SessionNotesSheet sessionId="session-a" />);
  await flush();
  fireEvent.changeText(view.getByTestId(inputId), 'first draft');
  act(() => jest.advanceTimersByTime(350));
  const guard = jest.mocked(localDB.saveDebriefNotes).mock.calls[0][5];
  expect(guard?.()).toBe(true);
  fireEvent.changeText(view.getByTestId(inputId), 'newer draft');
  expect(guard?.()).toBe(false);
  act(() => jest.advanceTimersByTime(350));
  await flush();
  expect(jest.mocked(localDB.saveDebriefNotes).mock.calls[1][5]?.()).toBe(true);
  await act(async () => { first.reject(new Error('outdated save failed')); });
  expect(warnWithTs).not.toHaveBeenCalled();
});

test.each(['rejected', 'failed'])('a %s current save is visible and a later edit can retry', async failure => {
  jest.mocked(localDB.saveDebriefNotes).mockImplementationOnce(async () => {
    if (failure === 'failed') throw new Error('storage unavailable');
    return false;
  }).mockResolvedValue(true);
  const view = render(<SessionNotesSheet sessionId="session-a" />);
  await flush();
  fireEvent.changeText(view.getByTestId(inputId), 'draft');
  await act(async () => { jest.advanceTimersByTime(350); });
  expect(view.getByText('Notes were not saved. Edit your notes to retry.')).toBeTruthy();
  fireEvent.changeText(view.getByTestId(inputId), 'retry draft');
  await act(async () => { jest.advanceTimersByTime(350); });
  expect(view.queryByText('Notes were not saved. Edit your notes to retry.')).toBeNull();
});

test('session changes reset every draft field and invalidate already-started saves', async () => {
  const write = deferred<boolean>();
  jest.mocked(localDB.saveDebriefNotes).mockReturnValueOnce(write.promise);
  const view = render(<SessionNotesSheet sessionId="session-a" />);
  await flush();
  fireEvent.changeText(view.getByTestId(inputId), 'old-session draft');
  act(() => jest.advanceTimersByTime(350));
  const guard = jest.mocked(localDB.saveDebriefNotes).mock.calls[0][5];
  jest.mocked(localDB.getDebriefNotes).mockResolvedValueOnce(null);
  view.rerender(<SessionNotesSheet sessionId="session-new" />);
  await flush();
  expect(guard?.()).toBe(false);
  expect(view.getByTestId(inputId).props.value).toBe('');
  expect(view.getByTestId('session-notes-sheet-save-cues-toggle').props.value).toBe(false);
  await act(async () => { write.reject(new Error('retired write')); });
  expect(warnWithTs).not.toHaveBeenCalled();
});

test('unmount invalidates hydration and unsubscribes without stale errors', async () => {
  const gate = deferred<typeof saved | null>();
  jest.mocked(localDB.getDebriefNotes).mockReturnValueOnce(gate.promise);
  const view = render(<SessionNotesSheet sessionId="session-a" />);
  await flush();
  const guard = jest.mocked(localDB.getDebriefNotes).mock.calls[0][2];
  view.unmount();
  expect(guard?.()).toBe(false);
  await act(async () => { gate.reject(new Error('retired read')); });
  expect(warnWithTs).not.toHaveBeenCalled();
  expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
});

test('the rendered autosave guard blocks actual SQLite execution after A→B→A during preparation', async () => {
  const actualDB = jest.requireActual<typeof import('@/lib/services/database/local-db')>('@/lib/services/database/local-db').localDB;
  const previous = actualDB.db;
  const sqlite = new DatabaseSync(':memory:');
  const prepared = deferred<void>();
  const release = deferred<void>();
  const executed = jest.fn();
  const finalized = jest.fn(async () => undefined);
  type Bind = string | number | null;
  Object.assign(actualDB, { db: {
    execAsync: async (sql: string) => sqlite.exec(sql),
    getAllAsync: async (sql: string, args: Bind[] = []) => sqlite.prepare(sql).all(...args),
    getFirstAsync: async (sql: string, args: Bind[] = []) => sqlite.prepare(sql).get(...args) ?? null,
    prepareAsync: async (sql: string) => {
      const statement = sqlite.prepare(sql);
      prepared.resolve();
      await release.promise;
      return {
        executeAsync: async (args: Bind[]) => { executed(); return statement.run(...args); },
        finalizeAsync: finalized,
      };
    },
  } });
  try {
    await (actualDB as unknown as { createTables(): Promise<void> }).createTables();
    sqlite.prepare('INSERT INTO workout_sessions (id, user_id, started_at, deleted) VALUES (?, ?, ?, 0)')
      .run('session-a', 'owner-a', '2026-01-01');
    sqlite.prepare('INSERT INTO debrief_notes (session_id, notes, starred_fault_ids, saved_cues, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('session-a', saved.notes, JSON.stringify(saved.starredFaultIds), 1, saved.updatedAt);
    const before = sqlite.prepare('SELECT * FROM debrief_notes').all();
    jest.mocked(localDB.getDebriefNotes).mockImplementation(actualDB.getDebriefNotes.bind(actualDB));
    jest.mocked(localDB.saveDebriefNotes).mockImplementation(actualDB.saveDebriefNotes.bind(actualDB));
    const view = render(<SessionNotesSheet sessionId="session-a" />);
    await flush();
    fireEvent.changeText(view.getByTestId(inputId), 'retired edit');
    await act(async () => { jest.advanceTimersByTime(350); await prepared.promise; });
    act(() => { changeOwner('owner-b'); changeOwner('owner-a'); });
    await flush();
    await act(async () => { release.resolve(); });
    expect(executed).not.toHaveBeenCalled();
    expect(finalized).toHaveBeenCalledTimes(1);
    expect(sqlite.prepare('SELECT * FROM debrief_notes').all()).toEqual(before);
    expect(view.getByTestId(inputId).props.value).toBe(saved.notes);
    // The fresh owner lifetime can still save; rejection did not poison DB state.
    fireEvent.changeText(view.getByTestId(inputId), 'current edit');
    await act(async () => { jest.advanceTimersByTime(350); });
    expect(executed).toHaveBeenCalledTimes(1);
    expect(await actualDB.getDebriefNotes('owner-a', 'session-a')).toEqual(expect.objectContaining({ notes: 'current edit' }));
    view.unmount();
  } finally {
    cleanup();
    actualDB.db = previous;
    sqlite.close();
  }
});
