/**
 * Tests pipeline-v2 cue-preference injection in buildDebriefPrompt.
 */

import {
  buildDebriefPrompt,
  renderCuePreferenceClause,
  type DebriefAnalytics,
} from '@/lib/services/coach-debrief-prompt';
import type { CuePreference } from '@/lib/services/coach-cue-feedback';

const FLAG = 'EXPO_PUBLIC_COACH_PIPELINE_V2';
const originalFlag = process.env[FLAG];

afterEach(() => {
  if (originalFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = originalFlag;
});

const analytics: DebriefAnalytics = {
  sessionId: 'sess-1',
  exerciseName: 'Back Squat',
  repCount: 5,
  avgFqi: 0.8,
  fqiTrendSlope: null,
  topFault: null,
  maxSymmetryPct: null,
  tempoTrendSlope: null,
  reps: [],
};

function pref(cueKey: string, score: number, voteCount = 2): CuePreference {
  return { cueKey, score, voteCount, lastVoteAt: Date.now() };
}

describe('renderCuePreferenceClause', () => {
  it('returns empty when prefs are null/empty', () => {
    expect(renderCuePreferenceClause(null)).toBe('');
    expect(renderCuePreferenceClause([])).toBe('');
  });

  it('renders preferred + disliked segments above threshold', () => {
    const prefs = [pref('drive_through_heels', 0.8), pref('squeeze_glutes', -0.5)];
    const out = renderCuePreferenceClause(prefs);
    expect(out).toContain('User prefers drive_through_heels cues');
    expect(out).toContain('dislikes squeeze_glutes cues');
  });

  it('filters out weak signals below threshold', () => {
    const prefs = [pref('weak_cue', 0.1), pref('normal', 0)];
    expect(renderCuePreferenceClause(prefs)).toBe('');
  });
});

describe('buildDebriefPrompt cue-preferences wiring (pipeline-v2)', () => {
  it('renders the clause when flag is on and prefs are provided', () => {
    process.env[FLAG] = 'on';
    const [systemMsg] = buildDebriefPrompt(analytics, {
      cuePreferences: [pref('chest_up', 0.9)],
    });
    expect(systemMsg.content).toContain('User prefers chest_up cues');
  });

  it('skips the clause when flag is off', () => {
    delete process.env[FLAG];
    const [systemMsg] = buildDebriefPrompt(analytics, {
      cuePreferences: [pref('chest_up', 0.9)],
    });
    expect(systemMsg.content).not.toContain('User prefers');
  });

  it('skips the clause when prefs are empty / null', () => {
    process.env[FLAG] = 'on';
    const [systemMsg] = buildDebriefPrompt(analytics, {
      cuePreferences: null,
    });
    expect(systemMsg.content).not.toContain('User prefers');
  });
});
