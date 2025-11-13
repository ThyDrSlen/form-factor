# Product Requirements Document (PRD)
## Form Factor - Fitness Tracking & Form Analysis App

**Version:** 1.0  
**Last Updated:** January 2025  
**Status:** MVP Development

---

## 1. Executive Summary

**Form Factor** is a cross-platform fitness tracking application that combines
traditional workout and nutrition logging with advanced AI-powered form
analysis using ARKit body tracking. The app enables users to track their
fitness journey, analyze exercise form in real-time, and gain insights from
their health data.

### Key Value Propositions
- **Real-time form analysis** using ARKit body tracking for iOS devices
- **Comprehensive fitness tracking** (workouts, nutrition, health metrics)
- **Offline-first architecture** with seamless cloud sync
- **HealthKit integration** for automatic health data import
- **Data-driven insights** with trends, predictions, and analytics

### Target Platforms
- **Primary:** iOS (iPhone XS and later with ARKit support)
- **Secondary:** Web (read-only dashboards and feeds)
- **Future:** Android (Phase 2)

---

## 2. Product Overview

### 2.1 Problem Statement

Fitness enthusiasts struggle with:
- **Form correction:** No real-time feedback during exercises
- **Data fragmentation:** Health data scattered across multiple apps
- **Offline limitations:** Most apps require constant internet connectivity
- **Lack of insights:** Raw data without meaningful analysis and trends

### 2.2 Solution

Form Factor provides:
1. **On-device ARKit body tracking** for real-time exercise form analysis
2. **Unified fitness platform** combining workouts, nutrition, and health metrics
3. **Offline-first architecture** with automatic cloud synchronization
4. **Advanced analytics** with trends, predictions, and personalized insights

### 2.3 Target Users

**Primary Personas:**
- **Fitness Enthusiasts** (18-45 years old)
  - Regular gym-goers seeking form improvement
  - Tech-savvy users comfortable with AR technology
  - iOS device owners (iPhone XS+)

- **Health-Conscious Individuals** (18-50 years old)
  - Users tracking nutrition and workouts
  - HealthKit users wanting unified health dashboard
  - People seeking data-driven health insights

**Secondary Personas:**
- Personal trainers (future: client management features)
- Athletes tracking performance metrics

---

## 3. Core Features

### 3.1 Authentication & User Management ✅ (Partial)

**Status:** Google Sign-In implemented, additional methods in progress

**Features:**
- [x] Google Sign-In (OAuth)
- [ ] Apple Sign-In (native iOS)
- [ ] Email/Password authentication
- [ ] Magic Link authentication
- [ ] Session management
- [ ] Password recovery
- [ ] Account deletion

**User Profile:**
- Display name, email, avatar
- Health data permissions
- Fitness goals and preferences
- Privacy settings

**Tech Stack:**
- Supabase Auth
- `expo-apple-authentication`
- `expo-auth-session`

---

### 3.2 Workout Tracking ✅ (Core Features)

**Status:** Basic workout logging implemented

**Current Features:**
- [x] Create workout entries
- [x] Log exercises with sets, reps, weight
- [x] Workout history list view
- [x] Offline support with local SQLite storage
- [x] Automatic sync with Supabase

**Planned Features:**
- [ ] Exercise database with search
- [ ] Supersets and circuit training
- [ ] Rest timer
- [ ] Voice notes for workouts
- [ ] Calendar integration
- [ ] Progress photos
- [ ] Personal records (PR) tracking
- [ ] Workout templates/routines
- [ ] Export functionality (CSV, PDF)

**Data Model:**
- Workout sessions (date, duration, notes)
- Exercise entries (exercise name, sets, reps, weight)
- Form analysis snapshots (ARKit joint angles)
- Performance metrics (volume, intensity)

**Tech Stack:**
- Expo SQLite (local storage)
- Supabase PostgreSQL (cloud storage)
- Supabase Realtime (live sync)

---

### 3.3 Nutrition Tracking ✅ (Core Features)

**Status:** Basic food logging implemented

**Current Features:**
- [x] Create food entries
- [x] Log meals with basic nutrition info
- [x] Food history list view
- [x] Offline support with local SQLite storage
- [x] Automatic sync with Supabase

**Planned Features:**
- [ ] Barcode scanner for packaged foods
- [ ] Food database integration (USDA, Nutritionix)
- [ ] Custom food creation
- [ ] Meal templates
- [ ] Daily macro goals tracking
- [ ] Meal timing and scheduling
- [ ] Water intake tracking
- [ ] Supplement logging
- [ ] Nutrition insights and recommendations

**Data Model:**
- Food entries (name, calories, macros, serving size)
- Meal entries (time, foods, total macros)
- Daily nutrition summaries
- Macro goals and targets

**Tech Stack:**
- Expo SQLite (local storage)
- Supabase PostgreSQL (cloud storage)
- Supabase Realtime (live sync)

---

### 3.4 ARKit Body Tracking & Form Analysis ✅ (Advanced Feature)

**Status:** ARKit integration implemented for iOS

**Features:**
- [x] ARKit body tracking session initialization
- [x] Real-time 3D joint detection (91 joints)
- [x] Joint angle calculations
- [x] Visual skeleton overlay
- [x] Form analysis for exercises
- [x] Camera controls (zoom, focus, flip)
- [x] Device compatibility check

**Capabilities:**
- **91 tracked joints** including full body, hands, and spine
- **3D world-space coordinates** in meters
- **Real-time angle calculations** for form analysis
- **Visual feedback** with skeleton overlay
- **Exercise-specific form checks** (squats, deadlifts, etc.)

**Supported Devices:**
- iPhone XS and later (A12 Bionic chip+)
- iPad Pro 11" (2018) and later
- Requires iOS 13.0+

**Tech Stack:**
- Custom ARKit native module (`arkit-body-tracker`)
- `react-native-vision-camera` for camera access
- Swift ARKit APIs (`ARBodyTrackingConfiguration`, `ARBodyAnchor`)

**Future Enhancements:**
- [ ] Exercise-specific form validation rules
- [ ] Audio feedback for form corrections
- [ ] Form score calculation
- [ ] Video recording with form overlay
- [ ] Comparison with previous sessions
- [ ] Personalized form recommendations

---

### 3.5 HealthKit Integration ✅ (Implemented)

**Status:** Full HealthKit sync and trends implemented

**Features:**
- [x] HealthKit permission requests
- [x] Historical data import (up to 1+ year)
- [x] Real-time sync progress tracking
- [x] Data storage in Supabase
- [x] Weekly and monthly trends
- [x] Percentage change calculations
- [x] Quick insights generation

**Tracked Metrics:**
- Steps (daily, weekly, monthly averages)
- Weight (with trends and predictions)
- Heart rate (resting, active)
- Active calories
- Workout sessions
- Sleep data (future)

**Dashboard Components:**
- Activity rings (steps, calories, workouts)
- Weight dashboard with charts
- Health trends with time range selector
- Quick insights and recommendations

**Tech Stack:**
- `react-native-health` for HealthKit access
- Supabase for data storage
- React Native Chart Kit for visualizations

**Future Enhancements:**
- [ ] Sleep tracking integration
- [ ] Body composition metrics
- [ ] VO2 max tracking
- [ ] Recovery metrics
- [ ] Health goal setting

---

### 3.6 Health Trends & Analytics ✅ (Implemented)

**Status:** Comprehensive trends system implemented

**Features:**
- [x] Daily, weekly, monthly views
- [x] Percentage change indicators
- [x] Weight trend charts
- [x] Weight predictions
- [x] Weight statistics (min, max, average)
- [x] Weight goals tracking
- [x] Quick insights generation

**Analytics Components:**
- **Weight Dashboard:**
  - Trend chart with time range selection
  - Statistics card (current, min, max, average)
  - Goals tracking
  - Predictions based on trends
  - Insights and recommendations

- **Health Trends:**
  - Time range selector (Daily/Weekly/Monthly)
  - Metric cards with change indicators
  - Quick insights panel
  - Sync status indicator

**Tech Stack:**
- React Native Chart Kit
- Custom chart components
- Supabase for data aggregation

**Future Enhancements:**
- [ ] Strength progression charts
- [ ] Volume trends (workout volume over time)
- [ ] Recovery metrics analysis
- [ ] Custom report generation
- [ ] Export to PDF/CSV

---

### 3.7 Offline-First Architecture ✅ (Implemented)

**Status:** Complete offline support with sync

**Features:**
- [x] Local SQLite database for instant access
- [x] Network detection and status monitoring
- [x] Automatic sync when network available
- [x] Supabase Realtime for live updates
- [x] Conflict resolution with retry logic
- [x] Soft-delete strategy for data integrity
- [x] Sync queue for failed operations
- [x] Sync progress indicators

**Sync Strategy:**
- **Bidirectional sync:** Local ↔ Supabase
- **Conflict resolution:** Last-write-wins with retry
- **Soft deletes:** Deleted items marked, not removed
- **Queue system:** Failed operations queued for retry
- **Real-time updates:** Supabase Realtime websockets

**Tech Stack:**
- `expo-sqlite` for local database
- `expo-network` for network detection
- Supabase Realtime for live sync
- Custom sync service with retry logic

---

### 3.8 Dashboard & Home Screen ✅ (Implemented)

**Status:** Core dashboard implemented

**Features:**
- [x] Welcome message with user name
- [x] Quick action cards (Log Workout, Log Meal)
- [x] Weekly statistics (workouts, meals)
- [x] Health metrics from HealthKit
- [x] Activity rings display
- [x] Navigation to key features

**Components:**
- Dashboard Health (ActivityRings, health metrics)
- Quick Actions (Workout, Food logging)
- Weekly Stats (Workouts, Meals logged)
- Health Summary (from HealthKit)

**Future Enhancements:**
- [ ] Customizable dashboard widgets
- [ ] Achievement badges
- [ ] Streak tracking
- [ ] Personalized recommendations
- [ ] Recent activity feed

---

### 3.9 Profile & Settings ✅ (Basic)

**Status:** Basic profile screen implemented

**Current Features:**
- [x] User profile display
- [x] Health data display
- [x] Navigation to settings

**Planned Features:**
- [ ] Profile editing
- [ ] Avatar upload
- [ ] Fitness goals configuration
- [ ] Units preferences (metric/imperial)
- [ ] Notification settings
- [ ] Privacy settings
- [ ] Data export
- [ ] Account deletion

---

### 3.10 Social & Community Features (Future)

**Status:** Not yet implemented

**Planned Features:**
- [ ] User profiles (public/private)
- [ ] Feed/Activity timeline
- [ ] Follow/Connect system
- [ ] Post creation (text, images, videos)
- [ ] Comments and likes
- [ ] Share workouts/nutrition logs
- [ ] Challenges and leaderboards
- [ ] Achievement sharing
- [ ] Push notifications for social activity

**Tech Stack:**
- Supabase Realtime for feed updates
- Supabase Storage for media files
- Expo Notifications for push notifications

---

## 4. Technical Architecture

### 4.1 Frontend (React Native/Expo)

**Framework:** Expo SDK 54 (Managed Workflow)

**Key Technologies:**
- React Native 0.81.4
- Expo Router 6.0.10 (file-based routing)
- TypeScript 5.9.2
- NativeWind 4.2.1 (Tailwind CSS for React Native)
- React Navigation 7.1.6

**State Management:**
- React Context API (AuthContext, FoodContext, WorkoutsContext,
  HealthKitContext, NetworkContext, ToastContext, UnitsContext)
- Local state with React hooks
- Supabase Realtime for live data

**UI Components:**
- React Native Paper (Material Design components)
- Custom design system (`design-system/`)
- React Native SVG for charts
- React Native Chart Kit

**Native Modules:**
- Custom ARKit body tracker module (`modules/arkit-body-tracker`)
- Vision Pose Detector (`native/VisionPoseDetector.swift`)
- React Native Health (`react-native-health`)

### 4.2 Backend (Supabase)

**Services:**
- **Auth:** Supabase Auth (JWT-based)
- **Database:** PostgreSQL with Row-Level Security (RLS)
- **Storage:** Supabase Storage for media files
- **Realtime:** Supabase Realtime for live updates
- **Edge Functions:** TypeScript functions for API routes

**Database Schema:**
- Users (profiles, preferences)
- Workouts (sessions, exercises, sets)
- Foods (entries, meals, nutrition)
- Health data (synced from HealthKit)
- Sync queue (for offline operations)

**Security:**
- Row-Level Security (RLS) policies
- JWT authentication
- API key management

### 4.3 Local Storage

**SQLite Database:**
- Local cache for workouts and foods
- Offline-first data access
- Automatic sync with Supabase
- Conflict resolution

**AsyncStorage:**
- User preferences
- App settings
- Cache keys

### 4.4 Build & Deployment

**EAS Build:**
- iOS builds (App Store, TestFlight)
- Android builds (Play Store, APK)
- Preview builds for testing

**CI/CD:**
- GitHub Actions workflows
- Automated testing and linting
- Preview builds on PRs
- Staging deployment on `develop` branch
- Production deployment on `main` branch

**Environment Management:**
- Development (local)
- Staging (TestFlight/internal)
- Production (App Store)

---

## 5. User Flows

### 5.1 Onboarding Flow

1. **App Launch**
   - Check authentication status
   - Redirect to sign-in or home

2. **Sign-In/Sign-Up**
   - Google Sign-In (implemented)
   - Apple Sign-In (planned)
   - Email/Password (planned)

3. **Health Permissions**
   - Request HealthKit permissions
   - Explain data usage
   - Initial sync option

4. **Profile Setup**
   - Display name
   - Fitness goals
   - Units preference

5. **Dashboard**
   - Welcome screen
   - Quick actions
   - Health metrics

### 5.2 Workout Logging Flow

1. **Navigate to Workouts Tab**
   - View workout history
   - Tap "Add Workout"

2. **Create Workout**
   - Enter workout name/date
   - Add exercises
   - Log sets, reps, weight
   - Save workout

3. **Form Analysis (Optional)**
   - Navigate to Scan tab
   - Start ARKit tracking
   - Perform exercise
   - View form feedback
   - Save form data

4. **Sync**
   - Automatic sync when online
   - Manual sync option
   - View sync status

### 5.3 Food Logging Flow

1. **Navigate to Food Tab**
   - View food history
   - Tap "Add Food"

2. **Log Food**
   - Search food (future: database)
   - Enter custom food (current)
   - Add nutrition info
   - Save entry

3. **View Nutrition**
   - Daily summary
   - Macro breakdown
   - Meal timing

### 5.4 Health Trends Flow

1. **Navigate to Health Trends Tab**
   - View sync status
   - Tap "Sync HealthKit Data" (if needed)

2. **View Trends**
   - Select time range (Daily/Weekly/Monthly)
   - View metric cards
   - See percentage changes
   - Read quick insights

3. **Weight Dashboard**
   - View weight chart
   - See statistics
   - Check goals progress
   - View predictions

---

## 6. Design System

### 6.1 Color Palette

**Primary Colors:**
- Background: `#050E1F` (Dark navy)
- Cards: `#0F2339` to `#081526` (Gradient)
- Accent: `#4C8CFF` (Blue)
- Text Primary: `#F5F7FF` (Light)
- Text Secondary: `#9AACD1` (Muted blue)

**Status Colors:**
- Success: Green
- Warning: Yellow
- Error: Red
- Info: Blue

### 6.2 Typography

- **Headings:** Bold, 28px (title), 20px (section)
- **Body:** Regular, 16px
- **Labels:** Regular, 14px
- **Font:** System default (San Francisco on iOS)

### 6.3 Components

**Design System Location:** `design-system/`

**Key Components:**
- Buttons (primary, secondary, text)
- Cards (gradient backgrounds)
- Inputs (text, number, date)
- Charts (line, bar, pie)
- Activity Rings
- Log Entry Cards

---

## 7. Data Models

### 7.1 Workout

```typescript
interface Workout {
  id: string;
  userId: string;
  name: string;
  date: Date;
  duration?: number; // minutes
  notes?: string;
  exercises: Exercise[];
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date; // soft delete
  synced: boolean;
}

interface Exercise {
  id: string;
  workoutId: string;
  name: string;
  sets: Set[];
  notes?: string;
}

interface Set {
  id: string;
  exerciseId: string;
  reps?: number;
  weight?: number; // kg or lbs
  duration?: number; // seconds
  restTime?: number; // seconds
}
```

### 7.2 Food

```typescript
interface FoodEntry {
  id: string;
  userId: string;
  name: string;
  calories: number;
  protein?: number; // grams
  carbs?: number; // grams
  fat?: number; // grams
  servingSize?: string;
  date: Date;
  mealType?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date; // soft delete
  synced: boolean;
}
```

### 7.3 Health Data

```typescript
interface HealthMetric {
  id: string;
  userId: string;
  type: 'steps' | 'weight' | 'heartRate' | 'activeCalories';
  value: number;
  unit: string;
  date: Date;
  source: 'healthkit' | 'manual';
  createdAt: Date;
}
```

### 7.4 ARKit Form Data

```typescript
interface FormAnalysis {
  id: string;
  workoutId: string;
  exerciseId: string;
  jointAngles: JointAngles;
  timestamp: Date;
  formScore?: number; // 0-100
  feedback?: string[];
}
```

---

## 8. Success Metrics

### 8.1 User Engagement

- **Daily Active Users (DAU)**
- **Weekly Active Users (WAU)**
- **Monthly Active Users (MAU)**
- **Session duration**
- **Workouts logged per week**
- **Food entries logged per week**

### 8.2 Feature Adoption

- **ARKit form analysis usage rate**
- **HealthKit sync completion rate**
- **Offline usage percentage**
- **Social features engagement** (future)

### 8.3 Technical Metrics

- **App crash rate** (< 1%)
- **Sync success rate** (> 99%)
- **API response time** (< 500ms)
- **Offline sync latency** (< 5 seconds)

### 8.4 Business Metrics (Future)

- **User retention** (Day 1, Day 7, Day 30)
- **Conversion rate** (free to premium)
- **Churn rate**
- **Customer acquisition cost (CAC)**

---

## 9. Roadmap

### Phase 1: MVP (Current) ✅ ~40% Complete

**Completed:**
- ✅ Core infrastructure (Expo, Supabase, Navigation)
- ✅ Authentication (Google Sign-In)
- ✅ Workout tracking (basic)
- ✅ Food tracking (basic)
- ✅ ARKit body tracking
- ✅ HealthKit integration
- ✅ Offline-first architecture
- ✅ Health trends and analytics

**In Progress:**
- 🔄 Apple Sign-In
- 🔄 Email/Password auth
- 🔄 Exercise database
- 🔄 Food database integration

**Remaining:**
- [ ] Onboarding flow
- [ ] Advanced workout features (supersets, templates)
- [ ] Nutrition insights
- [ ] Social features (basic)

### Phase 2: Enhanced Features (Q2 2025)

- [ ] Complete authentication methods
- [ ] Exercise database with search
- [ ] Food database (barcode scanner, USDA integration)
- [ ] Advanced form analysis (exercise-specific rules)
- [ ] Workout templates and routines
- [ ] Nutrition goals and tracking
- [ ] Progress photos
- [ ] Export functionality

### Phase 3: Social & Community (Q3 2025)

- [ ] User profiles
- [ ] Feed/Activity timeline
- [ ] Follow/Connect system
- [ ] Post creation and sharing
- [ ] Comments and likes
- [ ] Challenges and leaderboards
- [ ] Push notifications

### Phase 4: AI & Personalization (Q4 2025)

- [ ] ML-based workout recommendations
- [ ] Nutrition suggestions
- [ ] Form improvement recommendations
- [ ] Personalized insights
- [ ] Adaptive planning

### Phase 5: Android & Expansion (2026)

- [ ] Android app development
- [ ] MediaPipe integration for Android
- [ ] Google Fit integration
- [ ] Cross-platform sync
- [ ] Internationalization

---

## 10. Risks & Mitigations

### 10.1 Technical Risks

**Risk:** ARKit only available on newer iOS devices  
**Mitigation:** Graceful degradation, show compatibility message, focus on
supported devices

**Risk:** HealthKit permissions denied  
**Mitigation:** Clear permission explanations, manual entry fallback,
re-request option

**Risk:** Offline sync conflicts  
**Mitigation:** Conflict resolution strategy, last-write-wins with retry,
user notification

**Risk:** Supabase rate limits  
**Mitigation:** Implement caching, batch operations, monitor usage

### 10.2 Product Risks

**Risk:** Low user adoption of ARKit features  
**Mitigation:** Onboarding tutorials, clear value proposition, easy-to-use
UI

**Risk:** Data privacy concerns  
**Mitigation:** Clear privacy policy, transparent data usage, user control
over data

**Risk:** Competition from established apps  
**Mitigation:** Focus on unique ARKit form analysis, superior offline
experience

### 10.3 Business Risks

**Risk:** App Store rejection  
**Mitigation:** Follow Apple guidelines, thorough testing, clear app
description

**Risk:** High development costs  
**Mitigation:** Use managed services (Supabase, EAS), open-source
libraries, efficient development

---

## 11. Compliance & Privacy

### 11.1 Data Privacy

- **Health Data:** Stored securely in Supabase with RLS
- **User Consent:** Explicit permissions for HealthKit access
- **Data Retention:** User-controlled, deletion available
- **Third-Party Services:** Supabase (GDPR compliant), Google (OAuth)

### 11.2 App Store Requirements

- **Privacy Policy:** Required for HealthKit apps
- **Terms of Service:** Required for user accounts
- **Data Usage Descriptions:** Clear HealthKit permission descriptions
- **App Store Guidelines:** Compliance with Apple's guidelines

### 11.3 Health Data Regulations

- **HIPAA:** Not applicable (consumer app, not healthcare provider)
- **HealthKit Guidelines:** Follow Apple's HealthKit guidelines
- **Data Security:** Encryption at rest and in transit

---

## 12. Appendices

### 12.1 Key Files & Directories

```
/app                    # Expo Router app directory
  /(tabs)              # Tab navigation screens
  /(auth)              # Authentication screens
  /(modals)            # Modal screens
/components            # Reusable React components
/contexts              # React Context providers
/lib                   # Utility functions and services
  /services           # Business logic services
  /arkit              # ARKit integration
/modules               # Native modules
/native                # Native Swift/Objective-C code
/docs                  # Documentation
/supabase             # Database migrations
```

### 12.2 Key Dependencies

- `expo`: 54.0.12
- `react-native`: 0.81.4
- `@supabase/supabase-js`: 2.50.0
- `expo-sqlite`: 16.0.8
- `react-native-vision-camera`: 4.7.2
- `react-native-health`: 1.19.0
- `arkit-body-tracker`: Custom module

### 12.3 Development Commands

```bash
# Development
npm start                    # Start Expo dev server
npm run ios                  # Run on iOS simulator
npm run web                  # Run web version

# Building
eas build --profile preview  # Preview build
eas build --profile production # Production build

# Database
supabase start               # Start local Supabase
supabase db push             # Deploy migrations
```

---

## 13. Revision History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | Jan 2025 | Initial PRD creation | AI Assistant |

---

**Document Status:** Living Document  
**Next Review:** After MVP completion  
**Stakeholders:** Product Team, Engineering Team, Design Team

