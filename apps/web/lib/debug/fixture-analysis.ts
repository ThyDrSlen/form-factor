export type Joint = { x: number; y: number; isTracked: boolean; confidence: number };
export type Frame = {
  timestampSec: number;
  angles: Record<string, number>;
  joints: Record<string, Joint>;
  expected?: { repCount?: number; partialFramesMin?: number; partialFramesMax?: number };
};

export type FixtureStats = {
  frameCount: number;
  duration: number;
  fps: number;
  jointNames: string[];
  angleNames: string[];
  jointBBox: { minX: number; maxX: number; minY: number; maxY: number };
  confidenceAvg: number;
  trackedAvg: number;
  detectedReps: number;
  repEvents: number[];
  expected: Frame['expected'];
};

export function computeFixtureStats(frames: Frame[]): FixtureStats {
  const frameCount = frames.length;
  const duration = frames[frameCount - 1].timestampSec - frames[0].timestampSec;
  const fps = duration > 0 ? (frameCount - 1) / duration : 0;

  const jointNames = Object.keys(frames[0].joints);
  const angleNames = Object.keys(frames[0].angles);

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  let confSum = 0,
    confCount = 0,
    trackedSum = 0;

  for (const f of frames) {
    let trackedInFrame = 0;
    for (const name of jointNames) {
      const j = f.joints[name];
      if (!j) continue;
      if (j.x < minX) minX = j.x;
      if (j.x > maxX) maxX = j.x;
      if (j.y < minY) minY = j.y;
      if (j.y > maxY) maxY = j.y;
      confSum += j.confidence;
      confCount++;
      if (j.isTracked) trackedInFrame++;
    }
    trackedSum += trackedInFrame / jointNames.length;
  }

  const confidenceAvg = confCount > 0 ? confSum / confCount : 0;
  const trackedAvg = frameCount > 0 ? trackedSum / frameCount : 0;

  const repSignal = pickRepSignal(frames, angleNames);
  const { count, events } = detectReps(repSignal);

  return {
    frameCount,
    duration,
    fps,
    jointNames,
    angleNames,
    jointBBox: { minX, maxX, minY, maxY },
    confidenceAvg,
    trackedAvg,
    detectedReps: count,
    repEvents: events,
    expected: frames[0].expected,
  };
}

function pickRepSignal(frames: Frame[], angleNames: string[]): number[] {
  const candidates = ['leftElbow', 'rightElbow'].filter((n) => angleNames.includes(n));
  if (candidates.length === 0) return frames.map(() => 0);
  return frames.map((f) => {
    let s = 0;
    let n = 0;
    for (const c of candidates) {
      const v = f.angles[c];
      if (typeof v === 'number') {
        s += v;
        n++;
      }
    }
    return n > 0 ? s / n : 0;
  });
}

export function detectReps(signal: number[]): { count: number; events: number[] } {
  if (signal.length < 5) return { count: 0, events: [] };
  const min = Math.min(...signal);
  const max = Math.max(...signal);
  if (max - min < 20) return { count: 0, events: [] };
  const lowThreshold = min + (max - min) * 0.35;
  const highThreshold = min + (max - min) * 0.7;
  const events: number[] = [];
  let armed = false;
  let minIdx = -1;
  let minVal = Infinity;
  for (let i = 0; i < signal.length; i++) {
    const v = signal[i];
    if (v > highThreshold) {
      if (armed && minIdx >= 0) {
        events.push(minIdx);
        armed = false;
        minIdx = -1;
        minVal = Infinity;
      }
    }
    if (v < lowThreshold) {
      armed = true;
      if (v < minVal) {
        minVal = v;
        minIdx = i;
      }
    }
  }
  if (armed && minIdx >= 0) events.push(minIdx);
  return { count: events.length, events };
}

export function seriesForAngle(frames: Frame[], angleName: string): number[] {
  return frames.map((f) => f.angles[angleName] ?? NaN);
}
