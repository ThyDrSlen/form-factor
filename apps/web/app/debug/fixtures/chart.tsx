'use client';

type ChartProps = {
  values: number[];
  timestamps: number[];
  currentIndex: number;
  onScrub?: (index: number) => void;
  events?: number[];
  yLabel?: string;
  unit?: string;
  height?: number;
};

export function LineChart({
  values,
  timestamps,
  currentIndex,
  onScrub,
  events = [],
  yLabel,
  unit = '',
  height = 140,
}: ChartProps) {
  if (values.length === 0) return null;
  const width = 760;
  const padL = 44;
  const padR = 12;
  const padT = 8;
  const padB = 20;

  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.08;
  min -= pad;
  max += pad;

  const t0 = timestamps[0];
  const tN = timestamps[timestamps.length - 1] || 1;
  const xScale = (t: number) =>
    padL + ((t - t0) / (tN - t0 || 1)) * (width - padL - padR);
  const yScale = (v: number) =>
    padT + (1 - (v - min) / (max - min)) * (height - padT - padB);

  const pathParts: string[] = [];
  let pen = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      pen = false;
      continue;
    }
    const x = xScale(timestamps[i]);
    const y = yScale(v);
    pathParts.push(`${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`);
    pen = true;
  }
  const path = pathParts.join(' ');

  const playheadX = xScale(timestamps[currentIndex] ?? t0);

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onScrub) return;
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const t = t0 + ((px - padL) / (width - padL - padR)) * (tN - t0);
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < timestamps.length; i++) {
      const d = Math.abs(timestamps[i] - t);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    onScrub(bestIdx);
  };

  const ticks = 4;
  const yTicks: Array<{ v: number; y: number }> = [];
  for (let i = 0; i <= ticks; i++) {
    const v = min + ((max - min) * i) / ticks;
    yTicks.push({ v, y: yScale(v) });
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="w-full cursor-crosshair select-none"
      onClick={handleClick}
    >
      <rect x={0} y={0} width={width} height={height} fill="#0b1220" />
      <rect
        x={padL}
        y={padT}
        width={width - padL - padR}
        height={height - padT - padB}
        fill="#0e1830"
        stroke="#1e2a44"
      />
      {yTicks.map((t, i) => (
        <g key={i}>
          <line
            x1={padL}
            x2={width - padR}
            y1={t.y}
            y2={t.y}
            stroke="rgba(255,255,255,0.06)"
          />
          <text
            x={padL - 6}
            y={t.y + 3}
            textAnchor="end"
            fontSize="10"
            fill="#6a7fa0"
          >
            {t.v.toFixed(0)}
            {unit}
          </text>
        </g>
      ))}
      {events.map((idx, i) => {
        const x = xScale(timestamps[idx]);
        return (
          <g key={i}>
            <line
              x1={x}
              x2={x}
              y1={padT}
              y2={height - padB}
              stroke="rgba(21,131,255,0.35)"
              strokeDasharray="3,3"
            />
            <circle cx={x} cy={yScale(values[idx])} r="3.5" fill="#1583ff" />
          </g>
        );
      })}
      <path d={path} stroke="#9ac4ff" strokeWidth="1.5" fill="none" />
      <line
        x1={playheadX}
        x2={playheadX}
        y1={padT}
        y2={height - padB}
        stroke="#ffd166"
        strokeWidth="1.5"
      />
      <circle
        cx={playheadX}
        cy={yScale(values[currentIndex] ?? 0)}
        r="4"
        fill="#ffd166"
      />
      <text x={padL} y={height - 4} fontSize="10" fill="#6a7fa0">
        {t0.toFixed(2)}s
      </text>
      <text
        x={width - padR}
        y={height - 4}
        fontSize="10"
        fill="#6a7fa0"
        textAnchor="end"
      >
        {tN.toFixed(2)}s
      </text>
      {yLabel && (
        <text
          x={8}
          y={padT + 10}
          fontSize="10"
          fill="#8cb8ff"
          fontWeight="bold"
        >
          {yLabel}
        </text>
      )}
    </svg>
  );
}
