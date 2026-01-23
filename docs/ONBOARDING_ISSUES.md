# Onboarding Visuals - Missing Features & Implementation Guide

**Date:** 2026-01-21  
**Repository:** Form Factor (form-factor-eas)  
**Status:** Analysis Complete - Issues Created

## Executive Summary

The Form Factor app has impressive visual capabilities and complex features but lacks comprehensive visual onboarding. Users are dropped directly into forms without understanding what the app can do or why permissions are needed.

### Current State ✅
- 1 Onboarding Screen: `nutrition-goals.tsx` - Simple calorie/macro goal form
- Navigation Logic: Auto-redirects if nutrition goals aren't set
- Rich Visual Components: Activity rings, health trends, weight dashboards exist (unused in onboarding)

### Critical Gaps ❌
8 major onboarding visual flows are missing (detailed below)

---

## Created GitHub Issues

The following 8 issues were created to track the missing onboarding visuals:

### HIGH PRIORITY (Do First)

#### 1. 🏥 [ONBOARDING] HealthKit Permission Flow Missing
**Priority:** High  
**Labels:** `onboarding`, `ui/ux`, `healthkit`, `high-priority`, `user-experience`

**Problem:**  
The app has deep HealthKit integration (steps, heart rate, weight, sleep data) but lacks visual onboarding for requesting permissions.

**Missing Features:**
- Visual permission request screen with iconography
- Clear explanation of why each permission is needed
- "Why this matters" context for fitness tracking
- Privacy-first messaging
- Granular vs all-at-once permission options
- Permission status UI (granted vs denied)
- Fallback messaging if permissions denied

**Technical Context:**
- File: `contexts/HealthKitContext.tsx` - already has `requestPermissions()` function
- Should integrate with existing HealthKit permission utilities in `lib/services/healthkit`
- Impact: Users confused about why app needs health data, may deny permissions

**Mockup Ideas:**
- Card-based layout explaining each data type (Activity, Heart, Sleep, Weight)
- Toggle switches for granular control
- Progress indicator showing "X/Y permissions granted"
- Preview of what the AI coach can do with each data type

---

#### 2. 📱 [ONBOARDING] ARKit Body Tracking Camera Permission Flow Missing
**Priority:** High  
**Labels:** `onboarding`, `ui/ux`, `arkit`, `camera-permissions`, `high-priority`, `core-feature`

**Problem:**  
The app includes advanced ARKit body tracking features for form analysis but lacks visual onboarding for camera permissions and feature introduction.

**Missing Features:**
- Feature Introduction Screen:
  - What ARKit body tracking does (real-time form analysis)
  - Benefits: rep counting, form correction, progress tracking
  - Sample use cases: checking squat depth, fixing pull-up swing
  - "AI-powered form feedback" showcase
- Camera Permission Flow:
  - Visual request for camera access
  - Explanation of why camera is needed (privacy-first messaging)
  - What the app does NOT do (no storage of video, real-time analysis only)
  - Tips for best tracking results (lighting, positioning)
- Usage Onboarding:
  - Setup tips (camera distance, angle, lighting)
  - Exercise-specific guidance
  - Troubleshooting common issues
  - Safety reminders

**Technical Context:**
- File: `app/(tabs)/scan-arkit.tsx` - 74KB complex implementation
- Requires: `NSCameraUsageDescription` in Info.plist
- ARKit features: body pose detection, form analysis, rep counting, speech synthesis
- Integration with Watch connectivity

**Mockup Ideas:**
- Hero animation showing AR overlay on exercise form
- Before/after form correction examples
- "See your form like a pro" branding
- Progress cards showing improvement over time
- Interactive demo preview (non-camera version)

---

### MEDIUM PRIORITY (Do After High Priority)

#### 3. 🎯 [ONBOARDING] Comprehensive Profile & Goals Setup Flow Missing
**Priority:** Medium  
**Labels:** `onboarding`, `ui/ux`, `profile`, `personalization`, `medium-priority`

**Problem:**  
Current onboarding only covers nutrition goals. Users need a complete profile setup flow including fitness goals, personal metrics, and activity targets.

**Missing Features:**
1. **Personal Metrics Card:**
   - Height (with unit toggle)
   - Current weight (with unit toggle)
   - Date of birth (for age calculations)
   - Biological sex (affects calorie calculations)
   - Why we need this: BMR calculations, goal personalization, progress tracking

2. **Fitness Experience Level:**
   - Beginner (0-1 years training)
   - Intermediate (1-3 years training)
   - Advanced (3+ years training)
   - Pro/Competitive athlete
   - Impact: workout recommendations, progression rate, coach behavior

3. **Primary Fitness Goals** (multi-select):
   - Build muscle/strength
   - Lose weight
   - Improve endurance
   - Better form/technique
   - General fitness
   - Sport-specific training
   - Recovery/injury prevention

4. **Activity Level Assessment:**
   - Sedentary (little to no exercise)
   - Lightly active (1-3 days/week)
   - Moderately active (3-5 days/week)
   - Very active (6-7 days/week)
   - Extremely active (athlete level)

5. **Weekly Workout Frequency Target:**
   - Days per week (1-7)
   - Preferred workout duration
   - Rest day preferences

6. **Preferred Activities** (multi-select):
   - Weightlifting/strength training
   - Cardio (running, cycling, swimming)
   - HIIT/CrossFit
   - Yoga/Pilates
   - Sports (specify)
   - Outdoor activities

**Technical Context:**
- Should extend existing onboarding folder structure
- New screens needed: `personal-info.tsx`, `fitness-goals.tsx`, `activity-preferences.tsx`
- Context updates: AuthContext, NutritionGoalsContext (or new ProfileContext)
- Unit conversion: Already has UnitsContext for imperial/metric toggle
- BMR calculation: Can use Harris-Benedict or Mifflin-St Jeor equation

**Mockup Ideas:**
- Card-based multi-step wizard
- Progress indicator (Step X of Y)
- Confidence-building messaging ("This helps us personalize your experience")
- Skip option with defaults for each step
- Comparison: "Based on your profile, here's your recommended X"

---

#### 4. 📊 [ONBOARDING] Activity Goals Visual Setup Flow Missing
**Priority:** Medium  
**Labels:** `onboarding`, `ui/ux`, `activity-goals`, `visualization`, `medium-priority`

**Problem:**  
The app has beautiful Activity Rings visualization (`components/activity-rings/ActivityRings.tsx`) but no visual onboarding to help users set their daily activity goals.

**Current State:**
- ✅ ActivityRings.tsx component implemented with SVG-based circular progress
- ✅ Shows steps, calories, and exercise minutes
- ✅ Hardcoded goals (steps: 8000, calories: 2000, exercise: 30 min)
- ❌ No visual onboarding to set these goals
- ❌ Goals not customizable during setup
- ❌ No context about what makes good goals

**Missing Features:**
1. **Activity Goals Introduction:**
   - What are activity goals and why they matter
   - How activity rings work (similar to Apple Watch, familiar UX)
   - Benefits of daily goal setting
   - Flexibility: goals can be adjusted anytime

2. **Interactive Goal Setting:**
   - Slider-based adjustment for each goal type
   - Recommendations based on profile (if available)
   - Real-time preview of what the rings will look like
   - Comparison: "Current vs Recommended vs Your Choice"
   - Validation: goals should be achievable but challenging

3. **Goal Categories:**
   - **Steps Goal**: 1,000-20,000+ range with sensible defaults
   - **Active Calories**: 200-1,000+ calorie range
   - **Exercise Minutes**: 10-120+ minute range
   - Optional: Stand hours, movement calories

4. **Goal Context & Education:**
   - Why 10,000 steps? (Science behind it)
   - Recommended exercise minutes per day
   - How to increase goals over time
   - Recovery days and goal adjustment

**Technical Context:**
- Component: `components/ActivityRings.tsx` - already exists, very polished
- Data sources: HealthKitContext, WorkoutsContext, FoodContext, NutritionGoalsContext
- Goals storage: Could extend NutritionGoalsContext or create ActivityGoalsContext
- Reuse SVG ring component from ActivityRings.tsx for interactive sliders

**Mockup Ideas:**
- Hero: Animated activity rings filling up
- Interactive sliders with real-time ring updates
- "Start where you are, not where you think you should be"
- Progress celebration animations when goals achieved
- Weekly/monthly goal history preview

---

#### 5. 📖 [ONBOARDING] App Features Tour/Carousel Missing
**Priority:** Medium  
**Labels:** `onboarding`, `ui/ux`, `feature-tour`, `user-education`, `medium-priority`

**Problem:**  
The app has impressive features (AI coach, ARKit form tracking, health data integration, offline tracking) but no visual feature tour.

**Current State:**
- ✅ Implemented: Offline foods/workouts tracking
- ✅ Implemented: HealthKit summaries and trends
- ✅ Implemented: AI coach backed by OpenAI Edge Function
- ✅ Implemented: Video capture and form feed
- ✅ Implemented: ARKit body tracking (beta)
- ✅ Implemented: Push notifications plumbing
- ✅ Landing page (`app/landing.tsx`) has feature descriptions
- ❌ No in-app feature tour/carousel
- ❌ No onboarding walkthrough of main features
- ❌ No interactive preview of capabilities

**Missing Features:**
1. **Feature Carousel Screens:**

   - **Screen 1: AI Form Coach**
     - Real-time form cues from camera
     - Rep counting and issue flagging
     - Voice feedback during workouts
     - Mockup: AR overlay preview

   - **Screen 2: Smart Food & Workout Logging**
     - Offline-first with sync queue
     - Quick add with search
     - Nutrition goals integration
     - Mockup: Quick add interface preview

   - **Screen 3: Health Data Intelligence**
     - HealthKit integration (steps, HR, sleep)
     - Trend analysis and predictions
     - Correlated insights (sleep → performance)
     - Mockup: Health trends visualization

   - **Screen 4: Progress Tracking**
     - Video form comparisons
     - Weight trends and predictions
     - Achievement milestones
     - Mockup: Progress dashboard preview

2. **Interactive Elements:**
   - "Tap to learn more" on feature cards
   - Skippable with "Get Started" button
   - Progress indicator (1/4, 2/4, etc.)
   - Optional: Enable/disable features during tour

**Technical Context:**
- Landing page (`app/landing.tsx`) has section headers and descriptions we can reuse
- Can create carousel component or reuse existing patterns
- Should be shown on first app launch (check AuthContext for first-time user)

**Mockup Ideas:**
- Swipeable card carousel (like onboarding in popular apps)
- Video previews where applicable (ARKit demo, coach interaction)
- "Tap to try" interactive elements
- Progress dots at bottom
- "I already know this" skip option per card
- Celebration animation when tour complete

---

### LOW PRIORITY (Do After Medium Priority)

#### 6. 🔔 [ONBOARDING] Push Notifications Permission & Preferences Flow Missing
**Priority:** Low  
**Labels:** `onboarding`, `ui/ux`, `notifications`, `permissions`, `low-priority`

**Problem:**  
The app has push notification infrastructure but lacks visual onboarding for permissions and preferences.

**Missing Features:**
- Permission Request Screen with visual request for push notifications
- Clear explanation of notification types (workout reminders, goal achievements, coach tips, etc.)
- Notification Preferences Setup with toggle switches
- Frequency & Timing Controls (Do Not Disturb hours, maximum notifications per day)
- Notification Preview Examples showing sample alerts

**Technical Context:**
- Expo Notifications: `expo-notifications` dependency
- Edge Function: `supabase/functions/notify/`
- Can integrate with existing notification settings in `app/(modals)/notifications.tsx`

**Mockup Ideas:**
- Notification preview cards showing sample alerts
- Toggle switches for each notification type
- Time picker for Do Not Disturb
- "Get motivated" messaging around workout reminders

---

#### 7. ⌚ [ONBOARDING] Apple Watch Setup & Integration Flow Missing
**Priority:** Low  
**Labels:** `onboarding`, `ui/ux`, `watch`, `apple-watch`, `low-priority`

**Problem:**  
The app has Watch connectivity features but lacks visual onboarding for Apple Watch pairing and setup.

**Missing Features:**
- Watch Benefits Introduction explaining what watch integration enables
- Watch Setup Flow with automatic detection, installation status, pairing process
- Watch Features Overview (quick workout start, real-time rep counting sync, heart rate zones)
- Privacy & Data Sharing controls

**Technical Context:**
- Workspace module: `ff-watch-connectivity`
- Functions: `getIsWatchAppInstalled()`, `updateWatchContext()`, `buildWatchTrackingPayload()`
- State management in `app/(tabs)/scan-arkit.tsx`

**Mockup Ideas:**
- Hero image showing watch + phone combo
- Animated connection status indicator
- Step-by-step setup wizard
- "Your watch is ready to train" celebration

---

#### 8. 💾 [ONBOARDING] Offline-First & Data Sync Explanation Flow Missing
**Priority:** Low  
**Labels:** `onboarding`, `ui/ux`, `offline`, `data-sync`, `low-priority`

**Problem:**  
The app uses an offline-first architecture but lacks visual onboarding explaining how data sync works.

**Missing Features:**
- Offline Capabilities Explanation showing what works offline
- Sync Process Explanation (automatic in background, sync status indicator)
- Confidence-Building Messaging ("Works in the gym without signal")
- Troubleshooting section for sync issues

**Technical Context:**
- Local database: `lib/services/database/local-db.ts`
- Sync service: `lib/services/database/sync-service.ts`
- Network context: `contexts/NetworkContext.tsx`

**Mockup Ideas:**
- Animated sync icon showing data flowing
- Status cards: "All synced ✓" or "X items pending"
- Offline mode indicator in header
- "Works offline" badge in feature cards

---

## Visual Components Available but Not Used

The app has beautiful visual components that should be incorporated into onboarding:

- **ActivityRings.tsx** - Could be used to set activity goals visually
- **HealthTrendsView.tsx** - Could show sample data during onboarding
- **WeightDashboard.tsx** - Could be used in profile setup
- **Various chart components** - Could demonstrate data visualization during feature tour

## Implementation Priority Order

### Phase 1: High Priority (Week 1-2)
1. 🏥 HealthKit Permission Flow
2. 📱 ARKit Camera Permission Flow

### Phase 2: Medium Priority (Week 3-4)
3. 🎯 Profile & Goals Setup
4. 📊 Activity Goals Setup
5. 📖 Feature Tour/Carousel

### Phase 3: Low Priority (Week 5+)
6. 🔔 Notifications Setup
7. ⌚ Watch Integration
8. 💾 Data Sync Explanation

## Success Metrics

- Increase in permission grant rates (HealthKit, Camera, Notifications)
- Improved feature discovery (measured by feature usage analytics)
- Reduced support tickets about "how to use" questions
- Improved user engagement metrics (session length, feature adoption)
- Higher user satisfaction scores in app reviews

## Testing Strategy

- A/B test onboarding flows vs. no onboarding
- Measure completion rates for each step
- Track feature adoption after onboarding
- User interviews to understand onboarding effectiveness
- Analytics tracking for drop-off points

## Related Documentation

- `docs/ARKIT_BODY_TRACKING_GUIDE.md`
- `docs/HEALTHKIT_SYNC_AND_TRENDS_GUIDE.md`
- `docs/HEALTHKIT_SYNC_QUICK_START.md`
- Landing page: `app/landing.tsx` (reuse feature descriptions)
- Existing onboarding: `app/(onboarding)/nutrition-goals.tsx` (reference pattern)

---

**Document created:** 2026-01-21  
**Analysis by:** Claude Code (OpenCode)  
**Repository:** slenthekid/form-factor-eas  
**Status:** Ready for implementation
