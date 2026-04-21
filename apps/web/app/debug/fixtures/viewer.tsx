'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LineChart } from './chart';
import {
  computeFixtureStats,
  seriesForAngle,
  type Frame,
  type Joint,
} from '@/lib/debug/fixture-analysis';

type FixtureEntry = { category: string; name: string; file: string };

const EDGES: Array<[string, string]> = [
  ['head', 'neck'],
  ['neck', 'left_shoulder'],
  ['neck', 'right_shoulder'],
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_hand'],
  ['right_shoulder', 'right_hand'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  ['left_hip', 'left_knee'],
  ['right_hip', 'right_knee'],
];

const ANGLE_ARCS: Array<{
  key: string;
  vertex: string;
  a: string;
  b: string;
}> = [
  { key: 'leftElbow', vertex: 'left_shoulder', a: 'neck', b: 'left_hand' },
  { key: 'rightElbow', vertex: 'right_shoulder', a: 'neck', b: 'right_hand' },
  { key: 'leftKnee', vertex: 'left_hip', a: 'left_shoulder', b: 'left_knee' },
  { key: 'rightKnee', vertex: 'right_hip', a: 'right_shoulder', b: 'right_knee' },
];

const SPEEDS = [0.25, 0.5, 1, 2, 4];

const FAULT_HINTS: Record<string, string> = {
  'back-turned': 'Subject facing away — confidence should drop but reps still count.',
  'bounce-noise': 'High-frequency noise on signal — filter must reject without missing reps.',
  'camera-facing': 'Clean front-on view — baseline case.',
  'occlusion-brief': 'Short occlusion mid-rep — tracker should coast through.',
  'occlusion-long': 'Long occlusion — tracker should pause rep counting until recovered.',
  'crowd-noise': 'Multiple skeletons — subject identity must stick to one.',
  'extreme-oblique-side': 'Steep side angle — 2D signal degraded.',
  'partial-body-upper-only': 'Lower body missing — reps detectable from upper joints only.',
  'person-walkthrough-brief': 'Brief intruder crosses frame — must ignore.',
  'person-walkthrough-steals': 'Intruder closer to camera — identity lock tested.',
  'skeleton-on-object': 'False skeleton on static object — reject.',
  'skeleton-on-object-crucifix': 'Static crucifix-pose skeleton — reject false reps.',
  'subject-switch-and-return': 'Subject leaves and returns — resume on same identity.',
  'tracking-flicker': 'Intermittent tracking dropouts — reps should still count.',
};

function confidenceColor(c: number): string {
  const t = Math.max(0, Math.min(1, c));
  const r = Math.round(255 * (1 - t));
  const g = Math.round(200 * t + 40);
  return `rgb(${r},${g},80)`;
}

export function FixtureViewer({ fixtures }: { fixtures: FixtureEntry[] }) {
  const [selected, setSelected] = useState<string | null>(fixtures[0]?.file ?? null);
  const [frames, setFrames] = useState<Frame[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showTrail, setShowTrail] = useState(true);
  const [showLabels, setShowLabels] = useState(false);
  const [showArcs, setShowArcs] = useState(true);
  const [showStartRef, setShowStartRef] = useState(true);
  const [showPeakRef, setShowPeakRef] = useState(true);
  const [showRomEnvelope, setShowRomEnvelope] = useState(false);
  const [background, setBackground] = useState<
    'studio' | 'gym' | 'blueprint' | 'heatmap' | 'mocap' | 'flat'
  >('studio');
  const [chartAngle, setChartAngle] = useState<string>('leftElbow');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const accumRef = useRef(0);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFrames(null);
    setFrameIdx(0);
    setPlaying(false);
    fetch(`/api/fixtures/${selected}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<Frame[]>;
      })
      .then((data) => !cancelled && setFrames(data))
      .catch((e: unknown) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const stats = useMemo(() => (frames ? computeFixtureStats(frames) : null), [frames]);
  const timestamps = useMemo(() => frames?.map((f) => f.timestampSec) ?? [], [frames]);

  useEffect(() => {
    if (!stats) return;
    if (!stats.angleNames.includes(chartAngle) && stats.angleNames.length > 0) {
      setChartAngle(stats.angleNames.includes('leftElbow') ? 'leftElbow' : stats.angleNames[0]);
    }
  }, [stats, chartAngle]);

  const chartSeries = useMemo(
    () => (frames ? seriesForAngle(frames, chartAngle) : []),
    [frames, chartAngle]
  );
  const confSeries = useMemo(
    () =>
      frames
        ? frames.map((f) => {
            const vals = Object.values(f.joints);
            if (vals.length === 0) return 0;
            return vals.reduce((a, j) => a + j.confidence, 0) / vals.length;
          })
        : [],
    [frames]
  );

  useEffect(() => {
    if (!playing || !frames || frames.length < 2) return;
    const step = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      accumRef.current += dt * speed;
      setFrameIdx((idx) => {
        let next = idx;
        while (next < frames.length - 1) {
          const gap = frames[next + 1].timestampSec - frames[next].timestampSec;
          if (accumRef.current < gap) break;
          accumRef.current -= gap;
          next++;
        }
        if (next >= frames.length - 1) {
          accumRef.current = 0;
          setPlaying(false);
          return frames.length - 1;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = null;
    };
  }, [playing, frames, speed]);

  const heatmap = useMemo(() => {
    if (!frames) return null;
    const N = 48;
    const grid = new Float32Array(N * N);
    let maxVal = 0;
    for (const f of frames) {
      for (const j of Object.values(f.joints)) {
        if (!j.isTracked) continue;
        const gx = Math.min(N - 1, Math.max(0, Math.floor(j.x * N)));
        const gy = Math.min(N - 1, Math.max(0, Math.floor(j.y * N)));
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const cx = gx + ox;
            const cy = gy + oy;
            if (cx < 0 || cx >= N || cy < 0 || cy >= N) continue;
            const w = ox === 0 && oy === 0 ? 1 : 0.35;
            const v = (grid[cy * N + cx] += w);
            if (v > maxVal) maxVal = v;
          }
        }
      }
    }
    return { grid, N, maxVal };
  }, [frames]);

  const peakFrameIdx = useMemo(() => {
    if (!frames || !stats) return -1;
    if (stats.repEvents.length > 0) return stats.repEvents[0];
    const candidates = ['leftElbow', 'rightElbow'].filter((n) =>
      stats.angleNames.includes(n)
    );
    if (candidates.length === 0) return -1;
    let bestIdx = -1;
    let bestVal = Infinity;
    for (let i = 0; i < frames.length; i++) {
      let s = 0;
      let n = 0;
      for (const c of candidates) {
        const v = frames[i].angles[c];
        if (typeof v === 'number') {
          s += v;
          n++;
        }
      }
      const avg = n > 0 ? s / n : Infinity;
      if (avg < bestVal) {
        bestVal = avg;
        bestIdx = i;
      }
    }
    return bestIdx;
  }, [frames, stats]);

  const drawGhostSkeleton = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      frame: Frame,
      width: number,
      height: number,
      color: string,
      alpha: number
    ) => {
      const toPx = (j: Joint) => ({ x: j.x * width, y: j.y * height });
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      for (const [a, b] of EDGES) {
        const ja = frame.joints[a];
        const jb = frame.joints[b];
        if (!ja || !jb) continue;
        const pa = toPx(ja);
        const pb = toPx(jb);
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      for (const j of Object.values(frame.joints)) {
        const p = toPx(j);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },
    []
  );

  const drawFrame = useCallback(
    (canvas: HTMLCanvasElement, frame: Frame, trail: Frame[] | null) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const { width, height } = canvas;

      drawBackground(ctx, width, height, background, heatmap);

      // Axis legend (x right, y down per image convention)
      ctx.strokeStyle = 'rgba(140,184,255,0.6)';
      ctx.fillStyle = 'rgba(140,184,255,0.9)';
      ctx.lineWidth = 2;
      ctx.font = 'bold 11px ui-sans-serif';
      const ox = 18;
      const oy = 18;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + 28, oy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox, oy + 28);
      ctx.stroke();
      ctx.fillText('x→1', ox + 32, oy + 4);
      ctx.fillText('y→1', ox - 4, oy + 44);
      ctx.fillStyle = 'rgba(106,127,160,0.85)';
      ctx.font = '10px ui-sans-serif';
      ctx.fillText('(normalized)', ox - 4, oy - 6);

      const toPx = (j: Joint) => ({ x: j.x * width, y: j.y * height });

      if (showRomEnvelope && frames) {
        ctx.save();
        ctx.fillStyle = 'rgba(140,184,255,0.12)';
        const step = Math.max(1, Math.floor(frames.length / 120));
        for (let i = 0; i < frames.length; i += step) {
          for (const j of Object.values(frames[i].joints)) {
            if (!j.isTracked) continue;
            const p = toPx(j);
            ctx.beginPath();
            ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }

      if (showStartRef && frames && frames.length > 0 && frames[0] !== frame) {
        drawGhostSkeleton(ctx, frames[0], width, height, '#9aa7c2', 0.45);
      }
      if (
        showPeakRef &&
        frames &&
        peakFrameIdx >= 0 &&
        frames[peakFrameIdx] !== frame &&
        peakFrameIdx !== 0
      ) {
        drawGhostSkeleton(ctx, frames[peakFrameIdx], width, height, '#ff4fb1', 0.65);
      }

      if (trail && trail.length > 0) {
        for (let i = 0; i < trail.length; i++) {
          const alpha = (i + 1) / (trail.length + 2);
          const f = trail[i];
          for (const [a, b] of EDGES) {
            const ja = f.joints[a];
            const jb = f.joints[b];
            if (!ja || !jb) continue;
            const pa = toPx(ja);
            const pb = toPx(jb);
            ctx.strokeStyle = `rgba(80,220,255,${alpha * 0.3})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(pa.x, pa.y);
            ctx.lineTo(pb.x, pb.y);
            ctx.stroke();
          }
        }
      }

      // Current skeleton with glow
      ctx.save();
      ctx.shadowColor = 'rgba(80,220,255,0.55)';
      ctx.shadowBlur = 10;
      for (const [a, b] of EDGES) {
        const ja = frame.joints[a];
        const jb = frame.joints[b];
        if (!ja || !jb) continue;
        const pa = toPx(ja);
        const pb = toPx(jb);
        const tracked = ja.isTracked && jb.isTracked;
        ctx.strokeStyle = tracked ? '#38e1ff' : 'rgba(255,120,120,0.75)';
        ctx.lineWidth = tracked ? 3 : 2;
        ctx.setLineDash(tracked ? [] : [6, 4]);
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();

      if (showArcs) {
        for (const arc of ANGLE_ARCS) {
          const jv = frame.joints[arc.vertex];
          const ja = frame.joints[arc.a];
          const jb = frame.joints[arc.b];
          const angle = frame.angles[arc.key];
          if (!jv || !ja || !jb || !Number.isFinite(angle)) continue;
          const pv = toPx(jv);
          const pa = toPx(ja);
          const pb = toPx(jb);
          const aAng = Math.atan2(pa.y - pv.y, pa.x - pv.x);
          const bAng = Math.atan2(pb.y - pv.y, pb.x - pv.x);
          const start = aAng;
          const end = bAng;
          let delta = end - start;
          while (delta > Math.PI) delta -= 2 * Math.PI;
          while (delta < -Math.PI) delta += 2 * Math.PI;
          ctx.strokeStyle = 'rgba(255,209,102,0.8)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(pv.x, pv.y, 18, start, start + delta, delta < 0);
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,209,102,0.95)';
          ctx.font = 'bold 10px ui-sans-serif';
          const midAng = start + delta / 2;
          ctx.fillText(
            `${angle.toFixed(0)}°`,
            pv.x + Math.cos(midAng) * 26 - 8,
            pv.y + Math.sin(midAng) * 26 + 3
          );
        }
      }

      for (const [name, j] of Object.entries(frame.joints)) {
        const p = toPx(j);
        const color = j.isTracked ? confidenceColor(j.confidence) : 'rgba(255,255,255,0.25)';
        ctx.save();
        if (j.isTracked) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 12;
        }
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, j.isTracked ? 6 : 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        if (j.isTracked) {
          ctx.fillStyle = 'rgba(255,255,255,0.95)';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        if (showLabels) {
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.font = '11px ui-sans-serif';
          ctx.fillText(name, p.x + 8, p.y - 6);
        }
      }
    },
    [
      showLabels,
      showArcs,
      showStartRef,
      showPeakRef,
      showRomEnvelope,
      frames,
      peakFrameIdx,
      drawGhostSkeleton,
      background,
      heatmap,
    ]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frames || frames.length === 0) return;
    const trailWindow = 8;
    const trail =
      showTrail && frameIdx > 0
        ? frames.slice(Math.max(0, frameIdx - trailWindow), frameIdx)
        : null;
    drawFrame(canvas, frames[frameIdx], trail);
  }, [frameIdx, frames, drawFrame, showTrail]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.width * dpr);
    canvas.style.height = `${rect.width}px`;
  }, []);

  const current = frames && frames[frameIdx];
  const grouped = useMemo(() => {
    const out: Record<string, FixtureEntry[]> = {};
    for (const f of fixtures) (out[f.category] ??= []).push(f);
    return out;
  }, [fixtures]);

  const selectedName = selected ? selected.split('/')[1]?.replace(/\.json$/, '') ?? '' : '';
  const faultHint = FAULT_HINTS[selectedName];

  const expectedReps = stats?.expected?.repCount;
  const detectedReps = stats?.detectedReps ?? 0;
  const repPass =
    expectedReps == null ? null : Math.abs(detectedReps - expectedReps) <= 1;

  return (
    <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-4 p-6">
      <aside className="rounded-lg bg-[#111a2e] border border-[#1e2a44] p-3 h-fit sticky top-4">
        <h2 className="text-sm font-bold text-[#8cb8ff] mb-3">Fixtures</h2>
        {Object.entries(grouped).map(([cat, items]) => (
          <div key={cat} className="mb-3">
            <div className="text-[11px] uppercase tracking-wide text-[#6a7fa0] mb-1">{cat}</div>
            <ul className="space-y-0.5">
              {items.map((f) => (
                <li key={f.file}>
                  <button
                    type="button"
                    onClick={() => setSelected(f.file)}
                    className={`w-full text-left px-2 py-1.5 rounded text-[13px] transition-colors ${
                      selected === f.file
                        ? 'bg-[#1583ff] text-white'
                        : 'text-[#c4d6f1] hover:bg-[#15213a]'
                    }`}
                  >
                    {f.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </aside>

      <section className="min-w-0 space-y-4">
        <header className="rounded-lg bg-[#111a2e] border border-[#1e2a44] p-4">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-lg font-bold">{selectedName || '—'}</h1>
              {faultHint && (
                <p className="text-[13px] text-[#c4d6f1] mt-0.5 leading-snug">{faultHint}</p>
              )}
            </div>
            {stats && (
              <div className="flex items-baseline gap-4 text-[12px] text-[#8cb8ff]">
                <span>
                  <span className="text-[#6a7fa0]">frames</span>{' '}
                  <span className="font-bold text-white">{stats.frameCount}</span>
                </span>
                <span>
                  <span className="text-[#6a7fa0]">duration</span>{' '}
                  <span className="font-bold text-white">{stats.duration.toFixed(2)}s</span>
                </span>
                <span>
                  <span className="text-[#6a7fa0]">fps</span>{' '}
                  <span className="font-bold text-white">{stats.fps.toFixed(1)}</span>
                </span>
                <span>
                  <span className="text-[#6a7fa0]">joints</span>{' '}
                  <span className="font-bold text-white">{stats.jointNames.length}</span>
                </span>
              </div>
            )}
          </div>
          {stats && (
            <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
              <Badge label="expected reps" value={expectedReps ?? '—'} tone="neutral" />
              <Badge
                label="detected reps"
                value={detectedReps}
                tone={repPass == null ? 'neutral' : repPass ? 'ok' : 'fail'}
                hint={repPass == null ? undefined : repPass ? 'within ±1' : 'mismatch'}
              />
              <Badge
                label="avg confidence"
                value={stats.confidenceAvg.toFixed(2)}
                tone={stats.confidenceAvg > 0.7 ? 'ok' : stats.confidenceAvg > 0.4 ? 'warn' : 'fail'}
              />
              <Badge
                label="avg tracked"
                value={`${(stats.trackedAvg * 100).toFixed(0)}%`}
                tone={stats.trackedAvg > 0.8 ? 'ok' : stats.trackedAvg > 0.5 ? 'warn' : 'fail'}
              />
              <Badge
                label="joint bbox"
                value={`x[${stats.jointBBox.minX.toFixed(2)}-${stats.jointBBox.maxX.toFixed(2)}] y[${stats.jointBBox.minY.toFixed(2)}-${stats.jointBBox.maxY.toFixed(2)}]`}
                tone="neutral"
              />
            </div>
          )}
        </header>

        <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-4">
          <div>
            <div className="rounded-lg overflow-hidden border border-[#1e2a44]">
              <canvas ref={canvasRef} className="w-full block bg-[#0b1220]" />
            </div>

            {loading && <div className="text-[#8cb8ff] mt-3">loading…</div>}
            {error && <div className="text-red-400 mt-3">error: {error}</div>}

            {frames && frames.length > 0 && stats && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setPlaying((p) => !p)}
                    className="bg-[#1583ff] hover:bg-[#0066dd] text-white font-bold px-3 py-1.5 rounded text-sm"
                  >
                    {playing ? 'Pause' : 'Play'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlaying(false);
                      setFrameIdx(0);
                      accumRef.current = 0;
                    }}
                    className="bg-[#15213a] hover:bg-[#1c2c4e] text-white px-3 py-1.5 rounded text-sm"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={() => setFrameIdx((i) => Math.max(0, i - 1))}
                    className="bg-[#15213a] hover:bg-[#1c2c4e] text-white px-2 py-1.5 rounded text-sm"
                  >
                    ◀
                  </button>
                  <button
                    type="button"
                    onClick={() => setFrameIdx((i) => Math.min(frames.length - 1, i + 1))}
                    className="bg-[#15213a] hover:bg-[#1c2c4e] text-white px-2 py-1.5 rounded text-sm"
                  >
                    ▶
                  </button>
                  <div className="flex items-center gap-1 ml-1">
                    {SPEEDS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSpeed(s)}
                        className={`px-2 py-1 rounded text-xs font-bold ${
                          speed === s
                            ? 'bg-[#1583ff] text-white'
                            : 'bg-[#15213a] text-[#c4d6f1] hover:bg-[#1c2c4e]'
                        }`}
                      >
                        {s}×
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 ml-2">
                    <span className="text-[11px] uppercase tracking-wide text-[#6a7fa0]">bg</span>
                    <select
                      value={background}
                      onChange={(e) =>
                        setBackground(e.target.value as typeof background)
                      }
                      className="bg-[#15213a] border border-[#1e2a44] text-white text-[12px] rounded px-2 py-1"
                    >
                      <option value="studio">Studio</option>
                      <option value="gym">Gym (pull-up bar)</option>
                      <option value="blueprint">Blueprint</option>
                      <option value="heatmap">Heatmap (ROM)</option>
                      <option value="mocap">MoCap volume</option>
                      <option value="flat">Flat</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-3 ml-2 text-[13px] text-[#c4d6f1] flex-wrap">
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={showStartRef}
                        onChange={(e) => setShowStartRef(e.target.checked)}
                      />
                      <span className="inline-block w-2 h-2 rounded-full bg-[#8aa1c9]" />
                      Start
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={showPeakRef}
                        onChange={(e) => setShowPeakRef(e.target.checked)}
                      />
                      <span className="inline-block w-2 h-2 rounded-full bg-[#c48bff]" />
                      Peak
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={showRomEnvelope}
                        onChange={(e) => setShowRomEnvelope(e.target.checked)}
                      />
                      ROM
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={showTrail}
                        onChange={(e) => setShowTrail(e.target.checked)}
                      />
                      Trail
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={showArcs}
                        onChange={(e) => setShowArcs(e.target.checked)}
                      />
                      Arcs
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={showLabels}
                        onChange={(e) => setShowLabels(e.target.checked)}
                      />
                      Labels
                    </label>
                  </div>
                </div>

                <input
                  type="range"
                  min={0}
                  max={frames.length - 1}
                  value={frameIdx}
                  onChange={(e) => {
                    setPlaying(false);
                    setFrameIdx(Number(e.target.value));
                  }}
                  className="w-full"
                />
                <div className="flex items-baseline justify-between text-[11px] text-[#6a7fa0]">
                  <span>
                    frame <span className="font-bold text-white">{frameIdx + 1}</span>/
                    {frames.length} · t=
                    <span className="font-bold text-white">
                      {current?.timestampSec.toFixed(3)}
                    </span>
                    s
                  </span>
                  <span>{stats.repEvents.length} rep events detected</span>
                </div>
              </div>
            )}

            {frames && frames.length > 0 && stats && (
              <div className="mt-4 space-y-3">
                <div className="rounded-lg border border-[#1e2a44] bg-[#0b1220] p-3">
                  <div className="flex items-baseline justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] uppercase tracking-wide text-[#6a7fa0]">
                        Angle
                      </span>
                      <select
                        value={chartAngle}
                        onChange={(e) => setChartAngle(e.target.value)}
                        className="bg-[#15213a] border border-[#1e2a44] text-white text-[12px] rounded px-2 py-1"
                      >
                        {stats.angleNames.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                    </div>
                    <span className="text-[12px] text-[#ffd166] font-bold tabular-nums">
                      {Number.isFinite(chartSeries[frameIdx])
                        ? `${chartSeries[frameIdx].toFixed(1)}°`
                        : '—'}
                    </span>
                  </div>
                  <LineChart
                    values={chartSeries}
                    timestamps={timestamps}
                    currentIndex={frameIdx}
                    onScrub={(i) => {
                      setPlaying(false);
                      setFrameIdx(i);
                    }}
                    events={stats.repEvents}
                    yLabel={chartAngle}
                    unit="°"
                    height={160}
                  />
                  <p className="text-[11px] text-[#6a7fa0] mt-1">
                    Click to scrub. Blue dashed lines mark detected rep minima
                    (elbow flexion peaks).
                  </p>
                </div>

                <div className="rounded-lg border border-[#1e2a44] bg-[#0b1220] p-3">
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-[11px] uppercase tracking-wide text-[#6a7fa0]">
                      Avg confidence
                    </span>
                    <span className="text-[12px] text-[#ffd166] font-bold tabular-nums">
                      {Number.isFinite(confSeries[frameIdx])
                        ? confSeries[frameIdx].toFixed(2)
                        : '—'}
                    </span>
                  </div>
                  <LineChart
                    values={confSeries}
                    timestamps={timestamps}
                    currentIndex={frameIdx}
                    onScrub={(i) => {
                      setPlaying(false);
                      setFrameIdx(i);
                    }}
                    yLabel="conf"
                    height={90}
                  />
                </div>
              </div>
            )}
          </div>

          <aside className="space-y-3 text-sm">
            {current && stats && (
              <>
                <div className="rounded-lg bg-[#111a2e] border border-[#1e2a44] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-[#6a7fa0] mb-2">
                    Joints ({stats.jointNames.length})
                  </div>
                  <ul className="space-y-0.5">
                    {stats.jointNames.map((name) => {
                      const j = current.joints[name];
                      if (!j) return null;
                      return (
                        <li
                          key={name}
                          className="flex items-center justify-between text-[12px] gap-2"
                        >
                          <span className="flex items-center gap-1.5">
                            <span
                              className="inline-block w-2 h-2 rounded-full shrink-0"
                              style={{
                                background: j.isTracked
                                  ? confidenceColor(j.confidence)
                                  : 'rgba(255,255,255,0.2)',
                              }}
                            />
                            <span
                              className={
                                j.isTracked ? 'text-[#c4d6f1]' : 'text-[#6a7fa0] line-through'
                              }
                            >
                              {name}
                            </span>
                          </span>
                          <span className="tabular-nums text-[11px] text-[#8cb8ff]">
                            {j.x.toFixed(2)},{j.y.toFixed(2)}
                            <span className="text-[#6a7fa0] ml-1">
                              {j.confidence.toFixed(2)}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div className="rounded-lg bg-[#111a2e] border border-[#1e2a44] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-[#6a7fa0] mb-2">
                    Angles
                  </div>
                  <ul className="space-y-0.5">
                    {stats.angleNames.map((k) => {
                      const v = current.angles[k];
                      const active = k === chartAngle;
                      return (
                        <li
                          key={k}
                          className={`flex items-baseline justify-between text-[12px] px-1 rounded ${
                            active ? 'bg-[#15213a]' : ''
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setChartAngle(k)}
                            className={`text-left ${
                              active ? 'text-[#ffd166] font-bold' : 'text-[#c4d6f1]'
                            }`}
                          >
                            {k}
                          </button>
                          <span className="font-bold tabular-nums">{v?.toFixed(1)}°</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {stats.expected && (
                  <div className="rounded-lg bg-[#111a2e] border border-[#1e2a44] p-3">
                    <div className="text-[11px] uppercase tracking-wide text-[#6a7fa0] mb-2">
                      Expected (ground truth)
                    </div>
                    <ul className="space-y-0.5 text-[12px]">
                      {Object.entries(stats.expected).map(([k, v]) => (
                        <li key={k} className="flex items-baseline justify-between">
                          <span className="text-[#c4d6f1]">{k}</span>
                          <span className="font-bold tabular-nums">{String(v)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}

type BgPreset = 'studio' | 'gym' | 'blueprint' | 'heatmap' | 'mocap' | 'flat';
type Heatmap = { grid: Float32Array; N: number; maxVal: number } | null;

function drawBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  preset: BgPreset,
  heatmap: Heatmap
) {
  if (preset === 'flat') {
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (preset === 'studio') {
    drawStudio(ctx, w, h);
    return;
  }
  if (preset === 'gym') {
    drawGym(ctx, w, h);
    return;
  }
  if (preset === 'blueprint') {
    drawBlueprint(ctx, w, h);
    return;
  }
  if (preset === 'mocap') {
    drawMocap(ctx, w, h);
    return;
  }
  if (preset === 'heatmap') {
    drawHeatmap(ctx, w, h, heatmap);
    return;
  }
}

function drawStudio(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#0a1020');
  sky.addColorStop(0.55, '#0b1730');
  sky.addColorStop(1, '#060a18');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  const horizon = h * 0.55;
  ctx.save();
  ctx.strokeStyle = 'rgba(90,130,200,0.18)';
  ctx.lineWidth = 1;
  for (let i = -10; i <= 10; i++) {
    const fx = w / 2 + (i / 10) * (w * 0.55);
    ctx.beginPath();
    ctx.moveTo(w / 2, horizon);
    ctx.lineTo(fx, h);
    ctx.stroke();
  }
  for (let row = 1; row <= 8; row++) {
    const t = row / 8;
    const y = horizon + (h - horizon) * Math.pow(t, 1.7);
    const span = w * 0.55 * Math.pow(t, 1.2);
    ctx.strokeStyle = `rgba(90,130,200,${0.08 + 0.18 * t})`;
    ctx.beginPath();
    ctx.moveTo(w / 2 - span, y);
    ctx.lineTo(w / 2 + span, y);
    ctx.stroke();
  }
  ctx.restore();
  const glow = ctx.createRadialGradient(
    w / 2,
    horizon,
    0,
    w / 2,
    horizon,
    Math.max(w, h) * 0.45
  );
  glow.addColorStop(0, 'rgba(70,120,220,0.22)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  const v = ctx.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.35,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.75
  );
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

function drawGym(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const wall = ctx.createLinearGradient(0, 0, 0, h);
  wall.addColorStop(0, '#1a1710');
  wall.addColorStop(0.6, '#15130d');
  wall.addColorStop(1, '#080705');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, h);
  // brick pattern
  ctx.save();
  ctx.strokeStyle = 'rgba(255,180,90,0.05)';
  ctx.lineWidth = 1;
  const brickH = 22;
  const brickW = 60;
  for (let y = 0; y < h; y += brickH) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    const offset = (y / brickH) % 2 === 0 ? 0 : brickW / 2;
    for (let x = -offset; x < w; x += brickW) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + brickH);
      ctx.stroke();
    }
  }
  ctx.restore();
  // pull-up bar overhead — at ~y=0.18 matching typical fixture hand grasp band
  const barY = h * 0.18;
  ctx.save();
  ctx.fillStyle = '#b7b7bd';
  ctx.fillRect(w * 0.18, barY - 4, w * 0.64, 6);
  ctx.fillStyle = '#7a7a80';
  ctx.fillRect(w * 0.18, barY - 4, w * 0.64, 2);
  // bar mounts
  ctx.fillStyle = '#32323a';
  ctx.fillRect(w * 0.16, 0, w * 0.02, barY + 12);
  ctx.fillRect(w * 0.82, 0, w * 0.02, barY + 12);
  ctx.restore();
  // floor
  const floorY = h * 0.82;
  ctx.fillStyle = '#1b150c';
  ctx.fillRect(0, floorY, w, h - floorY);
  ctx.strokeStyle = 'rgba(255,180,90,0.1)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, floorY);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  // vignette
  const v = ctx.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.3,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.75
  );
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

function drawBlueprint(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#0a2a5c';
  ctx.fillRect(0, 0, w, h);
  // minor grid (every 5%)
  ctx.strokeStyle = 'rgba(180,220,255,0.08)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 20; i++) {
    const x = (w / 20) * i;
    const y = (h / 20) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  // major grid (every 10%)
  ctx.strokeStyle = 'rgba(180,220,255,0.22)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 10; i++) {
    const x = (w / 10) * i;
    const y = (h / 10) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  // rulers
  ctx.fillStyle = 'rgba(180,220,255,0.65)';
  ctx.font = '10px ui-monospace, monospace';
  for (let i = 0; i <= 10; i++) {
    const x = (w / 10) * i;
    const y = (h / 10) * i;
    ctx.fillText(`${(i * 10) | 0}`, x + 3, 11);
    ctx.fillText(`${(i * 10) | 0}`, 3, y - 2);
  }
  // center crosshair
  ctx.strokeStyle = 'rgba(180,220,255,0.35)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawMocap(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(0, 0, w, h);
  // checkerboard floor (lower 60%)
  const floorTop = h * 0.4;
  const tile = 40;
  for (let y = floorTop; y < h; y += tile) {
    for (let x = 0; x < w; x += tile) {
      const odd = ((x / tile) | 0) + ((y / tile) | 0);
      ctx.fillStyle = odd % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)';
      ctx.fillRect(x, y, tile, tile);
    }
  }
  // corner markers
  const markers = [
    [w * 0.08, h * 0.08],
    [w * 0.92, h * 0.08],
    [w * 0.08, h * 0.92],
    [w * 0.92, h * 0.92],
  ];
  ctx.save();
  for (const [x, y] of markers) {
    ctx.shadowColor = 'rgba(255,100,100,0.8)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#ff4f6f';
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // capture volume outline
  ctx.strokeStyle = 'rgba(255,100,100,0.25)';
  ctx.setLineDash([6, 6]);
  ctx.strokeRect(w * 0.08, h * 0.08, w * 0.84, h * 0.84);
  ctx.setLineDash([]);
  // horizon line
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(0, floorTop);
  ctx.lineTo(w, floorTop);
  ctx.stroke();
}

function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  heatmap: Heatmap
) {
  ctx.fillStyle = '#05070f';
  ctx.fillRect(0, 0, w, h);
  if (!heatmap) return;
  const { grid, N, maxVal } = heatmap;
  if (maxVal <= 0) return;
  const cellW = w / N;
  const cellH = h / N;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const v = grid[y * N + x] / maxVal;
      if (v < 0.02) continue;
      const r = Math.round(255 * Math.pow(v, 0.6));
      const g = Math.round(80 + 120 * v);
      const b = Math.round(255 * (1 - Math.pow(v, 0.9)));
      ctx.fillStyle = `rgba(${r},${g},${b},${0.15 + 0.6 * v})`;
      ctx.fillRect(x * cellW, y * cellH, cellW + 1, cellH + 1);
    }
  }
  // legend hint
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText('joint density', 10, h - 10);
}

function Badge({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string | number;
  tone: 'ok' | 'warn' | 'fail' | 'neutral';
  hint?: string;
}) {
  const toneCls = {
    ok: 'bg-[#0f3820] border-[#1f6b3c] text-[#8dffb9]',
    warn: 'bg-[#3a2e0b] border-[#6b5413] text-[#ffd166]',
    fail: 'bg-[#3a1313] border-[#6b2222] text-[#ff9a9a]',
    neutral: 'bg-[#15213a] border-[#1e2a44] text-[#c4d6f1]',
  }[tone];
  return (
    <span
      className={`inline-flex items-baseline gap-1.5 border rounded-full px-2.5 py-1 ${toneCls}`}
      title={hint}
    >
      <span className="text-[10px] uppercase tracking-wide opacity-70">{label}</span>
      <span className="font-bold tabular-nums text-[12px]">{value}</span>
    </span>
  );
}
