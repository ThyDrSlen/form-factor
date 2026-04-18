# Voice RPE Parser Report

Deterministic output of `parseRpeUtterance` across canonical utterances that stress every parser path. Regenerate with `bun scripts/voice-rpe-report.ts`.

- Total cases: **23**
- Source: regex-only (no LLM yet)

## Combination

### Digit + multiple flags

- **Utterance:** `9, brutal, form broke on the last two`
- **RPE:** 9
- **Notes:** "brutal, form broke on the last two"
- **Flags:** `hard`, `breakdown`
- **Confidence:** 90%
- **Source:** `regex`

### Word + flag

- **Utterance:** `seven, felt grindy`
- **RPE:** 7
- **Notes:** "felt grindy"
- **Flags:** `grindy`
- **Confidence:** 70%
- **Source:** `regex`

## Digit

### Clean digit only

- **Utterance:** `8`
- **RPE:** 8
- **Notes:** —
- **Flags:** —
- **Confidence:** 90%
- **Source:** `regex`

### Digit with notes

- **Utterance:** `8 felt grindy on the last three`
- **RPE:** 8
- **Notes:** "felt grindy on the last three"
- **Flags:** `grindy`
- **Confidence:** 90%
- **Source:** `regex`

### Digit out of range

- **Utterance:** `12`
- **RPE:** —
- **Notes:** —
- **Flags:** —
- **Confidence:** 20%
- **Source:** `regex`

## Edge

### Empty string

- **Utterance:** `(empty)`
- **RPE:** —
- **Notes:** —
- **Flags:** —
- **Confidence:** 20%
- **Source:** `regex`

### Whitespace only

- **Utterance:** `   `
- **RPE:** —
- **Notes:** —
- **Flags:** —
- **Confidence:** 20%
- **Source:** `regex`

### Mixed case preserved

- **Utterance:** `RPE Eight Felt GRINDY`
- **RPE:** 8
- **Notes:** "Felt GRINDY"
- **Flags:** `grindy`
- **Confidence:** 70%
- **Source:** `regex`

### Digit at end

- **Utterance:** `I think maybe 7`
- **RPE:** 7
- **Notes:** "I think maybe"
- **Flags:** —
- **Confidence:** 90%
- **Source:** `regex`

### Two separate digits

- **Utterance:** `set 3 rep 9`
- **RPE:** 3
- **Notes:** "set  rep 9"
- **Flags:** —
- **Confidence:** 90%
- **Source:** `regex`

## Flag only

### Grindy

- **Utterance:** `that was grindy`
- **RPE:** —
- **Notes:** "that was grindy"
- **Flags:** `grindy`
- **Confidence:** 50%
- **Source:** `regex`

### Brutal

- **Utterance:** `absolutely brutal`
- **RPE:** —
- **Notes:** "absolutely brutal"
- **Flags:** `hard`
- **Confidence:** 50%
- **Source:** `regex`

### Easy

- **Utterance:** `easy cake`
- **RPE:** —
- **Notes:** "easy cake"
- **Flags:** `easy`
- **Confidence:** 50%
- **Source:** `regex`

### Failed

- **Utterance:** `failed the last rep`
- **RPE:** —
- **Notes:** "failed the last rep"
- **Flags:** `failed`
- **Confidence:** 50%
- **Source:** `regex`

### Breakdown

- **Utterance:** `form broke on rep 4`
- **RPE:** 4
- **Notes:** "form broke on rep"
- **Flags:** `breakdown`
- **Confidence:** 90%
- **Source:** `regex`

### Paused

- **Utterance:** `paused mid rep, couldn't recover`
- **RPE:** —
- **Notes:** "paused mid rep, couldn't recover"
- **Flags:** `paused`
- **Confidence:** 50%
- **Source:** `regex`

### Quick

- **Utterance:** `that felt snappy today`
- **RPE:** —
- **Notes:** "that felt snappy today"
- **Flags:** `quick`
- **Confidence:** 50%
- **Source:** `regex`

## RPE prefix

### rpe prefix

- **Utterance:** `rpe 7`
- **RPE:** 7
- **Notes:** —
- **Flags:** —
- **Confidence:** 90%
- **Source:** `regex`

### uppercase rpe

- **Utterance:** `RPE 9 last rep was brutal`
- **RPE:** 9
- **Notes:** "last rep was brutal"
- **Flags:** `hard`
- **Confidence:** 90%
- **Source:** `regex`

## Range

### Range with "maybe"

- **Utterance:** `seven maybe eight`
- **RPE:** 8
- **Notes:** —
- **Flags:** —
- **Confidence:** 70%
- **Source:** `regex`

### Range with "or"

- **Utterance:** `six or seven`
- **RPE:** 7
- **Notes:** —
- **Flags:** —
- **Confidence:** 70%
- **Source:** `regex`

## Word

### Single word

- **Utterance:** `eight`
- **RPE:** 8
- **Notes:** —
- **Flags:** —
- **Confidence:** 70%
- **Source:** `regex`

### Word zero

- **Utterance:** `zero`
- **RPE:** —
- **Notes:** —
- **Flags:** —
- **Confidence:** 20%
- **Source:** `regex`
