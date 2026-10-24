# Form Factor visual direction

Clean athletic: charcoal surfaces, crisp typography, electric blue actions.

- Shared tokens: `styles/theme.ts`; Lexend headings and supporting text, system typography for provider sign-in buttons.
- Use blue for the primary action and selected states. Use neutral borders and surfaces for supporting information.
- Keep one clear headline and primary action per screen. Feature screens can use a small uppercase section label above the headline.
- Authentication places provider buttons before email fields, uses explicit field labels, and scrolls on smaller displays.
- App mark: `assets/images/ff-icon-v2.png`, 1024 × 1024, also copied to the iOS and watch app icon catalogs. Expo configuration and the in-app brand component use this asset.
- Google asset: `assets/images/google-g.png`, downloaded unchanged from https://developers.google.com/static/identity/images/g-logo.png. Keep the multicolor mark intact and pair it with an explicit sign-in label. Reference: https://developers.google.com/identity/branding-guidelines.
- The original `ff-logo.png` is retained for reference. The icon prompt is in `app-icon-prompt.txt`.

The initial pass covers authentication, welcome, the form dashboard, and shared home/tab colors. Other feature screens still contain older styling and can adopt these tokens as they are redesigned.
