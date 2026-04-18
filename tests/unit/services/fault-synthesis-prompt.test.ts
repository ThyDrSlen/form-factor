import {
  SYSTEM_INSTRUCTION,
  buildFaultSynthesisUserPrompt,
  type FaultGlossarySnippet,
} from '@/lib/services/fault-synthesis-prompt';

const SNIPPET: FaultGlossarySnippet = {
  faultId: 'shallow_depth',
  displayName: 'Shallow Depth',
  shortExplanation: 'You are not descending low enough in the squat.',
  whyItMatters:
    'Shallow squats under-train the glutes and can create imbalances between quad-dominant and hip-dominant strength.',
  fixTips: [
    'Warm up your hip mobility — box-assisted squats or ankle rockers for 90s before your working sets.',
    'Use a bench or box at your target depth as a tactile cue until depth becomes automatic.',
  ],
  relatedFaults: ['forward_lean', 'hip_shift'],
};

describe('fault-synthesis-prompt', () => {
  describe('SYSTEM_INSTRUCTION', () => {
    it('locks the exact system instruction text (snapshot)', () => {
      expect(SYSTEM_INSTRUCTION).toBe(
        'You are a concise strength-and-form coach for Form Factor. Given a cluster of co-occurring form faults, you identify the most likely single root cause and write one user-facing sentence that collapses the cluster into a clear corrective. You receive glossary snippets for each fault. Treat them as reference only — do not quote them verbatim; synthesize. Never invent fault ids beyond those in the input. No medical advice. No mentions of AI, models, or being an assistant. Return ONLY the JSON object described in the user message — no prose, no markdown fences.',
      );
    });

    it('enforces no-meta rules — "AI", "model", "assistant"', () => {
      expect(SYSTEM_INSTRUCTION).toMatch(/No mentions of AI/i);
    });

    it('enforces JSON-only response rule', () => {
      expect(SYSTEM_INSTRUCTION).toMatch(/JSON object/i);
      expect(SYSTEM_INSTRUCTION).toMatch(/no prose/i);
    });
  });

  describe('buildFaultSynthesisUserPrompt', () => {
    it('builds a stable prompt for the minimal canonical input (snapshot)', () => {
      const prompt = buildFaultSynthesisUserPrompt({
        exerciseId: 'squat',
        faultIds: ['shallow_depth'],
        snippets: [SNIPPET],
      });

      expect(prompt).toBe(
        [
          'Exercise: squat',
          'Co-occurring fault ids: shallow_depth',
          'Glossary snippets:',
          '- shallow_depth (Shallow Depth): "You are not descending low enough in the squat." | why: Shallow squats under-train the glutes and can create imbalances between quad-dominant and hip-dominant strength. | fix tips: Warm up your hip mobility — box-assisted squats or ankle rockers for 90s before your working sets. | Use a bench or box at your target depth as a tactile cue until depth becomes automatic. | related: forward_lean,hip_shift',
          'Recent history:',
          '- (no recent history)',
          'Set context:',
          '- (no set context)',
          '',
          'Return a single JSON object with these keys:',
          '  "synthesizedExplanation": one user-facing sentence (<= 35 words) that explains the likely root cause and gives one corrective action. Reference fault names naturally, do not list them.',
          '  "primaryFaultId": the fault id you believe is the primary driver — must be one of the co-occurring ids above.',
          '  "rootCauseHypothesis": 1-4 words naming the underlying cause (e.g. "ankle mobility", "grip fatigue"), or null if unclear.',
          '  "confidence": a number in [0, 1] reflecting how sure you are. Use 0.5 when the cluster is ambiguous.',
          '',
          'Respond with the JSON object ONLY.',
        ].join('\n'),
      );
    });

    it('renders recent-history entries when provided', () => {
      const prompt = buildFaultSynthesisUserPrompt({
        exerciseId: 'squat',
        faultIds: ['shallow_depth'],
        snippets: [SNIPPET],
        history: [
          { faultId: 'shallow_depth', occurrencesInLastNSessions: 4, sessionsSince: 1 },
        ],
      });
      expect(prompt).toContain(
        '- shallow_depth: seen in 4 recent sessions (1 ago)',
      );
      expect(prompt).not.toContain('(no recent history)');
    });

    it('renders set context when provided', () => {
      const prompt = buildFaultSynthesisUserPrompt({
        exerciseId: 'squat',
        faultIds: ['shallow_depth'],
        snippets: [SNIPPET],
        setContext: { repNumber: 7, setNumber: 3, rpe: 8 },
      });
      expect(prompt).toContain('- rep 7 of set 3, rpe 8');
      expect(prompt).not.toContain('(no set context)');
    });

    it('falls back to placeholders when history + setContext are empty/omitted', () => {
      const prompt = buildFaultSynthesisUserPrompt({
        exerciseId: 'squat',
        faultIds: ['shallow_depth'],
        snippets: [SNIPPET],
        history: [],
      });
      expect(prompt).toContain('- (no recent history)');
      expect(prompt).toContain('- (no set context)');
    });

    it('handles snippets without fix tips', () => {
      const prompt = buildFaultSynthesisUserPrompt({
        exerciseId: 'squat',
        faultIds: ['shallow_depth'],
        snippets: [{ ...SNIPPET, fixTips: [] }],
      });
      expect(prompt).toContain('fix tips: (no tips)');
    });

    it('handles empty snippets array with explicit placeholder', () => {
      const prompt = buildFaultSynthesisUserPrompt({
        exerciseId: 'squat',
        faultIds: ['shallow_depth'],
        snippets: [],
      });
      expect(prompt).toContain('- (no snippets provided)');
    });

    it('lists multiple snippets one per line', () => {
      const second: FaultGlossarySnippet = {
        faultId: 'forward_lean',
        displayName: 'Excessive Forward Lean',
        shortExplanation: 'Your torso pitches forward.',
        whyItMatters: 'Shifts load to the lumbar spine.',
        fixTips: ['Brace core harder.'],
        relatedFaults: ['shallow_depth'],
      };
      const prompt = buildFaultSynthesisUserPrompt({
        exerciseId: 'squat',
        faultIds: ['shallow_depth', 'forward_lean'],
        snippets: [SNIPPET, second],
      });
      const snippetLines = prompt
        .split('\n')
        .filter((line) => line.startsWith('- shallow_depth (') || line.startsWith('- forward_lean ('));
      expect(snippetLines.length).toBe(2);
    });

    it('outputs are byte-stable across repeated invocations', () => {
      const input = {
        exerciseId: 'squat',
        faultIds: ['shallow_depth'],
        snippets: [SNIPPET],
      };
      const first = buildFaultSynthesisUserPrompt(input);
      const second = buildFaultSynthesisUserPrompt(input);
      expect(first).toBe(second);
    });
  });
});
