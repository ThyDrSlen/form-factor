# E2E Code Path Coverage

Generated from source analysis of all tested pages. Each path is marked:
- **COVERED** — exercised by a Playwright spec or Claude-in-Chrome test
- **UNCOVERED** — not tested (with reason)
- **UNTESTABLE** — requires real backend, native platform, or auth session

---

## `app/index.tsx` — Root Redirect (8 paths)

| Path | Description | Status |
|------|-------------|--------|
| P1 | `useAuth()` context read | COVERED (smoke 1.1, critical 3.1) |
| P2 | `loading=true` → spinner | UNCOVERED — transient, hard to catch |
| P3 | Web + no user → redirect `/landing` | COVERED (smoke 1.1, critical 3.1) |
| P4 | Non-web platform gate | UNTESTABLE — E2E runs on web only |
| P5 | Authenticated → redirect `/(tabs)` | UNTESTABLE — no auth in E2E |
| P6 | No auth → redirect `/sign-in` | UNTESTABLE — web hits P3 first |
| P7 | Dependency re-run on auth change | UNTESTABLE — requires auth state change |
| P8 | Loading spinner render | UNCOVERED — transient |

**Coverage: 2/8 (25%)** — 4 untestable (auth/platform), 2 transient

---

## `app/(auth)/sign-in.tsx` — Sign In (62 paths)

| Path | Description | Status |
|------|-------------|--------|
| P1 | Initial render (isSignUp=false) | COVERED (auth 2.1) |
| P2-P4 | Initial state values | COVERED (auth 2.1) |
| P6-P16 | `getErrorMessage()` — 11 error mappings | UNTESTABLE — require real Supabase errors |
| P17 | Empty fields → "Please fill in all fields" | COVERED (critical 3.4) |
| P18-P21 | `signUpWithEmail()` flow | UNTESTABLE — requires backend |
| P22-P23 | `signInWithEmail()` flow | UNTESTABLE — requires backend |
| P24-P27 | `handleSocialAuth()` Google/Apple | UNTESTABLE — requires OAuth |
| P28-P31 | `handleMagicLink()` flow | UNCOVERED — UI toggle not tested |
| P32 | Error container render | COVERED (critical 3.4) |
| P33 | Email input disabled when signing in | UNTESTABLE — requires loading state |
| P34 | isSignUp → Full Name field | COVERED (auth 2.2) |
| P35-P40 | Button text states (Log In/Create Account/Loading) | COVERED: P39-P40 (auth 2.1, 2.2), UNCOVERED: P37-P38 (loading) |
| P41 | Magic link success message | UNCOVERED |
| P42-P51 | Magic link toggle + states | UNCOVERED — magic link flow not tested |
| P52-P54 | Sign-in/up toggle | COVERED (auth 2.2, cross-nav 6.1) |
| P55-P57 | "Forgot password?" link | COVERED (auth 2.3, critical 3.2) |
| P58-P59 | Google button visible/disabled | COVERED: visible (auth 2.1), UNCOVERED: disabled |
| P60-P62 | Apple button (iOS only) | UNTESTABLE — web E2E |

**Coverage: 18/62 (29%)** — 22 untestable (backend/platform), 22 uncovered

### Uncovered but testable:
- Magic link toggle ("Send magic link instead" → form change)
- Magic link "Send Magic Link" button render
- Loading state button text ("Logging In...", "Creating Account...")

---

## `app/(auth)/sign-up.tsx` — Sign Up (16 paths)

| Path | Description | Status |
|------|-------------|--------|
| P1 | Initial state render | COVERED (sign-up 5.1) |
| P2-P6 | `handleSignUp()` with backend call | UNTESTABLE — requires Supabase |
| P7 | Loading state finally block | UNTESTABLE — requires backend |
| P8-P9 | "Create Account" / subtitle text | COVERED (sign-up 5.1) |
| P10 | Full Name input | COVERED (sign-up 5.1) |
| P11 | Email input | COVERED (sign-up 5.1, 5.4) |
| P12 | Password input | COVERED (sign-up 5.1, 5.4) |
| P13-P14 | Submit button + loading | COVERED: P13 (sign-up 5.3), UNCOVERED: P14 (loading spinner) |
| P15 | Button text "Sign Up" | COVERED (sign-up 5.1) |
| P16 | "Sign in" back link | COVERED (sign-up 5.2) |

**Coverage: 10/16 (63%)** — 4 untestable (backend), 2 uncovered

### Uncovered but testable:
- Loading spinner on submit button (would need to intercept/delay network)

---

## `app/(auth)/forgot-password.tsx` — Forgot Password (26 paths)

| Path | Description | Status |
|------|-------------|--------|
| P1 | Initial state render | COVERED (critical 3.2, 3.3, 3.5) |
| P2-P7 | `mapResetErrorMessage()` — 6 error mappings | UNTESTABLE — require real errors |
| P8 | `handleResetPassword()` entry | COVERED (critical 3.3, 3.5) |
| P9 | Invalid email validation (client-side) | COVERED (critical 3.3, 3.5) |
| P10-P11 | Loading state + error clear | UNTESTABLE — requires valid email + backend |
| P12-P16 | Backend call + success/error | UNTESTABLE — requires Supabase |
| P17-P20 | `emailSent=true` success screen | UNTESTABLE — requires backend success |
| P21 | `emailSent=false` form render | COVERED (critical 3.2) |
| P22 | Email TextInput with testID | COVERED (critical 3.3) |
| P23-P24 | Submit button + disabled states | COVERED (critical 3.5) |
| P25 | Error message render | COVERED (critical 3.3) |
| P26 | "Back to Sign In" link | COVERED (cross-nav 6.1) |

**Coverage: 10/26 (38%)** — 12 untestable (backend), 4 uncovered

### Uncovered but testable:
- "Back to Sign In" link from form view (separate from success view)

---

## `app/(auth)/callback.tsx` — OAuth Callback (11 paths)

| Path | Description | Status |
|------|-------------|--------|
| P1-P11 | All paths | UNTESTABLE — requires OAuth flow + backend |

**Coverage: 0/11 (0%)** — all untestable without real OAuth

---

## `app/reset-password.tsx` — Reset Password (42 paths)

| Path | Description | Status |
|------|-------------|--------|
| P1-P6 | `parseRecoveryTokens()` URL parsing | UNTESTABLE — requires recovery URL |
| P7-P12 | `mapResetUpdateError()` — 6 mappings | UNTESTABLE — require real errors |
| P13-P21 | `ensureRecoverySession()` | UNTESTABLE — requires recovery tokens |
| P22 | `handleUpdatePassword()` entry | COVERED (critical 3.7, 3.8) |
| P23 | Password <8 chars → error | COVERED (critical 3.7) |
| P24 | Passwords don't match → error | COVERED (critical 3.8) |
| P25-P26 | Loading state + error clear | UNTESTABLE — requires recovery session |
| P27 | No recovery session → error | COVERED (critical 3.6) |
| P28-P32 | Backend update + success/error | UNTESTABLE — requires Supabase + session |
| P33-P36 | `passwordUpdated=true` success screen | UNTESTABLE — requires backend success |
| P37 | Form render | COVERED (critical 3.6) |
| P38 | New Password input | COVERED (critical 3.6, 3.7) |
| P39 | Confirm Password input | COVERED (critical 3.6, 3.8) |
| P40 | Update Password button | COVERED (critical 3.6) |
| P41 | Error message render | COVERED (critical 3.7, 3.8) |
| P42 | "Back to Sign In" link | UNCOVERED |

**Coverage: 10/42 (24%)** — 27 untestable (backend/tokens), 5 uncovered

### Uncovered but testable:
- "Back to Sign In" link on reset-password page

---

## `app/landing.tsx` — Landing Page (27 paths)

| Path | Description | Status |
|------|-------------|--------|
| P1 | Nav "Get the app" button | COVERED: visible (nav 4.1), UNCOVERED: no handler |
| P2 | "Get the iOS app" CTA | COVERED: visible (smoke 1.1) |
| P3 | "See how it works" CTA | COVERED: visible (nav 4.3) |
| P4-P7 | Coach/CTA section buttons | P4-P5 UNCOVERED, P6-P7 UNCOVERED |
| P8 | ScrollView vertical scroll | COVERED (nav 4.2, 4.4-4.8) |
| P9-P12 | LinearGradient visuals | UNCOVERED — visual-only, no functional test |
| P13-P17 | Responsive flex layouts | COVERED: P13-P14 (nav 4.5), UNCOVERED: P16 alternating rows |
| P18 | Feature row alternation | UNCOVERED — visual layout only |
| P19-P20 | Logo images | UNCOVERED — asset loading not tested |
| P21 | Value props list (4 cards) | COVERED (nav 4.5) |
| P22 | How-it-works list (4 steps) | COVERED (nav 4.6) |
| P23 | Feature deep-dive list (4 features) | COVERED (nav 4.4) |
| P24 | Coach tags list | UNCOVERED |
| P25 | Reliability badges list | UNCOVERED |
| P26 | Platform snapshot list | UNCOVERED |
| P27 | Roadmap chips list | COVERED (nav 4.7) |

**Coverage: 12/27 (44%)** — 0 untestable, 15 uncovered

### Uncovered but testable:
- Coach section tags ("Sleep dip", "HR elevated", "Recent load high", "Deload candidate")
- Coach chat mock messages
- Reliability badges ("Offline-first with retrying sync", etc.)
- Platform snapshot cards
- "Talk to the coach" / "See prompts" buttons visible
- "See the feed" button visible
- Feature deep-dive bullet points

---

## `app/_layout.tsx` — Root Layout / Auth Guards (11 paths)

| Path | Description | Status |
|------|-------------|--------|
| R1 | Font loading splash | UNCOVERED — transient |
| R2 | Web root landing flag | COVERED (smoke 1.1) |
| R3 | Web + no user → `/landing` | COVERED (smoke 1.1, critical 3.1) |
| R4 | User + no goals → onboarding | UNTESTABLE — requires auth |
| R5 | User + goals + onboarding → tabs | UNTESTABLE — requires auth |
| R6 | User + auth group → tabs | UNTESTABLE — requires auth |
| R7 | User + root → tabs | UNTESTABLE — requires auth |
| R8 | No user + protected route → sign-in | UNCOVERED — could test by navigating to `/(tabs)` |
| R9 | Public routes whitelist | COVERED (landing, reset-password accessible) |
| R10 | Route group detection | COVERED (implicit in all nav tests) |
| R11 | Auth loading spinner | UNCOVERED — transient |

**Coverage: 4/11 (36%)** — 4 untestable (auth), 3 uncovered

### Uncovered but testable:
- Navigate to `/(tabs)/workouts` without auth → should redirect to `/sign-in`

---

## Overall Summary

| Page | Total Paths | Covered | Uncovered (Testable) | Untestable |
|------|-------------|---------|---------------------|------------|
| `index.tsx` | 8 | 2 | 2 | 4 |
| `sign-in.tsx` | 62 | 18 | 22 | 22 |
| `sign-up.tsx` | 16 | 10 | 2 | 4 |
| `forgot-password.tsx` | 26 | 10 | 4 | 12 |
| `callback.tsx` | 11 | 0 | 0 | 11 |
| `reset-password.tsx` | 42 | 10 | 5 | 27 |
| `landing.tsx` | 27 | 12 | 15 | 0 |
| `_layout.tsx` | 11 | 4 | 3 | 4 |
| **Total** | **203** | **66 (33%)** | **53 (26%)** | **84 (41%)** |

### Testable coverage: 66 / 119 testable paths = **55%**

## Top Gaps to Close (testable, no backend needed)

1. **Landing page content** — coach tags, reliability badges, platform snapshot, deep-dive bullets (+10 paths)
2. **Magic link flow** — toggle to magic link mode, "Send Magic Link" button, back to password (+8 paths)
3. **Auth guard redirect** — navigate to protected route without auth → redirect (+1 path)
4. **Reset-password "Back to Sign In"** link (+1 path)
5. **Button disabled states** — forgot-password submit disabled when empty (+1 path)
6. **Loading button text** — "Logging In...", "Creating Account..." (requires network interception) (+4 paths)
