import { localDB } from './local-db';
import type { SyncQueueItem, SyncTableName } from './sync-types';

/** Queued records belong exclusively to processSyncQueue, even when due. */
export async function getQueuedSyncRecordIds(table: SyncTableName): Promise<Set<string>> {
  const queue = await localDB.getSyncQueue();
  return new Set(queue.filter(item => item.table_name === table).map(item => item.record_id));
}

/** Read-only deadline inspection; not an ownership guard for direct uploads. */
export async function getDeferredSyncRecordIds(table: SyncTableName): Promise<Set<string>> {
  const queue = await localDB.getSyncQueue();
  const newestByRecord = new Map<string, SyncQueueItem>();
  for (const item of queue) {
    if (item.table_name !== table) continue;
    const previous = newestByRecord.get(item.record_id);
    if (!previous || item.id > previous.id) newestByRecord.set(item.record_id, item);
  }

  const now = Date.now();
  const deferred = new Set<string>();
  for (const item of newestByRecord.values()) {
    const dueAt = new Date(item.next_retry_at ?? item.created_at).getTime();
    if (Number.isFinite(dueAt) && dueAt > now) deferred.add(item.record_id);
  }
  return deferred;
}
