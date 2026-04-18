# Watch Signal Translator Report

Deterministic output of `staticWatchSignalTranslator` across canonical signal permutations that stress every rule path and the default. Regenerate with `bun scripts/watch-translator-report.ts`.

- Total cases: **12**
- Source: rule-based (no LLM yet)

## Rule 1 · redlining

### Working set at 92% max HR

- **Signals:** `hr 175bpm (92% max), cadence 30rpm, phase working, last eccentric 1.2s`

> Breathe between reps — you're redlining.

- **Tone:** `urgent`
- **Source:** `static`

### Working set right at 90% threshold

- **Signals:** `hr 171bpm (90% max), cadence 25rpm, phase working, last eccentric 1.5s`

> Breathe between reps — you're redlining.

- **Tone:** `urgent`
- **Source:** `static`

## Rule 2 · plenty of gas

### Working set at 50% max HR

- **Signals:** `hr 95bpm (50% max), cadence 20rpm, phase working, last eccentric 1.5s`

> Plenty of gas — pick up the pace if the form's clean.

- **Tone:** `chill`
- **Source:** `static`

## Rule 3 · slow the eccentric

### Working set with 0.4s eccentric

- **Signals:** `hr 143bpm (75% max), cadence 28rpm, phase working, last eccentric 0.4s`

> Slow the eccentric — 2 seconds down per rep.

- **Tone:** `neutral`
- **Source:** `static`

## Rule 4 · extend rest

### Resting with HR still at 80% max

- **Signals:** `hr 152bpm (80% max), cadence 0rpm, phase rest, last eccentric 0s`

> Stretch rest another 30s — HR hasn't recovered.

- **Tone:** `neutral`
- **Source:** `static`

## Rule 5 · warmup bump

### Warmup with HR at 35% max

- **Signals:** `hr 67bpm (35% max), cadence 40rpm, phase warmup, last eccentric 1.2s`

> Bump the pace — warmup HR is still low.

- **Tone:** `chill`
- **Source:** `static`

## Default rule

### Steady working set, nothing flagged

- **Signals:** `hr 143bpm (75% max), cadence 28rpm, phase working, last eccentric 1.5s`

> Nothing flagged — keep going.

- **Tone:** `chill`
- **Source:** `static`

### Cooldown phase

- **Signals:** `hr 105bpm (55% max), cadence 0rpm, phase cooldown, last eccentric 0s`

> Nothing flagged — keep going.

- **Tone:** `chill`
- **Source:** `static`

### Rest phase with recovered HR

- **Signals:** `hr 105bpm (55% max), cadence 0rpm, phase rest, last eccentric 0s`

> Nothing flagged — keep going.

- **Tone:** `chill`
- **Source:** `static`

## Priority + edge

### Redlining AND fast eccentric — HR rule wins (priority 1 beats 3)

- **Signals:** `hr 181bpm (95% max), cadence 30rpm, phase working, last eccentric 0.3s`

> Breathe between reps — you're redlining.

- **Tone:** `urgent`
- **Source:** `static`

### Invalid hrMaxBpm (0) — HR rules skipped, falls through

- **Signals:** `hr 170bpm (invalid hrMax), cadence 28rpm, phase working, last eccentric 0.4s`

> Slow the eccentric — 2 seconds down per rep.

- **Tone:** `neutral`
- **Source:** `static`

### Negative hrMaxBpm — graceful default

- **Signals:** `hr 150bpm (invalid hrMax), cadence 0rpm, phase rest, last eccentric 0s`

> Nothing flagged — keep going.

- **Tone:** `chill`
- **Source:** `static`
