# Form Factor Landing Page — Visual Wireframe

## Desktop layout (lo-fi)
```
┌─────────────────────────────────────────────────────────────────────────┐
│ Nav: FF logo | Product | Features | Coach | Roadmap | Docs | CTA: Get App│
├─────────────────────────────────────────────────────────────────────────┤
│ Hero:                                                                     │
│  Left: H1 + subhead + CTAs (primary: Get iOS app / Waitlist, secondary:   │
│        See how it works) + small trust note (offline-first, HealthKit).   │
│  Right: Phone mock with looping video/GIF of camera overlay giving cues;  │
│         subtle glow/gradient halo.                                        │
│  Background: light neutral with diagonal blue gradient streak + faint     │
│              contour lines for energy.                                    │
├─────────────────────────────────────────────────────────────────────────┤
│ Value props (3–4 tiles)                                                   │
│ [Real-time cues] [Auto logging] [Health-aware coach] [Built for lifters]  │
│ Each tile: icon, one-liner, short subcopy; light cards on neutral base.   │
├─────────────────────────────────────────────────────────────────────────┤
│ How it works strip                                                        │
│ 1 Point camera → 2 Get cues → 3 Auto-log → 4 Coach adjusts                │
│ Horizontal numbered pills connected by a thin line; small supporting copy│
├─────────────────────────────────────────────────────────────────────────┤
│ Feature deep-dive (two alternating splits)                                │
│ Row A: Text left, visual right (rep tracking overlay / ARKit).            │
│ Row B: Visual left (HealthKit trends/dashboard), text right.              │
│ Optional Row C: Video feed + social proof.                                │
├─────────────────────────────────────────────────────────────────────────┤
│ AI Coach highlight                                                        │
│ Darker panel card with chat bubble mock, badges for “Sleep-aware”,        │
│ “Load-aware”, “Edge Function powered”. CTA: Talk to the coach.            │
├─────────────────────────────────────────────────────────────────────────┤
│ Reliability & privacy row                                                 │
│ Inline badges: Offline-first sync, Supabase RLS, Private media, Push hygiene│
├─────────────────────────────────────────────────────────────────────────┤
│ Roadmap teaser                                                            │
│ Timeline chips: Periodization → Progressive overload → Templates → Android│
├─────────────────────────────────────────────────────────────────────────┤
│ CTA strip                                                                 │
│ Centered headline + primary CTA + secondary CTA; repeat app icon.         │
├─────────────────────────────────────────────────────────────────────────┤
│ Footer                                                                    │
│ Links: Docs | Support | Privacy | Terms | Built on Expo + Supabase        │
└─────────────────────────────────────────────────────────────────────────┘
```

## Mobile layout (stacked)
```
Nav bar: logo left, CTA button right.
Hero: H1/subhead, CTAs, then phone mock/video beneath.
Value props: vertical cards with subtle dividers.
How it works: horizontal scrollable chips (1–4).
Feature splits: stack (visual above, text below) with alternating backgrounds.
AI Coach: full-width dark card with chat bubbles.
Reliability badges: two-up grid; wrap to single column.
Roadmap: horizontal chips; fallback to vertical list.
CTA strip: centered buttons; sticky-ish spacing.
Footer: single-column links.
```

## Visual language
- Palette: brand blue (#1583ff or pulled from app icon), deep navy for text, warm gray neutrals; use gradient (blue → electric cyan) in hero only. Avoid purple bias; keep background clean.
- Typography: bold, athletic sans (e.g., Space Grotesk/Manrope/Satoshi); weight contrast between H1 and body. Tight letter spacing for headings.
- Buttons: pill/rounded rectangles; primary = brand blue on white; secondary = outline/navy text.
- Surface: light cards with subtle shadows; darker accent panel for AI Coach section.
- Motions: gentle fade/slide on load; stagger tiles; CTA hover lifts; “How it works” line animates.
- Imagery: use provided FF icon; hero visual should show camera overlay with cues; include one dashboard/health-trends shot and one coach chat mock.

## Section content notes
- Hero copy should echo: “Real-time form coaching from your phone camera.” and “Think Strava for lifting with instant cues.”
- Value props subcopy should stay concise (1–2 lines); pair with minimal line icons.
- AI Coach card: show context tags (Sleep dip, HR elevated, Recent load) feeding into a suggestion bubble.
- Reliability row: cite offline-first SQLite + sync queue, Supabase RLS, private storage buckets, notification pruning.
- Roadmap chips: Periodization planning, Progressive overload tracking, Goal-based templates, Android parity, Richer social/feed.

## Assets to prep
- App icon (provided).
- Hero short loop (camera overlay with cues) and static fallback.
- Dashboard/health trends screenshot.
- Coach chat mock with context tags.
- Feed thumbnail (optional) showing signed URL gating.
