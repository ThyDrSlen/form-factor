import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import Link from 'expo-router/link';
import { Stack } from 'expo-router';
import {
  parseRpeUtterance,
  type ParsedRpe,
} from '@/lib/services/voice-rpe-parser';
import {
  getPersonalizedCueRunner,
  type CueOutput,
  type UserFaultHistoryItem,
} from '@/lib/services/personalized-cue';
import {
  getWatchSignalTranslator,
  type TranslatedCue,
  type WatchPhaseState,
  type WatchSignals,
} from '@/lib/services/watch-signal-translator';

// =============================================================================
// Voice-RPE demo
// =============================================================================

const RPE_EXAMPLES = [
  '8 felt grindy on the last three',
  'rpe 7',
  'seven maybe eight',
  'that was brutal',
  'easy cake',
  'failed the last rep',
];

function VoiceRpeSection() {
  const [text, setText] = useState(RPE_EXAMPLES[0] ?? '');
  const parsed: ParsedRpe = useMemo(() => parseRpeUtterance(text), [text]);

  return (
    <View style={styles.card}>
      <Text style={styles.cardEyebrow}>voice-rpe-parser · regex (no LLM)</Text>
      <Text style={styles.cardTitle}>Voice RPE parser</Text>
      <Text style={styles.cardBody}>
        Takes a spoken-style transcript and extracts structured RPE + flags + notes. The LLM runner
        plugs in once on-device Gemma is wired.
      </Text>

      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Say it like you would mid-set…"
        placeholderTextColor="#6B7A94"
        style={styles.input}
        multiline
        autoCorrect={false}
        testID="voice-rpe-input"
      />

      <View style={styles.pillRow}>
        {RPE_EXAMPLES.map((example) => (
          <Pressable
            key={example}
            onPress={() => setText(example)}
            style={styles.pill}
            accessibilityRole="button"
          >
            <Text style={styles.pillText} numberOfLines={1}>{example}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.outputBlock}>
        <View style={styles.outputRow}>
          <Text style={styles.outputLabel}>RPE</Text>
          <Text style={styles.outputValue}>{parsed.rpe ?? '—'}</Text>
        </View>
        <View style={styles.outputRow}>
          <Text style={styles.outputLabel}>Confidence</Text>
          <Text style={styles.outputValue}>{Math.round(parsed.confidence * 100)}%</Text>
        </View>
        <View style={styles.outputRow}>
          <Text style={styles.outputLabel}>Source</Text>
          <Text style={styles.outputValue}>{parsed.source}</Text>
        </View>
        {parsed.flags.length > 0 ? (
          <View style={styles.flagRow}>
            {parsed.flags.map((flag) => (
              <View key={flag} style={styles.flagChip}>
                <Text style={styles.flagText}>{flag}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {parsed.notes ? (
          <Text style={styles.notes}>{`"${parsed.notes}"`}</Text>
        ) : null}
      </View>
    </View>
  );
}

// =============================================================================
// Personalized cue demo
// =============================================================================

interface CueCase {
  id: string;
  label: string;
  exerciseId: string;
  faultId: string;
}

const CUE_CASES: CueCase[] = [
  { id: 'squat-depth', label: 'Squat · shallow depth', exerciseId: 'squat', faultId: 'shallow_depth' },
  { id: 'squat-valgus', label: 'Squat · knees caving', exerciseId: 'squat', faultId: 'knee_valgus' },
  { id: 'pushup-sag', label: 'Push-up · hip sag', exerciseId: 'pushup', faultId: 'hip_sag' },
  { id: 'deadlift-rb', label: 'Deadlift · rounded back', exerciseId: 'deadlift', faultId: 'rounded_back' },
];

const REPEAT_HISTORY: UserFaultHistoryItem[] = [];

function PersonalizedCueSection() {
  const [activeId, setActiveId] = useState(CUE_CASES[0]?.id ?? '');
  const [repeatOffender, setRepeatOffender] = useState(true);
  const [output, setOutput] = useState<CueOutput | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  const activeCase = CUE_CASES.find((c) => c.id === activeId) ?? CUE_CASES[0]!;

  useEffect(() => {
    const history: UserFaultHistoryItem[] = repeatOffender
      ? [
          {
            faultId: activeCase.faultId,
            lastSeenSessionsAgo: 0,
            totalOccurrences: 4,
          },
        ]
      : REPEAT_HISTORY;

    let cancelled = false;
    setStatus('loading');
    getPersonalizedCueRunner()
      .getCue({
        exerciseId: activeCase.exerciseId,
        faultId: activeCase.faultId,
        userHistory: history,
      })
      .then((result) => {
        if (cancelled) return;
        setOutput(result);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [activeCase, repeatOffender]);

  return (
    <View style={styles.card}>
      <Text style={styles.cardEyebrow}>personalized-cue · static fallback</Text>
      <Text style={styles.cardTitle}>Personalized coaching cue</Text>
      <Text style={styles.cardBody}>
        Injects user history so cues reference patterns (&quot;third session in a row&quot;). Static today;
        a Gemma runner rewrites cues to feel natural when it lands.
      </Text>

      <View style={styles.pillRow}>
        {CUE_CASES.map((caseItem) => {
          const active = caseItem.id === activeId;
          return (
            <Pressable
              key={caseItem.id}
              onPress={() => setActiveId(caseItem.id)}
              style={[styles.pill, active && styles.pillActive]}
              accessibilityRole="button"
            >
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{caseItem.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Repeat offender (4 sessions)</Text>
        <Switch value={repeatOffender} onValueChange={setRepeatOffender} />
      </View>

      <View style={styles.outputBlock}>
        {status === 'ready' && output ? (
          <>
            <Text style={styles.cueText}>{output.cue}</Text>
            <View style={styles.outputRow}>
              <Text style={styles.outputLabel}>References history</Text>
              <Text style={styles.outputValue}>{output.referencesHistory ? 'yes' : 'no'}</Text>
            </View>
            <View style={styles.outputRow}>
              <Text style={styles.outputLabel}>Source</Text>
              <Text style={styles.outputValue}>{output.source}</Text>
            </View>
          </>
        ) : (
          <Text style={styles.outputValue}>{status === 'loading' ? 'Loading…' : 'Error'}</Text>
        )}
      </View>
    </View>
  );
}

// =============================================================================
// Watch signal translator demo
// =============================================================================

const PHASES: WatchPhaseState[] = ['warmup', 'working', 'rest', 'cooldown'];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function WatchTranslatorSection() {
  const [hrRatio, setHrRatio] = useState(0.85);
  const [cadenceRpm, setCadenceRpm] = useState(38);
  const [eccentricSec, setEccentricSec] = useState(0.4);
  const [phase, setPhase] = useState<WatchPhaseState>('working');
  const [cue, setCue] = useState<TranslatedCue | null>(null);

  const signals: WatchSignals = useMemo(
    () => ({
      hrBpm: Math.round(190 * hrRatio),
      hrMaxBpm: 190,
      cadenceRpm,
      phaseState: phase,
      lastRepEccentricSec: eccentricSec,
    }),
    [hrRatio, cadenceRpm, eccentricSec, phase],
  );

  useEffect(() => {
    let cancelled = false;
    getWatchSignalTranslator()
      .translate(signals)
      .then((result) => {
        if (!cancelled) setCue(result);
      });
    return () => {
      cancelled = true;
    };
  }, [signals]);

  return (
    <View style={styles.card}>
      <Text style={styles.cardEyebrow}>watch-signal-translator · rules</Text>
      <Text style={styles.cardTitle}>Watch signal translator</Text>
      <Text style={styles.cardBody}>
        Turns raw wearable signals into one-line coaching cues with tone. Rule-based today; Gemma
        replaces the rules when exertion context deserves more nuance.
      </Text>

      <View style={styles.pillRow}>
        {PHASES.map((p) => {
          const active = p === phase;
          return (
            <Pressable
              key={p}
              onPress={() => setPhase(p)}
              style={[styles.pill, active && styles.pillActive]}
              accessibilityRole="button"
            >
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{p}</Text>
            </Pressable>
          );
        })}
      </View>

      <NumericStepper
        label="HR % max"
        value={Math.round(hrRatio * 100)}
        step={5}
        min={30}
        max={100}
        onChange={(next) => setHrRatio(clamp(next, 30, 100) / 100)}
        suffix="%"
      />
      <NumericStepper
        label="Cadence"
        value={cadenceRpm}
        step={2}
        min={10}
        max={80}
        onChange={(next) => setCadenceRpm(clamp(next, 10, 80))}
        suffix=" rpm"
      />
      <NumericStepper
        label="Last eccentric"
        value={Math.round(eccentricSec * 10) / 10}
        step={0.1}
        min={0}
        max={4}
        onChange={(next) => setEccentricSec(clamp(Number(next.toFixed(1)), 0, 4))}
        suffix=" s"
      />

      <View style={styles.outputBlock}>
        {cue ? (
          <>
            <Text style={styles.cueText}>{cue.cue}</Text>
            <View style={styles.outputRow}>
              <Text style={styles.outputLabel}>Tone</Text>
              <View style={[styles.toneChip, toneStyles[cue.tone]]}>
                <Text style={styles.toneChipText}>{cue.tone}</Text>
              </View>
            </View>
            <View style={styles.outputRow}>
              <Text style={styles.outputLabel}>Source</Text>
              <Text style={styles.outputValue}>{cue.source}</Text>
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
}

interface NumericStepperProps {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (next: number) => void;
}

function NumericStepper({ label, value, step, min, max, suffix, onChange }: NumericStepperProps) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperControls}>
        <Pressable
          onPress={() => onChange(Math.max(min, value - step))}
          style={styles.stepperButton}
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label}`}
        >
          <Text style={styles.stepperButtonText}>−</Text>
        </Pressable>
        <Text style={styles.stepperValue}>
          {value}
          {suffix}
        </Text>
        <Pressable
          onPress={() => onChange(Math.min(max, value + step))}
          style={styles.stepperButton}
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label}`}
        >
          <Text style={styles.stepperButtonText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

// =============================================================================
// Index screen
// =============================================================================

export default function GemmaLabsScreen() {
  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: 'Gemma labs' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.pageEyebrow}>form factor · gemma surface</Text>
        <Text style={styles.pageTitle}>Gemma labs</Text>
        <Text style={styles.pageBody}>
          Interactive demos of the pluggable-runner services that will host on-device Gemma. Each
          currently ships a deterministic fallback — the same interface is what Gemma plugs into
          once native bindings or the Edge Function are keyed.
        </Text>

        <Link href="/labs/fault-synthesis" asChild>
          <Pressable style={styles.crossLink} accessibilityRole="link">
            <Text style={styles.crossLinkLabel}>Go to fault-synthesis lab →</Text>
            <Text style={styles.crossLinkBody}>
              Co-occurring fault root-cause chip over the hand-authored glossary.
            </Text>
          </Pressable>
        </Link>

        <VoiceRpeSection />
        <PersonalizedCueSection />
        <WatchTranslatorSection />
      </ScrollView>
    </View>
  );
}

const toneStyles: Record<'chill' | 'neutral' | 'urgent', { backgroundColor: string; borderColor: string }> = {
  chill: { backgroundColor: '#0F2B1E', borderColor: '#1D4B38' },
  neutral: { backgroundColor: '#1E2940', borderColor: '#2E3E5F' },
  urgent: { backgroundColor: '#3A1324', borderColor: '#622236' },
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#06101d' },
  content: { paddingHorizontal: 16, paddingVertical: 24, gap: 16 },
  pageEyebrow: {
    color: '#60A5FA',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  pageTitle: { color: '#F5F7FF', fontSize: 26, fontWeight: '700' },
  pageBody: { color: '#94A3B8', fontSize: 13, lineHeight: 18 },
  crossLink: {
    backgroundColor: '#0A1626',
    borderColor: '#14263F',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 4,
  },
  crossLinkLabel: { color: '#93C5FD', fontSize: 13, fontWeight: '700' },
  crossLinkBody: { color: '#94A3B8', fontSize: 12 },
  card: {
    backgroundColor: '#0C1A2E',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E2E4A',
    gap: 12,
  },
  cardEyebrow: {
    color: '#60A5FA',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  cardTitle: { color: '#F5F7FF', fontSize: 18, fontWeight: '600' },
  cardBody: { color: '#94A3B8', fontSize: 12, lineHeight: 17 },
  input: {
    color: '#E6EEFB',
    backgroundColor: '#0A1626',
    borderWidth: 1,
    borderColor: '#1E3A5F',
    borderRadius: 10,
    padding: 12,
    minHeight: 60,
    fontSize: 14,
  },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1E3A5F',
    backgroundColor: '#0A1626',
  },
  pillActive: {
    backgroundColor: '#1E3A5F',
    borderColor: '#60A5FA',
  },
  pillText: { color: '#93C5FD', fontSize: 11, fontWeight: '500' },
  pillTextActive: { color: '#F5F7FF', fontWeight: '600' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#0A1626',
    borderWidth: 1,
    borderColor: '#1E3A5F',
  },
  toggleLabel: { color: '#E6EEFB', fontSize: 13, fontWeight: '500' },
  outputBlock: {
    backgroundColor: '#081321',
    borderWidth: 1,
    borderColor: '#14263F',
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  outputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  outputLabel: {
    color: '#6B7A94',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  outputValue: { color: '#F5F7FF', fontSize: 14, fontWeight: '600' },
  cueText: { color: '#E6EEFB', fontSize: 15, lineHeight: 22, fontWeight: '500', marginBottom: 4 },
  notes: { color: '#94A3B8', fontSize: 12, fontStyle: 'italic' },
  flagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  flagChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#1E3A5F',
  },
  flagText: { color: '#E6EEFB', fontSize: 10, fontWeight: '600' },
  toneChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  toneChipText: { color: '#F5F7FF', fontSize: 11, fontWeight: '700' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  stepperLabel: { color: '#94A3B8', fontSize: 12, fontWeight: '500' },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E3A5F',
    backgroundColor: '#0A1626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonText: { color: '#F5F7FF', fontSize: 18, fontWeight: '700' },
  stepperValue: { color: '#F5F7FF', fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'center' },
});
