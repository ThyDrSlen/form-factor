- [ ] **Hero**
  - [ ] Headline: “Real-time form coaching from your phone camera.”
  - [ ] Subhead: “Form Factor counts reps, flags faults, and logs sets automatically—think Strava for lifting with instant cues.”
  - [ ] CTAs: `Get the iOS app` (or `Join TestFlight / Waitlist`), secondary `See how it works`.
  - [ ] Visual: App icon + looping hero video/GIF of camera overlay giving cues; light blue-forward gradient background.

- [ ] **Value Props (tiles)**
  - [ ] Real-time cues: ARKit + Vision Camera detects reps, calls out swing/depth/ROM/tempo.
  - [ ] Auto logging: Sets/reps/weight captured as you move.
  - [ ] Health-aware coach: AI adapts to sleep/HR/recovery trends from HealthKit.
  - [ ] Built for lifters: Offline-first, fast logging, lift-focused UX.

- [ ] **How It Works (step strip)**
  - [ ] Step 1: Point your camera → “Track every rep in real time.”
  - [ ] Step 2: Get cues → “Fix form mid-set: swing, depth, ROM, tempo.”
  - [ ] Step 3: Auto-log → “Sets saved with weights; syncs when back online.”
  - [ ] Step 4: Coach → “AI suggests adjustments when recovery dips.”

- [ ] **Feature Deep Dive**
  - [ ] Rep/Form tracking: ARKit body tracking, Vision Camera overlay, speech cues, video capture/upload.
  - [ ] Health & recovery: HealthKit import (activity, HR, weight, sleep) powering coach context and trends.
  - [ ] Logging: Offline-first SQLite + sync queue; conflict-safe; fast add/delete for foods/workouts.
  - [ ] Feed: Private video uploads with signed thumbnails, comments, likes.
  - [ ] Notifications: Push nudges + preferences; “coach” and “notify” Edge Functions.

- [ ] **Platform Snapshot**
  - [ ] iOS-first (Hermes, Expo Router, NativeWind/RN Paper).
  - [ ] Web: read-only dashboards.
  - [ ] Android: planned post-MVP.

- [ ] **AI Coach Section**
  - [ ] Adaptive cues (deload after bad sleep, focus on form vs. intensity).
  - [ ] Note OpenAI-backed Supabase Edge Function; secure by design.

- [ ] **Reliability & Privacy**
  - [ ] Offline-first with retrying sync.
  - [ ] RLS on Supabase tables; private media buckets.
  - [ ] Notification pruning of bad tokens.

- [ ] **Roadmap Teaser**
  - [ ] Periodization planning; progressive overload tracking; goal-based templates.
  - [ ] Richer social/feed; Android parity.

- [ ] **CTA Strip**
  - [ ] Repeat primary CTA; secondary “See the feed” or “Talk to the coach”.

- [ ] **Footer**
  - [ ] Links: Docs, Support, Privacy, Terms.
  - [ ] “Built on Expo + Supabase” nod.
