/**
 * Fix Invalid UUIDs - Production Cleanup Script
 * 
 * This script:
 * 1. Finds all records with invalid UUID format
 * 2. Deletes them from local DB (they can't sync to Supabase anyway)
 * 3. Clears the corrupted sync queue
 * 4. Triggers a fresh sync
 * 
 * Run this ONCE to clean up old data before production release.
 */

import { localDB } from '../lib/services/database/local-db';
import { syncService } from '../lib/services/database/sync-service';

// UUID regex pattern (standard UUID format)
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(id: string): boolean {
  return UUID_PATTERN.test(id);
}

export async function fixInvalidUUIDs() {
  try {
    console.log('[FixUUIDs] 🔧 Starting UUID cleanup...');
    
    // Step 1: Check workouts for invalid UUIDs
    console.log('[FixUUIDs] Checking workouts...');
    const workouts = await localDB.getAllWorkouts();
    const invalidWorkouts = workouts.filter(w => !isValidUUID(w.id));
    
    console.log(`[FixUUIDs] Found ${invalidWorkouts.length} workouts with invalid UUIDs`);
    if (invalidWorkouts.length > 0) {
      console.log('[FixUUIDs] Invalid workout IDs:', invalidWorkouts.map(w => w.id));
      
      // Delete them (they can't sync to Supabase anyway)
      for (const workout of invalidWorkouts) {
        await localDB.hardDeleteWorkout(workout.id);
        console.log(`[FixUUIDs] ❌ Deleted workout with invalid ID: ${workout.id}`);
      }
    }
    
    // Step 2: Check foods for invalid UUIDs
    console.log('[FixUUIDs] Checking foods...');
    const foods = await localDB.getAllFoods();
    const invalidFoods = foods.filter(f => !isValidUUID(f.id));
    
    console.log(`[FixUUIDs] Found ${invalidFoods.length} foods with invalid UUIDs`);
    if (invalidFoods.length > 0) {
      console.log('[FixUUIDs] Invalid food IDs:', invalidFoods.map(f => f.id));
      
      // Delete them
      for (const food of invalidFoods) {
        await localDB.hardDeleteFood(food.id);
        console.log(`[FixUUIDs] ❌ Deleted food with invalid ID: ${food.id}`);
      }
    }
    
    // Step 3: Clear sync queue (contains references to deleted items)
    console.log('[FixUUIDs] Clearing sync queue...');
    const queue = await localDB.getSyncQueue();
    console.log(`[FixUUIDs] Found ${queue.length} items in sync queue`);
    
    await syncService.clearSyncQueue();
    console.log('[FixUUIDs] ✅ Sync queue cleared');
    
    // Step 4: Trigger fresh sync with valid data only
    console.log('[FixUUIDs] Syncing valid data to Supabase...');
    await syncService.syncToSupabase();
    console.log('[FixUUIDs] ✅ Fresh sync completed');
    
    // Summary
    console.log('[FixUUIDs] ═══════════════════════════════════');
    console.log('[FixUUIDs] ✅ Cleanup Complete!');
    console.log(`[FixUUIDs] ❌ Removed ${invalidWorkouts.length} invalid workouts`);
    console.log(`[FixUUIDs] ❌ Removed ${invalidFoods.length} invalid foods`);
    console.log(`[FixUUIDs] 🧹 Cleared ${queue.length} sync queue items`);
    console.log('[FixUUIDs] ✅ All new records will use proper UUIDs');
    console.log('[FixUUIDs] ═══════════════════════════════════');
    
    return {
      success: true,
      workoutsRemoved: invalidWorkouts.length,
      foodsRemoved: invalidFoods.length,
      queueCleared: queue.length,
    };
  } catch (error) {
    console.error('[FixUUIDs] ❌ Error during cleanup:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Export for use in debug menu or DevTools
export default fixInvalidUUIDs;

