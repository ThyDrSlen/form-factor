import * as FileSystem from 'expo-file-system/legacy';
import { ExerciseRecorder, parseExerciseRecording, type ExerciseRecording, type ExerciseReplayFrame } from './exercise-replay';
import type { DetectionMode } from '@/lib/workouts';

/** Opt-in developer capture only. Never writes to the app's synced database. */
export class ExerciseRecordingStore {
  private armed = false;
  private recorder: ExerciseRecorder | null = null;
  private pendingSave: Promise<void> = Promise.resolve();
  private error: string | null = null;

  get status(): 'idle' | 'armed' | 'recording' { return this.recorder ? 'recording' : this.armed ? 'armed' : 'idle'; }
  get lastError(): string | null { return this.error; }

  arm(): void {
    if (!__DEV__ || this.recorder) return;
    this.error = null;
    this.armed = true;
  }

  begin(workoutId: DetectionMode, fixturePlayback: boolean): boolean {
    if (!__DEV__ || fixturePlayback || !this.armed || this.recorder) return false;
    this.armed = false;
    this.recorder = new ExerciseRecorder(workoutId);
    return true;
  }

  append(frame: ExerciseReplayFrame): void {
    if (!__DEV__ || !this.recorder) return;
    try { this.recorder.append(frame); }
    catch (error) { this.abort(this.message(error)); }
  }

  reset(options?: { preserveRepCount?: boolean }): void {
    if (!__DEV__ || !this.recorder) return;
    this.recorder.reset(options);
  }

  /** Abort a partial capture on mode change/unmount, without consuming an unused arm. */
  abort(reason = 'Capture discarded: scan interrupted or exercise changed.'): void {
    if (this.recorder) this.error = reason;
    this.recorder = null;
  }

  cancel(): void {
    this.armed = false;
    this.abort('Capture canceled.');
  }

  finish(): Promise<void> {
    if (!__DEV__ || !this.recorder) return this.pendingSave;
    let recording: ExerciseRecording;
    try { recording = this.recorder.finish(); }
    catch (error) {
      this.abort(this.message(error));
      return this.pendingSave;
    }
    this.recorder = null;
    this.pendingSave = this.pendingSave.then(async () => {
      const uri = this.localUri();
      await FileSystem.writeAsStringAsync(`${uri}.tmp`, JSON.stringify(recording));
      await FileSystem.moveAsync({ from: `${uri}.tmp`, to: uri });
    }).catch((error: unknown) => { this.error = this.message(error); });
    return this.pendingSave;
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : 'Unable to capture this scan.';
  }

  async loadLatest(): Promise<ExerciseRecording | null> {
    if (!__DEV__) return null;
    await this.pendingSave;
    const uri = this.localUri();
    if (!(await FileSystem.getInfoAsync(uri)).exists) return null;
    return parseExerciseRecording(JSON.parse(await FileSystem.readAsStringAsync(uri)));
  }

  private localUri(): string {
    if (!FileSystem.documentDirectory) throw new Error('Local document storage is unavailable.');
    return `${FileSystem.documentDirectory}exercise-recording-latest.json`;
  }
}

export const exerciseRecordingStore = new ExerciseRecordingStore();
