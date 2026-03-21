import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Form Factor — Real-time Form Coaching from Your Phone Camera',
  description:
    'Form Factor counts reps, flags faults, and logs sets automatically. Think Strava for lifting with instant cues powered by ARKit.',
};

const valueProps = [
  { title: 'Real-time cues', body: 'ARKit + Vision Camera detects reps and flags swing, depth, ROM, and tempo as you move.' },
  { title: 'Auto logging', body: 'Sets, reps, and weight captured automatically; no fiddling with inputs between sets.' },
  { title: 'Health-aware coach', body: 'AI adapts to sleep, HR, and recent load pulled from HealthKit to nudge form or intensity.' },
  { title: 'Built for lifters', body: 'Offline-first, fast logging, iOS-first experience with feed and video capture baked in.' },
];

const howItWorks = [
  { step: '01', title: 'Point your camera', body: 'Track every rep in real time with a simple setup.' },
  { step: '02', title: 'Get instant cues', body: 'Fix swing, depth, ROM, and tempo mid-set instead of after the fact.' },
  { step: '03', title: 'Auto-log sets', body: 'Capture reps and weight automatically; syncs cleanly when back online.' },
  { step: '04', title: 'Coach adjusts', body: 'AI suggestions shift when sleep dips or load spikes.' },
];

const featureDeepDive = [
  {
    title: 'Rep and form tracking',
    body: 'ARKit body tracking, Vision Camera overlays, and optional speech cues keep you honest on each rep.',
    bullets: ['Push-up and pull-up detection', 'Video capture/upload with metrics JSON', 'Overlay and feed ready on web'],
  },
  {
    title: 'Health and recovery context',
    body: 'HealthKit read/import for activity, HR, weight, and sleep feeds the coach so cues stay realistic.',
    bullets: ['Trends and bulk sync to Supabase', 'Watch connectivity helpers', 'Coach context tags: sleep dip, high HR'],
  },
  {
    title: 'Logging and sync built for speed',
    body: 'Offline-first SQLite with retrying sync queue and conflict guards means no lost sets or foods.',
    bullets: ['Fast add/delete for foods and workouts', 'Realtime backfill per user', 'Safe conflict handling for edits'],
  },
  {
    title: 'Video feed and social proof',
    body: 'Private uploads with signed thumbnails plus comments and likes keep the community accountable.',
    bullets: ['Signed URLs with expiring access', 'Media buckets for videos and thumbnails', 'Playback via VideoView'],
  },
];

const reliabilityBadges = [
  'Offline-first with retrying sync',
  'Supabase RLS on user data',
  'Private media buckets by default',
  'Notification hygiene and pruning',
];

const roadmapChips = [
  'Periodization planning',
  'Progressive overload tracking',
  'Goal-based templates',
  'Richer social/feed',
  'Android parity',
];

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="max-w-[1180px] mx-auto w-full px-6 mt-14 mb-5">
      <h2 className="text-[28px] font-extrabold text-[#0b1a2f] mb-1.5">{title}</h2>
      <p className="text-base text-[#51607a] leading-relaxed">{subtitle}</p>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#f6f8fb]">
      {/* Hero */}
      <div className="bg-gradient-to-b from-[#f6f9ff] to-[#e9f2ff] pt-8 pb-12 px-6">
        {/* Navbar */}
        <div className="max-w-[1180px] mx-auto w-full flex items-center justify-between mb-7">
          <div className="flex items-center gap-2.5">
            <div className="h-[42px] w-[42px] rounded-xl bg-[#0b1b34] flex items-center justify-center text-white font-bold text-lg">
              FF
            </div>
            <span className="text-lg font-bold text-[#0b1a2f]">Form Factor</span>
          </div>
          <div className="hidden md:flex items-center gap-4.5">
            <span className="text-sm text-[#51607a] font-semibold cursor-pointer hover:text-[#0b1a2f] transition-colors">Product</span>
            <span className="text-sm text-[#51607a] font-semibold cursor-pointer hover:text-[#0b1a2f] transition-colors">Features</span>
            <span className="text-sm text-[#51607a] font-semibold cursor-pointer hover:text-[#0b1a2f] transition-colors">Coach</span>
            <span className="text-sm text-[#51607a] font-semibold cursor-pointer hover:text-[#0b1a2f] transition-colors">Roadmap</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/sign-in"
              className="text-sm text-[#51607a] font-semibold hover:text-[#0b1a2f] transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="bg-[#0b1a2f] text-white px-4 py-2.5 rounded-full text-sm font-bold hover:bg-[#1a2d47] transition-colors"
            >
              Get started
            </Link>
          </div>
        </div>

        {/* Hero Content */}
        <div className="max-w-[1180px] mx-auto w-full flex flex-col lg:flex-row gap-7">
          <div className="flex-1 flex flex-col gap-3.5">
            <span className="self-start bg-[#e5efff] text-[#1583ff] px-3 py-2 rounded-full text-[13px] font-bold">
              Real-time form coaching
            </span>
            <h1 className="text-[42px] font-extrabold text-[#0b1a2f] leading-[48px]">
              Real-time form coaching from your phone camera.
            </h1>
            <p className="text-lg text-[#51607a] leading-relaxed">
              Form Factor counts reps, flags faults, and logs sets automatically — think Strava for lifting with instant cues.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/sign-up"
                className="bg-[#1583ff] text-white px-4.5 py-3 rounded-full text-[15px] font-bold shadow-lg shadow-[#003a73]/15 hover:bg-[#0066dd] transition-colors"
              >
                Get started free
              </Link>
              <Link
                href="/sign-in"
                className="border border-[#0b1a2f] bg-white text-[#0b1a2f] px-4.5 py-3 rounded-full text-[15px] font-bold hover:bg-gray-50 transition-colors"
              >
                Sign in
              </Link>
            </div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-sm text-[#51607a] font-semibold">Offline-first logging</span>
              <span className="h-1.5 w-1.5 rounded-full bg-[#c4cfe5]" />
              <span className="text-sm text-[#51607a] font-semibold">HealthKit-aware coach</span>
              <span className="h-1.5 w-1.5 rounded-full bg-[#c4cfe5]" />
              <span className="text-sm text-[#51607a] font-semibold">ARKit rep detection</span>
            </div>
          </div>

          {/* Hero Mock */}
          <div className="flex-1">
            <div className="bg-gradient-to-b from-[#0b1b34] to-[#10335c] rounded-[22px] p-4.5 shadow-2xl shadow-[#001026]/35">
              <div className="flex justify-between items-center mb-4">
                <span className="text-white font-bold">Live rep analysis</span>
                <span className="text-[#a7c3ff] text-[13px] font-semibold">ARKit + Vision Camera</span>
              </div>
              <div className="bg-[#0a233f] rounded-2xl border border-[#1c3b62] p-4.5 min-h-[200px] flex flex-col justify-between">
                <span className="text-[#c6dbff] font-semibold text-sm">Camera overlay with cues</span>
                <div className="space-y-2.5 mt-4">
                  <div className="bg-[#1f65d6] px-3 py-2.5 rounded-xl">
                    <span className="text-white font-bold text-sm">Pull-up: reduce swing</span>
                  </div>
                  <div className="bg-[#0f3058] border border-[#285c9c] px-3 py-2.5 rounded-xl">
                    <span className="text-[#b7d3ff] font-semibold text-sm">Depth good &middot; Reps: 8</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex justify-between items-center">
                <span className="text-[#a7c3ff] font-semibold text-sm">Auto-logging enabled</span>
                <span className="text-white font-bold text-sm">Set saved</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Value Props */}
      <SectionHeader title="Built for lifters" subtitle="Precise cues, fast logging, HealthKit-aware coaching." />
      <div className="max-w-[1180px] mx-auto w-full px-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {valueProps.map((item) => (
          <div key={item.title} className="bg-white rounded-2xl p-4.5 border border-[#dfe7f5]">
            <h3 className="text-lg font-bold text-[#0b1a2f] mb-2">{item.title}</h3>
            <p className="text-[15px] text-[#51607a] leading-relaxed">{item.body}</p>
          </div>
        ))}
      </div>

      {/* How It Works */}
      <SectionHeader title="How it works" subtitle="Simple flow from camera to cues to auto-logged sets." />
      <div className="max-w-[1180px] mx-auto w-full px-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {howItWorks.map((item) => (
          <div key={item.step} className="bg-[#0f2746] rounded-[14px] p-4 border border-[#1b3c67]">
            <span className="text-[#29a3ff] font-extrabold text-sm">{item.step}</span>
            <h3 className="text-white text-[17px] font-bold mt-1.5 mb-1.5">{item.title}</h3>
            <p className="text-[#c4d6f1] text-sm leading-relaxed">{item.body}</p>
          </div>
        ))}
      </div>

      {/* Feature Deep Dive */}
      <SectionHeader title="Feature deep dive" subtitle="From ARKit capture to HealthKit-aware coaching and feed." />
      <div className="max-w-[1180px] mx-auto w-full px-6 space-y-4.5">
        {featureDeepDive.map((item, index) => (
          <div
            key={item.title}
            className={`bg-white rounded-[18px] border border-[#dfe7f5] flex flex-col ${
              index % 2 === 1 ? 'md:flex-row-reverse' : 'md:flex-row'
            } gap-4.5 p-4.5`}
          >
            <div className="flex-1 flex flex-col gap-2.5">
              <h3 className="text-xl font-extrabold text-[#0b1a2f]">{item.title}</h3>
              <p className="text-[#51607a] text-[15px] leading-relaxed">{item.body}</p>
              <ul className="space-y-2">
                {item.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-2">
                    <span className="h-2 w-2 rounded-full bg-[#1583ff] mt-1.5 shrink-0" />
                    <span className="text-[#51607a] text-sm leading-relaxed">{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex-1 bg-gradient-to-b from-[#0b1b34] to-[#13345c] rounded-[14px] p-4 flex flex-col justify-between min-h-[160px]">
              <span className="text-[#8cb8ff] font-bold text-[13px]">Preview</span>
              <div className="bg-[#0b1b34] rounded-xl p-3.5 border border-[#1a3a64]">
                <h4 className="text-white font-bold mb-1">{item.title}</h4>
                <p className="text-[#c0d3f3] text-sm leading-relaxed">{item.body}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* AI Coach */}
      <SectionHeader title="AI coach with context" subtitle="Adaptive cues that react to recovery, load, and trends." />
      <div className="max-w-[1180px] mx-auto w-full px-6">
        <div className="bg-gradient-to-b from-[#0b1b34] to-[#0f2746] rounded-[18px] p-5 flex flex-col md:flex-row gap-4.5">
          <div className="flex-1 flex flex-col gap-3">
            <h3 className="text-white text-[22px] font-extrabold">Sleep-aware, load-aware, ready to nudge.</h3>
            <p className="text-[#c4d6f1] text-[15px] leading-relaxed">
              Edge Function powered coach that adapts when your sleep dips or volume spikes. Keeps form first when recovery
              is low; pushes intensity when green.
            </p>
            <div className="flex flex-wrap gap-2.5">
              {['Sleep dip', 'HR elevated', 'Recent load high', 'Deload candidate'].map((tag) => (
                <span
                  key={tag}
                  className="bg-[#12355f] border border-[#265c9b] rounded-full py-2 px-3 text-[#d9e8ff] font-bold text-[13px]"
                >
                  {tag}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 mt-1">
              <Link
                href="/sign-up"
                className="bg-[#1583ff] text-white px-4.5 py-3 rounded-full text-[15px] font-bold hover:bg-[#0066dd] transition-colors"
              >
                Talk to the coach
              </Link>
            </div>
          </div>
          <div className="flex-1 space-y-2.5">
            <div className="bg-[#0b1f3b] rounded-[14px] p-3.5 border border-[#1a3a64]">
              <span className="text-[#8cb8ff] font-bold text-[13px]">Coach</span>
              <p className="text-[#dbe8ff] text-sm leading-relaxed mt-1.5">
                Form looks solid. Reduce swing on reps 5-6; aim for slower negatives.
              </p>
            </div>
            <div className="bg-[#0f3058] rounded-[14px] p-3.5 border border-[#1a3a64]">
              <span className="text-[#8cb8ff] font-bold text-[13px]">You</span>
              <p className="text-[#dbe8ff] text-sm leading-relaxed mt-1.5">Energy is low today — slept 6h.</p>
            </div>
            <div className="bg-[#0b1f3b] rounded-[14px] p-3.5 border border-[#1a3a64]">
              <span className="text-[#8cb8ff] font-bold text-[13px]">Coach</span>
              <p className="text-[#dbe8ff] text-sm leading-relaxed mt-1.5">
                Noted. Keep form focus; drop load 10% and hit controlled triples.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Reliability */}
      <SectionHeader title="Reliability and privacy" subtitle="Built-in protections and sync reliability from day one." />
      <div className="max-w-[1180px] mx-auto w-full px-6 flex flex-wrap gap-3">
        {reliabilityBadges.map((item) => (
          <span key={item} className="bg-white rounded-full py-2.5 px-3.5 border border-[#dfe7f5] text-[#0b1a2f] font-bold text-sm">
            {item}
          </span>
        ))}
      </div>

      {/* Roadmap */}
      <SectionHeader title="Roadmap" subtitle="What is coming next." />
      <div className="max-w-[1180px] mx-auto w-full px-6 flex flex-wrap gap-2.5 mb-6">
        {roadmapChips.map((item) => (
          <span
            key={item}
            className="bg-[#0f2746] border border-[#1a3a64] rounded-full py-2.5 px-3.5 text-[#dbe8ff] font-bold text-sm"
          >
            {item}
          </span>
        ))}
      </div>

      {/* Final CTA */}
      <div className="max-w-[1180px] mx-auto w-full px-6">
        <div className="bg-gradient-to-b from-[#0f2746] to-[#13355f] rounded-[18px] py-6.5 px-6">
          <h2 className="text-white text-[22px] font-extrabold mb-2.5">Ready for real-time form coaching?</h2>
          <p className="text-[#c4d6f1] text-[15px] leading-relaxed mb-4">
            Join the iOS-first experience, built for lifters with HealthKit-aware AI.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/sign-up"
              className="bg-[#1583ff] text-white px-4.5 py-3 rounded-full text-[15px] font-bold hover:bg-[#0066dd] transition-colors"
            >
              Get started free
            </Link>
            <Link
              href="/sign-in"
              className="border border-[#c4d6f1] text-[#dbe8ff] px-4.5 py-3 rounded-full text-[15px] font-bold hover:bg-[#1a3a64] transition-colors"
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="max-w-[1180px] mx-auto w-full px-6 mt-8 pb-16 flex flex-wrap justify-between items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-[#0b1b34] flex items-center justify-center text-white font-bold text-xs">
            FF
          </div>
          <span className="text-[#0b1a2f] font-extrabold">Form Factor</span>
        </div>
        <div className="flex flex-wrap gap-3.5">
          {['Docs', 'Support', 'Privacy', 'Terms'].map((link) => (
            <span key={link} className="text-[#51607a] font-bold text-[13px] cursor-pointer hover:text-[#0b1a2f] transition-colors">
              {link}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
