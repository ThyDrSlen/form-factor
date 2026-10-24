import React, { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { exerciseRecordingStore } from '@/lib/debug/exercise-recording-store';
import { ExerciseReplay, parseExerciseRecording, type ExerciseRecording } from '@/lib/debug/exercise-replay';
import { useWorkoutController } from '@/features/form-tracking/hooks/use-workout-controller';
import syntheticCurl from '@/tests/fixtures/exercise-replay/synthetic-curl.json';

const MAX_IMPORT_BYTES = 16 * 1024 * 1024;

export default function ExerciseReplayScreen() {
  return __DEV__ ? <ReplayLab /> : <Text>Developer tool unavailable</Text>;
}

function LabButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.text}>{label}</Text></Pressable>;
}

function ReplayLab() {
  const router = useRouter();
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState(() => exerciseRecordingStore.lastError ?? `Capture: ${exerciseRecordingStore.status}`);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState<ExerciseRecording | null>(null);
  const [position, setPosition] = useState(0);
  const [fqi, setFqi] = useState<number | null>(null);
  // Local display callbacks only; no scan/watch/audio/session callbacks.
  const callbacks = useMemo(() => ({ onRepComplete: (_rep: number, score: number) => setFqi(score) }), []);
  const controller = useWorkoutController('pullup', {
    sessionId: 'developer-replay', executionMode: 'replay', enableHaptics: false, callbacks,
  });
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const replayRef = useRef<ExerciseReplay | null>(null);

  function load(value: unknown) {
    // Validate before replacing the current replay, so bad imports are non-destructive.
    const parsed = parseExerciseRecording(value);
    replayRef.current = new ExerciseReplay(parsed, {
      reset: (workoutId, options) => {
        if (options) controllerRef.current.reset(options);
        else controllerRef.current.setWorkout(workoutId);
        if (!options?.preserveRepCount) setFqi(null);
      },
      processFrame: (angles, joints, context) => controllerRef.current.processFrame(angles, joints, context),
    });
    setRecording(parsed);
    setPosition(0);
    setStatus('Ready. Run processes all remaining frames immediately using their recorded intervals.');
  }

  async function loadLatest() {
    setBusy(true);
    try {
      const latest = await exerciseRecordingStore.loadLatest();
      if (latest) load(latest);
      else setStatus(exerciseRecordingStore.lastError ?? 'No local capture yet. Arm a scan, then start and stop tracking.');
    } catch (error) { setStatus(`Unable to load recording: ${message(error)}`); }
    finally { setBusy(false); }
  }

  async function importJson() {
    setBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true, multiple: false });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset || (asset.size ?? 0) > MAX_IMPORT_BYTES) throw new Error('Choose a JSON file smaller than 16 MB.');
      const json = await FileSystem.readAsStringAsync(asset.uri);
      if (json.length > MAX_IMPORT_BYTES) throw new Error('Recording is too large.');
      load(JSON.parse(json));
    } catch (error) { setStatus(`Unable to load recording: ${message(error)}`); }
    finally { setBusy(false); }
  }

  async function exportJson() {
    if (!recording) return;
    setBusy(true);
    try {
      if (Platform.OS !== 'ios') throw new Error('File sharing is currently supported on iOS.');
      if (!FileSystem.cacheDirectory) throw new Error('Local cache is unavailable.');
      const url = `${FileSystem.cacheDirectory}exercise-replay-export.json`;
      await FileSystem.writeAsStringAsync(url, JSON.stringify(recording));
      await Share.share({ url, title: 'Exercise replay JSON' });
    } catch (error) { setStatus(`Unable to export recording: ${message(error)}`); }
    finally { setBusy(false); }
  }

  function control(action: 'step' | 'run' | 'restart') {
    const replay = replayRef.current;
    if (!replay) return;
    try {
      replay[action]();
      setPosition(replay.position);
    } catch (error) { setStatus(`Replay stopped: ${message(error)}`); }
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <Text style={styles.title}>Exercise replay lab</Text>
      <Text style={styles.text}>Developer only · controller-input boundary. Captures accepted joint angles, optional joints, and quality context; not camera video or native pose inference.</Text>
      <Text style={styles.text}>One capture stays in this app’s local documents, replaces the previous capture, and is never automatically uploaded. Export only if you choose to share it.</Text>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent }} onPress={() => setConsent(!consent)} style={styles.button}>
        <Text style={styles.text}>{consent ? '☑' : '☐'} I consent to saving the next scan locally</Text>
      </Pressable>
      <LabButton label="Arm next scan recording" disabled={!consent || exerciseRecordingStore.status === 'recording'} onPress={() => {
        exerciseRecordingStore.arm();
        setStatus('Armed for the next real scan. Close this lab, then start and stop tracking.');
        setConsent(false);
      }} />
      <LabButton label="Cancel capture" onPress={() => { exerciseRecordingStore.cancel(); setStatus('Capture canceled.'); }} />
      <LabButton label="Load synthetic curl demo" disabled={busy} onPress={() => load(syntheticCurl)} />
      <Text style={styles.text}>No capture yet? Load the synthetic demo, then Run. This tests rep detection, not video playback or camera accuracy.</Text>
      <LabButton label="Load latest capture" disabled={busy} onPress={() => { void loadLatest(); }} />
      <LabButton label="Import JSON" disabled={busy} onPress={() => { void importJson(); }} />
      {recording ? <View style={styles.readout}>
        <Text style={styles.title}>{recording.source === 'recorded' ? 'Recorded' : 'Synthetic'} · {recording.workoutId}</Text>
        <Text style={styles.text}>Source is a file label, not proof of camera provenance.</Text>
        <Text style={styles.text}>Frame {position} / {recording.frames.length}</Text>
        <Text style={styles.text}>Phase: {controller.state.phase}</Text>
        <Text style={styles.text}>Reps: {controller.state.repCount}</Text>
        <Text style={styles.text}>FQI: {fqi === null ? '—' : fqi.toFixed(1)}</Text>
        {recording.expectedRepCount !== undefined ? <Text style={styles.text}>Expected reps (human label): {recording.expectedRepCount}</Text> : null}
      </View> : null}
      <View style={styles.controls}>
        <LabButton label="Step" disabled={busy || !recording || position >= recording.frames.length} onPress={() => control('step')} />
        <LabButton label="Run" disabled={busy || !recording || position >= recording.frames.length} onPress={() => control('run')} />
        <LabButton label="Restart" disabled={busy || !recording} onPress={() => control('restart')} />
      </View>
      <LabButton label="Export JSON" disabled={busy || !recording} onPress={() => { void exportJson(); }} />
      {status ? <Text style={styles.text} accessibilityLiveRegion="polite">{status}</Text> : null}
      <LabButton label="Close" onPress={() => router.back()} />
    </ScrollView>
  );
}

function message(error: unknown): string { return error instanceof Error ? error.message : 'Unknown error'; }

const styles = StyleSheet.create({
  content: { padding: 24, gap: 16, backgroundColor: '#fff', flexGrow: 1 },
  title: { fontSize: 24, fontWeight: '700', color: '#111827' },
  text: { color: '#111827', fontSize: 16 },
  button: { padding: 14, borderRadius: 10, backgroundColor: '#e5e7eb' },
  disabled: { opacity: 0.45 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  readout: { gap: 8 },
});
