/**
 * Script to clear stuck sync queue items
 * 
 * Run this if you see errors like:
 * - "Could not find the 'deleted' column"
 * - "Max retries reached for queue item"
 * 
 * Usage:
 * 1. Import and call from your app's debug menu
 * 2. Or run via React DevTools console
 */

import { syncService } from '../lib/services/database/sync-service';
import { localDB } from '../lib/services/database/local-db';

export async function clearSyncQueue() {
  try {
    console.log('[ClearSyncQueue] Starting cleanup...');
    
    // Check current queue status
    const queue = await localDB.getSyncQueue();
    console.log(`[ClearSyncQueue] Found ${queue.length} items in queue`);
    
    // Log what we're clearing
    if (queue.length > 0) {
      console.log('[ClearSyncQueue] Items to clear:');
      queue.forEach((item: any) => {
        console.log(`  - ${item.table_name} ${item.operation} (ID: ${item.record_id}, retries: ${item.retry_count})`);
      });
    }
    
    // Clear the queue
    await syncService.clearSyncQueue();
    console.log('[ClearSyncQueue] ✅ Queue cleared successfully');
    
    // Trigger a fresh sync
    console.log('[ClearSyncQueue] Triggering fresh sync...');
    await syncService.syncToSupabase();
    console.log('[ClearSyncQueue] ✅ Fresh sync completed');
    
    console.log('[ClearSyncQueue] ✅ All done!');
    return true;
  } catch (error) {
    console.error('[ClearSyncQueue] ❌ Error:', error);
    return false;
  }
}

// Export for use in debug menu or DevTools
export default clearSyncQueue;

