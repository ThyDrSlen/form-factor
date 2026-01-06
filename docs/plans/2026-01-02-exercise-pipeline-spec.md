# Exercise Pipeline Spec (TS-first)

## Goal
- Implement a shared, exercise-configured pipeline for:
  - rep segmentation (FSM)
  - rep summarization
  - fault detection and cues
  - metric-driven FQI scoring
- Supported exercises: pull-ups, push-ups, squats (extensible).
- Supported inputs:
  - 3D pose (ARKit)
  - 2D pose (MediaPipe or similar)

## Non-goals
- No ML model training logic beyond persisting features already produced by the pipeline.
- No UI implementation details.
- No exercise-specific scoring code paths outside `ExerciseDefinition` data and generic scoring engine.

## Terminology
- Pose stream: sequence of `PoseFrame`.
- Metric stream: sequence of `MetricFrame` derived from pose.
- Exercise instance: one active configured pipeline for one exercise definition and one live pose stream.
- Rep: a contiguous time window identified by rep FSM rules.
- Phase: a named discrete state in the rep FSM.
- Required metrics: the subset of `MetricKey` necessary to run FSM, cues, rep summary, and scoring for a given exercise definition.

## Invariants
- `MetricFrame.metrics` and `MetricFrame.metricConfidence` contain every key in `ExerciseDefinition.requiredMetrics`.
- Confidence gating:
  - If any required metric confidence is below `ExerciseDefinition.confidenceGate.minMetricConfidence`, the FSM does not transition and does not emit rep events for that frame.
  - Rep summarization buffers may continue to collect data, but must not finalize a rep on a gated frame.
- All penalties and scores are clamped:
  - `faultPenalty` in `[0, 100]`
  - `romScore`, `depthScore`, `score` in `[0, 100]`
- Stable identifiers:
  - `JointName`, `MetricKey`, `ExerciseId`, `PhaseId`, `FaultId`, `CueId` are stable across versions.
  - Do not introduce dynamically generated keys.

## Source dimensionality
- Do not encode 2D as 3D with `z = 0` in a way that downstream code can mistake as real depth.
- Representation rule:
  - `PoseFrame.poseDim` is either `2` or `3`.
  - Joint vectors are `Vec = { x: number; y: number; z?: number }`.
  - If `poseDim === 2`, then `z` is omitted for all joints.
  - If `poseDim === 3`, then `z` is present for all joints.
- Metric extractor rule:
  - Each metric declares `requires3D: boolean`.
  - If `requires3D === true` and `poseDim === 2`, then:
    - `MetricFrame.metrics[metricKey] = NaN`
    - `MetricFrame.metricConfidence[metricKey] = 0`
  - All gating uses confidence, not `NaN` checks.

## Module boundaries
- `lib/services/exercise-pipeline/types.ts`
  - all shared types in this spec (no React imports).
- `lib/services/exercise-pipeline/metric-extractor.ts`
  - pose smoothing, outlier handling, metric computation, confidence computation.
- `lib/services/exercise-pipeline/fsm.ts`
  - generic FSM runner, transition evaluation, hysteresis, dwell, direction gates, event emission.
- `lib/services/exercise-pipeline/rep-summary.ts`
  - rep window aggregation, per-metric min/max/start/end, optional repStats.
- `lib/services/exercise-pipeline/scoring.ts`
  - ROM, depth, faults, FQI combination.
- `lib/services/exercise-pipeline/definitions/*.ts`
  - exercise definitions: pull-up, push-up, squat.
- `lib/services/exercise-pipeline/index.ts`
  - composition entrypoint: pose in, events out.

## Core data types

### Scalars
- `type ExerciseId = string`
- `type PhaseId = string`
- `type FaultId = string`
- `type CueId = string`
- `type ConditionId = string`
- `type ViewType = 'front' | 'side' | 'threeQuarter'`
- `type PoseSource = 'ARKit' | 'MediaPipe' | 'Other'`
- `type PoseDim = 2 | 3`

### Vectors
- `type Vec = { x: number; y: number; z?: number }`
- `type Vec3 = { x: number; y: number; z: number }`
- `type Quaternion = { x: number; y: number; z: number; w: number }`

### Pose input
```ts
export interface PoseFrame<JointName extends string = string> {
  t_ms: number;
  poseDim: 2 | 3;
  joints: Record<JointName, Vec>;
  confidence: Record<JointName, number>; // [0,1]
  worldUp?: Vec3;
  cameraPose?: { position: Vec3; orientation: Quaternion };
  source?: PoseSource;
}
```

### Metrics
```ts
export type MetricKey = string;

export interface MetricFrame<K extends string = MetricKey> {
  t_ms: number;
  metrics: Record<K, number>;
  metricConfidence: Record<K, number>; // [0,1]
}
```

### Rolling window
- Required operations:
  - append a frame value
  - query latest value
  - query min and max over the window
  - query simple derivative (velocity) with `dt_ms` handling
- Implementation:
  - ring buffer storing `(t_ms, value)`
  - `windowMs` configured per `ExerciseDefinition.buffers`

```ts
export interface RollingWindow {
  readonly windowMs: number;
  push(t_ms: number, value: number): void;
  latest(): { t_ms: number; value: number } | undefined;
  min(): number | undefined;
  max(): number | undefined;
  slope(): number | undefined; // units per second using linear (last-first) / dt
}
```

### Rep state and events
```ts
export interface RepState {
  exerciseId: ExerciseId;
  phase: PhaseId;
  phaseEnteredAt_ms: number;
  lastTransitionAt_ms: number;
  repActive: boolean;
  repIndex: number; // 1-indexed, increments on repStart
  buffers: Record<MetricKey, RollingWindow>;
  cueState: Record<CueId, { lastEmittedAt_ms: number; lastTrueAt_ms: number }>;
}

export type RepEvent =
  | { type: 'repStart'; t_ms: number; repIndex: number; payload: {} }
  | { type: 'repComplete'; t_ms: number; repIndex: number; payload: { repSummary: RepSummary; fqi: FQIResult } }
  | { type: 'repRejected'; t_ms: number; repIndex: number; payload: { reasons: string[] } }
  | { type: 'cue'; t_ms: number; repIndex: number; payload: { cueId: CueId; severity: number; text: string } };
```

### Rep summary and stats
```ts
export interface RepSummary {
  start_ms: number;
  end_ms: number;
  duration_ms: number;
  metricMin: Record<MetricKey, number>;
  metricMax: Record<MetricKey, number>;
  metricStart: Record<MetricKey, number>;
  metricEnd: Record<MetricKey, number>;
  repStats?: RepStats;
}

export type RepStats = Record<string, number>;
```

### Scoring outputs
```ts
export interface FQIResult {
  score: number; // 0..100
  romScore: number; // 0..100
  depthScore: number; // 0..100
  faultPenalty: number; // 0..100
  detectedFaults: FaultId[];
  romBreakdown?: Record<string, { left: number; right: number; aggregate: number }>;
  depthBreakdown?: Record<string, { left: number; right: number; aggregate: number }>;
}
```

## ExerciseDefinition

### Predicates and condition registry
- Two forms are supported:
  - inline functions in the definition module
  - named conditions referenced by id for serialization
- Runtime representation:
  - an `ExerciseDefinition.conditions` registry maps `ConditionId` to a predicate implementation.

```ts
export type ConditionPredicate = (args: {
  frame: MetricFrame;
  state: RepState;
  buffers: RepState['buffers'];
}) => boolean;
```

### Transition
```ts
export interface HysteresisConfig {
  metric: MetricKey;
  enterThreshold: number;
  exitThreshold: number;
  direction?: 'above' | 'below'; // how enterThreshold is interpreted
}

export interface DirectionGateConfig {
  velocityMetric: MetricKey;
  sign: 'positive' | 'negative';
}

export interface Transition {
  from: PhaseId;
  to: PhaseId;
  conditionId?: ConditionId;
  condition?: ConditionPredicate;
  minHold_ms: number;
  hysteresis?: HysteresisConfig;
  directionGate?: DirectionGateConfig;
}
```

### Rep rules
```ts
export interface RepRules {
  startConditionId?: ConditionId;
  startCondition?: ConditionPredicate;
  endConditionId?: ConditionId;
  endCondition?: ConditionPredicate;
  rejectionRules: Array<{
    id: string;
    conditionId?: ConditionId;
    condition?: (args: { rep: RepSummary; repStats?: RepStats }) => boolean;
    reason: string;
  }>;
}
```

### Scoring configuration
```ts
export interface FQIWeights {
  rom: number; // [0,1]
  depth: number; // [0,1]
  faults: number; // [0,1] penalty scale
}

export interface RomMetric {
  id: string;
  metricLeft: MetricKey;
  metricRight: MetricKey;
  targetMin: number;
  targetMax: number;
  weight: number; // (0,1]
}

export interface DepthMetric {
  id: string;
  metricLeft: MetricKey;
  metricRight: MetricKey;
  extreme: 'min' | 'max';
  optimal: number;
  tolerance: number;
  penaltyPerUnit: number; // points per unit beyond tolerance
  weight: number; // (0,1]
}
```

### Faults and cues
```ts
export interface FaultDefinition {
  id: FaultId;
  severity: number; // higher is more severe
  fqiPenalty: number; // 0..100
  condition: (args: { rep: RepSummary; repStats?: RepStats }) => boolean;
  dynamicCue: string;
}

export interface CueDefinition {
  id: CueId;
  severity: number;
  phaseGate: PhaseId[];
  conditionId?: ConditionId;
  condition?: ConditionPredicate;
  debounce_ms: number;
  cooldown_ms: number;
  text: string;
}
```

### Confidence gating and buffers
```ts
export interface ConfidenceGateConfig {
  minMetricConfidence: number; // [0,1]
}

export interface BufferConfig {
  metric: MetricKey;
  windowMs: number;
}
```

### Full definition
```ts
export interface ExerciseDefinition {
  id: ExerciseId;

  phases: PhaseId[];
  initialPhase: PhaseId;
  transitions: Transition[];
  repRules: RepRules;

  requiredMetrics: MetricKey[];
  supportedViews: ViewType[];
  confidenceGate: ConfidenceGateConfig;
  buffers: BufferConfig[];

  scoring: {
    romMetrics: RomMetric[];
    depthMetrics: DepthMetric[];
    weights: FQIWeights;
  };

  faults: FaultDefinition[];
  cues: CueDefinition[];

  conditions: Record<ConditionId, ConditionPredicate>;
  repStatsComputer?: (args: { repFrames: MetricFrame[]; rep: RepSummary }) => RepStats;
}
```

## Pipeline
- Fixed stages (exercise variability only via `ExerciseDefinition`):
  1. pose ingestion
  2. metric extraction per frame
  3. FSM runner per exercise instance
  4. rep summarization over rep window
  5. scoring and fault evaluation from rep summary and optional rep stats

## Metric extraction

### Inputs and outputs
- Input: `PoseFrame`
- Output: `MetricFrame`

### Required behavior
- For each `MetricKey` in `ExerciseDefinition.requiredMetrics`:
  - compute `metrics[key]` and `metricConfidence[key]`.
- Smoothing:
  - apply EMA to either joint positions or metric values.
  - define per-key `alpha` in `[0,1]` (higher alpha means less smoothing).
- Velocity:
  - derive velocities using smoothed values and `dt_ms`.
  - define units:
    - if position-derived in world units, velocity is units per second
    - if angle-derived, velocity is deg per second
- Outlier rejection:
  - if joint displacement between consecutive frames exceeds `maxDeltaPerSecond * dt_s`, clamp displacement to that limit before metric computation.
  - outlier detection uses pose confidence:
    - if any joint used for a metric has confidence below `minJointConfidence`, then reduce metric confidence.
- Metric confidence:
  - `metricConfidence[key] = combine(confidence[joint_i])` where `combine` is `min` across contributing joints.
  - if the metric is computed from multiple derived values, metric confidence is the minimum of their confidences.

### Required configuration
```ts
export interface MetricSpec {
  key: MetricKey;
  requires3D: boolean;
  joints: string[]; // contributing joints
  alpha: number; // EMA smoothing
}
```

## FSM runner

### Inputs and outputs
- Input: `MetricFrame`
- Input/Output: `RepState`
- Output: `RepEvent[]` (0 or more per frame)

### Transition evaluation order
- For each frame:
  1. Apply confidence gate. If gated, return no events and do not mutate phase or repActive.
  2. Update rolling buffers for configured metrics.
  3. Evaluate cue definitions (debounced, cooldown-limited).
  4. If `repActive === false`, evaluate rep start rule.
  5. Evaluate phase transitions from current phase.
  6. If `repActive === true`, evaluate rep end rule.

### Transition rules
- Candidate transitions:
  - `transitions.filter(t => t.from === state.phase)`
- For each candidate transition:
  - dwell gate:
    - require `(frame.t_ms - state.phaseEnteredAt_ms) >= t.minHold_ms`
  - direction gate:
    - if set, require `sign(metrics[velocityMetric])` matches `positive` or `negative`
  - hysteresis:
    - if set, compute `metricValue = frame.metrics[h.metric]`
    - enter condition:
      - if `h.direction === 'above'`, require `metricValue >= enterThreshold`
      - if `h.direction === 'below'`, require `metricValue <= enterThreshold`
    - exit threshold is used to prevent immediate reversal:
      - when currently in `t.to`, reversal transitions must use their own hysteresis config
      - no implicit cross-coupling between transitions
  - predicate:
    - evaluate `t.condition` or `conditions[t.conditionId]`
- Selection policy:
  - deterministic ordering: evaluate transitions in the order provided in `ExerciseDefinition.transitions`.
  - take the first transition that evaluates to true.

### Rep start and end modeling
- Rep start:
  - When `repRules.startCondition` is true on a non-gated frame:
    - set `repActive = true`
    - increment `repIndex` by 1
    - emit `repStart` with `t_ms = frame.t_ms`
    - initialize rep summary aggregation at `t_ms`
- Rep end:
  - When `repRules.endCondition` is true on a non-gated frame and `repActive === true`:
    - finalize rep summary using the rep window frames
    - compute repStats if configured
    - compute scoring and faults
    - evaluate rejection rules
      - if rejected: emit `repRejected`
      - else: emit `repComplete` with payload `{ repSummary, fqi }`
    - set `repActive = false`

## Cue emission
- Cue is evaluated only if:
  - `state.phase` is in `cue.phaseGate`
  - confidence gate passes
- Debounce:
  - `cue` becomes eligible to emit if its condition has been continuously true for `debounce_ms`.
  - Track `lastTrueAt_ms` per cue id.
- Cooldown:
  - After emitting, do not emit the same cue until `cooldown_ms` elapses since `lastEmittedAt_ms`.

## Rep summarization

### Inputs and outputs
- Inputs:
  - required metrics list
  - all `MetricFrame`s from `repStart` inclusive to `repEnd` inclusive
- Output: `RepSummary`

### Aggregation rules
- On first rep frame:
  - `metricStart[key] = metrics[key]`
  - `metricMin[key] = metrics[key]`
  - `metricMax[key] = metrics[key]`
- For each subsequent rep frame:
  - `metricMin[key] = min(metricMin[key], metrics[key])`
  - `metricMax[key] = max(metricMax[key], metrics[key])`
- On rep end frame:
  - `metricEnd[key] = metrics[key]`
  - `duration_ms = end_ms - start_ms`

## Scoring

### ROM scoring
- Definitions:
  - For a `RomMetric m`:
    - left achieved band: `[rep.metricMin[m.metricLeft], rep.metricMax[m.metricLeft]]`
    - right achieved band: `[rep.metricMin[m.metricRight], rep.metricMax[m.metricRight]]`
    - target band: `[m.targetMin, m.targetMax]`
- Coverage function:
  - `overlap(aMin, aMax, tMin, tMax) = max(0, min(aMax, tMax) - max(aMin, tMin))`
  - `targetLen = max(epsilon, tMax - tMin)`
  - `coverage = clamp01(overlap / targetLen) * 100`
- Side aggregation:
  - `leftCoverage = coverage(leftAchievedMin, leftAchievedMax, targetMin, targetMax)`
  - `rightCoverage = coverage(rightAchievedMin, rightAchievedMax, targetMin, targetMax)`
  - `aggregateCoverage = min(leftCoverage, rightCoverage)`
- Weighted ROM score:
  - If `romMetrics.length === 0`, `romScore = 100`
  - Else:
    - `romScore = sum(aggregateCoverage_i * weight_i) / sum(weight_i)`

### Depth scoring
- For a `DepthMetric d`:
  - If `d.extreme === 'min'`:
    - `leftAchieved = rep.metricMin[d.metricLeft]`
    - `rightAchieved = rep.metricMin[d.metricRight]`
  - If `d.extreme === 'max'`:
    - `leftAchieved = rep.metricMax[d.metricLeft]`
    - `rightAchieved = rep.metricMax[d.metricRight]`
- Score function:
  - `score(achieved) = 100` if `abs(achieved - optimal) <= tolerance`
  - else:
    - `penalty = (abs(achieved - optimal) - tolerance) * penaltyPerUnit`
    - `score = clamp(0, 100, 100 - penalty)`
- Side aggregation:
  - `leftScore = score(leftAchieved)`
  - `rightScore = score(rightAchieved)`
  - `aggregateScore = min(leftScore, rightScore)`
- Weighted depth score:
  - If `depthMetrics.length === 0`, `depthScore = 100`
  - Else:
    - `depthScore = sum(aggregateScore_i * weight_i) / sum(weight_i)`

### Fault detection
- Evaluate all `FaultDefinition.condition` using:
  - `rep: RepSummary`
  - `repStats` if present
- Output:
  - `detectedFaultIds = faults where condition === true`
  - `totalPenalty = min(100, sum(fqiPenalty for detected faults))`

### FQI combination
- Combine using additive base and subtractive penalty:
  - `base = romScore * weights.rom + depthScore * weights.depth`
  - `penalty = totalPenalty * weights.faults`
  - `score = clamp(0, 100, round(base - penalty))`
- Weight expectations:
  - `weights.rom` and `weights.depth` in `[0,1]`
  - Optional invariant for interpretability:
    - `weights.rom + weights.depth == 1`
  - `weights.faults` is independent penalty scalar

## Validation
- Definition validation at load time:
  - all `phases` unique
  - `initialPhase` is in `phases`
  - `transitions.from` and `transitions.to` are in `phases`
  - each `RomMetric.metricLeft|metricRight`, `DepthMetric.metricLeft|metricRight`, `HysteresisConfig.metric`, `DirectionGateConfig.velocityMetric` is in `requiredMetrics`
  - all `FaultDefinition.id` unique
  - all `CueDefinition.id` unique
  - weights are finite numbers
- Runtime validation:
  - if any required metric is `NaN` or missing, set its confidence to `0` and gate.

## Example definitions (structure-only)

### Pull-up
- Phases: `HANG`, `ASCENT`, `TOP`, `DESCENT`
- Required metrics:
  - `elbowAngleL_deg`, `elbowAngleR_deg`
  - `verticalVelocityY` (or equivalent `sternumVelY`)
  - `torsoLean_deg`
  - `pelvisSwayAmp_norm`
- Rep start condition:
  - stable `HANG` for `hangStable_ms`
  - positive vertical velocity above `vStartThreshold` for `startDwell_ms`
  - elbow angle in extension band for hang gate
- Rep end condition:
  - return to stable `HANG` for `hangStable_ms`
  - elbow angle in extension band
- ROM metrics:
  - elbow lockout band coverage: target `[160, 175]`
  - elbow top band coverage: target `[45, 70]`
- Depth metrics:
  - min elbow angle, optimal `55`, tolerance `10`
- Faults:
  - swing: `pelvisSwayAmp_norm > swingInvalidThreshold` during repStats window
  - uneven pull: asymmetry peak exceeds threshold
  - incomplete lockout: max elbow angle fails to enter extension band
- Cues:
  - swing cue threshold lower than invalid threshold
  - lockout cue when lockout band not achieved
  - even pull cue when asymmetry exceeds cue threshold

### Push-up
- Phases: `PLANK`, `DESCENT`, `BOTTOM`, `ASCENT`
- Required metrics:
  - `elbowAngleL_deg`, `elbowAngleR_deg`
  - `bodyLineAngle_deg` or `torsoLean_deg`
  - `hipSag_norm`
- Rep start:
  - stable `PLANK` and elbow angle velocity negative
- Rep end:
  - stable `PLANK` and elbow angle in extension band
- Faults:
  - hips sag: `hipSag_norm` above threshold
  - partial reps: bottom band coverage below threshold
  - asymmetry: left vs right timing mismatch near bottom or top

### Squat
- Phases: `STAND`, `DESCENT`, `BOTTOM`, `ASCENT`
- Required metrics:
  - `kneeAngleL_deg`, `kneeAngleR_deg`
  - `hipAngleL_deg`, `hipAngleR_deg`
  - `torsoLean_deg`
  - `kneeValgus_norm`
  - `hipBelowKnee_norm` (if pose supports)
- Faults:
  - knee cave: valgus above threshold during descent or bottom
  - forward lean: torso lean above threshold at bottom
  - bounce: bottom dwell below threshold and rebound velocity above threshold

