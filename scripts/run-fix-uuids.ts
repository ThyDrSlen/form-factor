#!/usr/bin/env bun
/**
 * Executable script to fix invalid UUIDs
 * Run with: bun scripts/run-fix-uuids.ts
 */

import fixInvalidUUIDs from './fix-invalid-uuids';

async function main() {
  console.log('🔧 Starting UUID cleanup...\n');
  
  const result = await fixInvalidUUIDs();
  
  console.log('\n📊 Results:');
  console.log('─────────────────────────────');
  console.log(`✓ Workouts removed: ${result.workoutsRemoved}`);
  console.log(`✓ Foods removed: ${result.foodsRemoved}`);
  console.log(`✓ Queue items cleared: ${result.queueCleared}`);
  console.log(`✓ Success: ${result.success ? 'YES ✅' : 'NO ❌'}`);
  
  if (result.error) {
    console.log(`✗ Error: ${result.error}`);
  }
  
  console.log('─────────────────────────────\n');
  
  process.exit(result.success ? 0 : 1);
}

main();

