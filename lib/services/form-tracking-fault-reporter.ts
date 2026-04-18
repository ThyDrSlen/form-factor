import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@form_tracking_faults_v1';
const MAX_EVENTS = 2000;

export type FaultSeverity = 1 | 2 | 3;

export interface FormTrackingFault {
  id: string;
  sessionId: string;
  exerciseId: string;
  faultCode: string;
  faultDisplayName?: string;
  severity: FaultSeverity;
  repIndex?: number;
  timestamp: number;
  confidence?: number;
  fqiPenalty?: number;
  context?: Record<string, unknown>;
}

export interface SessionFaultAggregate {
  sessionId: string;
  exerciseId: string;
  totalFaults: number;
  byFaultCode: Record<string, number>;
  maxSeverity: 0 | FaultSeverity;
  avgConfidence?: number;
  firstTimestamp?: number;
  lastTimestamp?: number;
}

let memoryCache: FormTrackingFault[] | null = null;

function isFault(v: unknown): v is FormTrackingFault {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.sessionId === 'string' &&
    typeof o.exerciseId === 'string' &&
    typeof o.faultCode === 'string' &&
    typeof o.timestamp === 'number' &&
    (o.severity === 1 || o.severity === 2 || o.severity === 3)
  );
}

async function load(): Promise<FormTrackingFault[]> {
  if (memoryCache) return memoryCache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      memoryCache = [];
      return memoryCache;
    }
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      memoryCache = parsed.filter(isFault);
      return memoryCache;
    }
  } catch {
    /* corrupt — reset below */
  }
  memoryCache = [];
  return memoryCache;
}

async function persist(events: FormTrackingFault[]): Promise<void> {
  memoryCache = events;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}

export async function recordFault(
  fault: Omit<FormTrackingFault, 'id' | 'timestamp'> & { timestamp?: number }
): Promise<FormTrackingFault> {
  const events = await load();
  const ts = fault.timestamp ?? Date.now();
  const id = `${fault.sessionId}_${fault.faultCode}_${events.length}_${ts}`;
  const full: FormTrackingFault = { id, timestamp: ts, ...fault };
  events.push(full);
  while (events.length > MAX_EVENTS) events.shift();
  await persist(events);
  return full;
}

export async function getSessionFaults(sessionId: string): Promise<FormTrackingFault[]> {
  const events = await load();
  return events.filter((e) => e.sessionId === sessionId);
}

export async function getExerciseFaults(
  sessionId: string,
  exerciseId: string
): Promise<FormTrackingFault[]> {
  const events = await load();
  return events.filter((e) => e.sessionId === sessionId && e.exerciseId === exerciseId);
}

export async function getSessionAggregates(
  sessionId: string
): Promise<SessionFaultAggregate[]> {
  const faults = await getSessionFaults(sessionId);
  const byExercise = new Map<string, FormTrackingFault[]>();
  for (const f of faults) {
    const arr = byExercise.get(f.exerciseId) ?? [];
    arr.push(f);
    byExercise.set(f.exerciseId, arr);
  }
  return Array.from(byExercise.entries()).map(([exerciseId, arr]) => {
    const byFaultCode: Record<string, number> = {};
    let maxSeverity: 0 | FaultSeverity = 0;
    let confSum = 0;
    let confN = 0;
    let minTs = Infinity;
    let maxTs = -Infinity;
    for (const f of arr) {
      byFaultCode[f.faultCode] = (byFaultCode[f.faultCode] ?? 0) + 1;
      if (f.severity > maxSeverity) maxSeverity = f.severity;
      if (typeof f.confidence === 'number') {
        confSum += f.confidence;
        confN += 1;
      }
      if (f.timestamp < minTs) minTs = f.timestamp;
      if (f.timestamp > maxTs) maxTs = f.timestamp;
    }
    return {
      sessionId,
      exerciseId,
      totalFaults: arr.length,
      byFaultCode,
      maxSeverity,
      avgConfidence: confN > 0 ? confSum / confN : undefined,
      firstTimestamp: Number.isFinite(minTs) ? minTs : undefined,
      lastTimestamp: Number.isFinite(maxTs) ? maxTs : undefined,
    };
  });
}

export async function clearSessionFaults(sessionId: string): Promise<void> {
  const events = await load();
  await persist(events.filter((e) => e.sessionId !== sessionId));
}

export async function clearAll(): Promise<void> {
  await persist([]);
}

export function __resetFaultReporterCache(): void {
  memoryCache = null;
}

export const FAULT_REPORTER_MAX_EVENTS = MAX_EVENTS;
export const FAULT_REPORTER_STORAGE_KEY = STORAGE_KEY;
