# HealthKit Sync & Trends - Quick Start Guide

## 🚀 What's New

You now have a complete HealthKit sync and trends system that:
- **Imports ALL your historical health data** (up to 1+ year)
- **Shows weekly and monthly trends** with percentage changes
- **Stores data in Supabase** for cross-device access
- **Displays real-time sync progress**

## 📱 How to Use

### First Time Setup

1. **Open the app** and navigate to the Health Trends tab
2. **Grant HealthKit permissions** when prompted
3. **Tap "Sync HealthKit Data"** button
4. **Wait for sync to complete** (usually 10-30 seconds for 1 year of data)
5. **View your trends!** Toggle between Daily, Weekly, and Monthly views

### Understanding the Trends Screen

#### Time Range Selector
- **Daily**: Shows today's metrics (steps, weight, heart rate)
- **Weekly**: Shows average steps/day per week with % change from previous week
- **Monthly**: Shows average metrics per month with % change from previous month

#### Metric Cards
Each card shows:
- **Current value**: Today's or period average
- **Change %**: Green (+) means improvement, Red (-) means decrease
- **Icon**: Visual indicator of metric type

#### Quick Insights
Automatically generated insights like:
- "Steps up 12% vs previous period"
- "5 workouts completed"
- "Weight decreased 2.5%"

## 🔧 Using in Your Code

### Trigger a Manual Sync

```typescript
import { useHealthKit } from '@/contexts/HealthKitContext';

function MyComponent() {
  const { syncAllHistoricalData, isSyncing, syncProgress } = useHealthKit();
  
  const handleSync = async () => {
    await syncAllHistoricalData(365); // Sync 1 year
  };
  
  return (
    <View>
      <Button 
        onPress={handleSync} 
        disabled={isSyncing}
        title="Sync HealthKit Data"
      />
      {syncProgress && (
        <Text>
          {syncProgress.phase}: {syncProgress.current}/{syncProgress.total}
        </Text>
      )}
    </View>
  );
}
```

### Check Existing Data

```typescript
const { checkDataRange } = useHealthKit();

const range = await checkDataRange();
console.log(`You have ${range.count} days of synced data`);
console.log(`From ${range.earliest} to ${range.latest}`);
```

### Fetch Aggregated Trends

```typescript
import { fetchHealthTrendData } from '@/lib/services/healthkit';

const trends = await fetchHealthTrendData(userId, 90); // 90 days

// Access different aggregations
console.log('Daily data:', trends.daily);      // Array of daily metrics
console.log('Weekly data:', trends.weekly);    // Array of weekly aggregates
console.log('Monthly data:', trends.monthly);  // Array of monthly aggregates
```

### Get Comparison Metrics

```typescript
import { getComparisonMetrics } from '@/lib/services/healthkit';

const comparison = getComparisonMetrics(trends.weekly, 'weekly');

console.log('Current week avg steps:', comparison.current?.avgSteps);
console.log('Previous week avg steps:', comparison.previous?.avgSteps);
console.log('Change %:', comparison.stepsChange); // e.g., +12.5
```

## 📊 Example: Custom Trends Component

```typescript
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { fetchHealthTrendData, getComparisonMetrics } from '@/lib/services/healthkit';

export function WeeklyStepsTrend() {
  const { user } = useAuth();
  const [weeklyData, setWeeklyData] = useState(null);
  
  useEffect(() => {
    if (!user?.id) return;
    
    const loadData = async () => {
      const trends = await fetchHealthTrendData(user.id, 90);
      const comparison = getComparisonMetrics(trends.weekly, 'weekly');
      setWeeklyData(comparison);
    };
    
    loadData();
  }, [user?.id]);
  
  if (!weeklyData) return <Text>Loading...</Text>;
  
  return (
    <View>
      <Text>This Week: {weeklyData.current?.avgSteps} steps/day</Text>
      <Text>Last Week: {weeklyData.previous?.avgSteps} steps/day</Text>
      <Text>
        Change: {weeklyData.stepsChange >= 0 ? '+' : ''}{weeklyData.stepsChange}%
      </Text>
    </View>
  );
}
```

## 🎯 Best Practices

### When to Trigger Sync

1. **First authorization**: Prompt user immediately after granting HealthKit permissions
2. **Manual button**: Let users trigger sync anytime from settings or trends screen
3. **Background**: Consider daily background sync (not yet implemented)

### Recommended Sync Ranges

- **Initial sync**: 365 days (1 year)
- **Re-sync**: 30-90 days (for recent updates)
- **Full history**: 730 days (2 years) - only if needed

### Performance Tips

1. **Show progress**: Always display sync progress to keep users informed
2. **Disable UI**: Disable actions during sync to prevent conflicts
3. **Handle errors**: Catch and display errors gracefully
4. **Test on device**: Simulator doesn't have real HealthKit data

## 🐛 Troubleshooting

### "No data available"

**Solution**: Tap the "Sync HealthKit Data" button to import your history

### Sync takes too long

**Solution**: Start with 30 days, then sync more as needed

### Metrics don't match HealthKit app

**Check**: 
1. Timezone settings
2. Date range selected
3. Re-sync data to get latest values

### "Sync failed" error

**Try**:
1. Check internet connection
2. Verify Supabase is accessible
3. Check console logs for details
4. Retry sync (it's safe to re-run)

## 📈 What Gets Synced

| Metric | Frequency | Aggregation |
|--------|-----------|-------------|
| Steps | Daily sum | Weekly/monthly averages |
| Weight | Latest per day | Weekly/monthly averages + min/max |
| Heart Rate | Latest per day | Weekly/monthly averages |

## 🔮 Coming Soon

- ✨ Automatic background sync
- 📊 Advanced charts and visualizations  
- 🎯 Goal tracking with predictions
- 📤 Export data to CSV/PDF
- 🔔 Trend alerts and notifications

## 💡 Tips

1. **Sync regularly**: Re-sync weekly to keep data fresh
2. **Check data range**: Use `checkDataRange()` to verify what's synced
3. **Monitor progress**: Watch the progress indicators to ensure sync completes
4. **Use aggregations**: Weekly/monthly views are great for long-term patterns
5. **Export strategy**: All data is in Supabase `health_metrics` table

## 🏗️ Architecture Overview

```
User Action → HealthKit Context → Bulk Sync Service → Supabase
                                          ↓
                                   Progress Updates
                                          ↓
Trends Screen ← Aggregation Service ← health_metrics table
```

## 📝 Key Files

- `lib/services/healthkit/health-bulk-sync.ts` - Bulk sync logic
- `lib/services/healthkit/health-aggregation.ts` - Weekly/monthly aggregations
- `contexts/HealthKitContext.tsx` - React context with sync state
- `app/(tabs)/health-trends.tsx` - Trends UI screen
- `supabase/migrations/002_create_health_metrics_table.sql` - Database schema

## ✅ Checklist: First Sync

- [ ] Grant HealthKit read permissions
- [ ] Tap "Sync HealthKit Data" button
- [ ] Wait for "Sync complete!" message
- [ ] Toggle to Weekly view
- [ ] Verify metrics show data
- [ ] Check for % change indicators
- [ ] View Quick Insights section

## 🎉 You're All Set!

Your health data is now synced and you can view comprehensive trends. The data will persist in Supabase and sync across devices when you sign in.

For more details, see `docs/HEALTHKIT_SYNC_AND_TRENDS_GUIDE.md`.

