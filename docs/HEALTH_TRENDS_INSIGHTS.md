# Trends and personal-insight methodology

## Measurement versus display
Weight and VO₂ insight inputs are recorded samples, not carry-forward daily values. The chart uses elapsed calendar time, measured points and visible gaps. A daily summary or carried value is not another weigh-in. Device health history is not evidence that a location caused a change.

## Personal form-learning model
The training-pattern panel fits a small model on existing synced form records locally. It relates hours since the prior tracked same-exercise bout to recorded form-quality index (FQI). A minimum history and variation gate applies. Later sessions are held out chronologically; a model must outperform a personal-mean baseline before a tentative association is shown. Holdout results are not a clinical validation or proof of causality.

Untracked training, camera/tracking quality, load, fatigue and routine changes can confound this relationship. Eligible session-days use UTC calendar days because recorded workout-local timezones are unavailable; they are not a claim about local days while traveling. It must not be presented as a sleep/HRV readiness score, injury prediction or instruction to change exercise frequency. Model computation adds no uploads. Reading previously synced form data may still require connectivity; local session data is a separate source.

## Hypertrophy training support
The initial numerical proxy is explicitly rule-based: the share of eligible working sets with known positive repetitions that fall in the declared 5–30 repetition range. Missing repetitions, warm-ups and unsupported/time-based sets are not fabricated. This is not an overall hypertrophy score: proximity to failure, weekly muscle-specific volume, technique, recovery and progressive overload are not captured by that proxy. Do not chase it as an optimization target.

## Manual trip/routine context
Annotations are optional local records scoped to the signed-in account. No GPS, location inference or background location permission is used. City text is optional. Context storage is not separately encrypted by this feature and is not uploaded by it. Users can delete annotations in the panel.

Before/during/after comparisons use equal-duration windows and show recorded-day coverage and source/unit metadata. They withhold comparisons for incomplete follow-up, insufficient coverage, or incompatible sources/units. Weekday composition is shown rather than claimed to be matched. Zero-filled legacy steps are excluded because absence cannot be distinguished from a measured zero. HealthKit is a transport-level source label where originating-device metadata is unavailable, not a guarantee of identical devices.

## Body fat and VO₂
Body-fat reading is an explicit user action, not a mount-time permission request. HealthKit percent fractions are converted to display percentage values (0.18 → 18%). No body-fat estimate is inferred from weight. Empty results cannot distinguish denied access from missing data.

The native bridge supports bodyFatPercentage with HKUnit.percent() and VO₂ with mL/kg/min. VO₂ values are estimates supplied by their source, not direct lab measurements. Relative VO₂ can change when body mass changes.

## Verification boundaries
Mocked regression tests and successful native compilation do not certify real-world coaching validity or the appearance of FC's screen. The updated native app was installed, but FC was locked when launch was attempted. Physical visual acceptance and any new HealthKit consent must remain explicit.
