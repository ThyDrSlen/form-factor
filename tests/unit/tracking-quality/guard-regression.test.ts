/**
 * Guard regression tests.
 *
 * Runs ALL existing fixture scenarios through HumanValidationGuard and
 * SubjectIdentityTracker to prove that adding the guards does not cause
 * false rejections during normal workouts.
 *
 * These tests are the answer to "how do we know the guards won't break
 * form tracking?" — if a normal fixture fails here, the guard is too
 * aggressive and needs tuning.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { PullupFixtureFrame } from '@/lib/debug/pullup-fixture-corpus';
import { HumanValidationGuard } from '@/lib/tracking-quality/human-validation';
import { SubjectIdentityTracker } from '@/lib/tracking-quality/subject-identity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFixture(dir: string, name: string): PullupFixtureFrame[] {
  const filePath = path.join(process.cwd(), 'tests', 'fixtures', dir, `${name}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fixtureExists(dir: string, name: string): boolean {
  const filePath = path.join(process.cwd(), 'tests', 'fixtures', dir, `${name}.json`);
  return fs.existsSync(filePath);
}

type GuardPassRates = {
  totalFrames: number;
  humanPassRate: number;
  subjectPassRate: number;
  bothPassRate: number;
  framesWithJoints: number;
};

function runGuards(frames: PullupFixtureFrame[]): GuardPassRates {
  const humanGuard = new HumanValidationGuard();
  const subjectTracker = new SubjectIdentityTracker();

  let humanPass = 0;
  let subjectPass = 0;
  let bothPass = 0;
  let withJoints = 0;

  for (const frame of frames) {
    if (!frame.joints) continue;
    withJoints++;

    const jointsRecord = frame.joints as Record<
      string,
      { x: number; y: number; isTracked: boolean; confidence?: number }
    >;

    const humanResult = humanGuard.step(jointsRecord);
    const subjectResult = subjectTracker.step(jointsRecord);

    if (humanResult.isHuman) humanPass++;
    if (!subjectResult.switchDetected) subjectPass++;
    if (humanResult.isHuman && !subjectResult.switchDetected) bothPass++;
  }

  return {
    totalFrames: frames.length,
    framesWithJoints: withJoints,
    humanPassRate: withJoints > 0 ? humanPass / withJoints : 0,
    subjectPassRate: withJoints > 0 ? subjectPass / withJoints : 0,
    bothPassRate: withJoints > 0 ? bothPass / withJoints : 0,
  };
}

// ---------------------------------------------------------------------------
// Pullup fixtures — 11 scenarios
// ---------------------------------------------------------------------------

const PULLUP_FIXTURES = [
  'camera-facing',
  'back-turned',
  'back-turned-multi',
  'back-turned-no-deadhang',
  'bounce-noise',
  'fatigue-degradation',
  'occlusion-brief',
  'occlusion-long',
  'side-angle',
  'tracking-dropout-recovery',
  'vertical-displacement',
] as const;

describe('guard regression — pullup fixtures', () => {
  for (const name of PULLUP_FIXTURES) {
    const exists = fixtureExists('pullup-tracking', name);
    const runner = exists ? test : test.skip;
    runner(`${name}: guards pass >90% of frames`, () => {
      const frames = loadFixture('pullup-tracking', name);
      const rates = runGuards(frames);

      // Every normal fixture should pass human validation on the vast majority of frames.
      // The only exception is occlusion-long where many frames have isTracked=false,
      // but even then the tracked frames should pass.
      expect(rates.humanPassRate).toBeGreaterThanOrEqual(0.90);

      // Subject identity should never flag a switch in single-person fixtures.
      expect(rates.subjectPassRate).toBeGreaterThanOrEqual(0.95);

      // Combined pass rate
      expect(rates.bothPassRate).toBeGreaterThanOrEqual(0.88);
    });
  }
});

// ---------------------------------------------------------------------------
// Pushup fixtures — 4 scenarios
// ---------------------------------------------------------------------------

const PUSHUP_FIXTURES = ['camera-facing', 'fast-reps', 'partial-rom', 'side-angle'] as const;

describe('guard regression — pushup fixtures', () => {
  for (const name of PUSHUP_FIXTURES) {
    const exists = fixtureExists('pushup-tracking', name);
    const runner = exists ? test : test.skip;
    runner(`${name}: guards pass >90% of frames`, () => {
      const frames = loadFixture('pushup-tracking', name);
      const rates = runGuards(frames);

      expect(rates.humanPassRate).toBeGreaterThanOrEqual(0.90);
      expect(rates.subjectPassRate).toBeGreaterThanOrEqual(0.95);
      expect(rates.bothPassRate).toBeGreaterThanOrEqual(0.88);
    });
  }
});

// ---------------------------------------------------------------------------
// Squat fixtures — 4 scenarios
// ---------------------------------------------------------------------------

const SQUAT_FIXTURES = ['camera-facing', 'back-facing', 'heavy-slow', 'partial-rom'] as const;

describe('guard regression — squat fixtures', () => {
  for (const name of SQUAT_FIXTURES) {
    const exists = fixtureExists('squat-tracking', name);
    const runner = exists ? test : test.skip;
    runner(`${name}: guards pass >90% of frames`, () => {
      const frames = loadFixture('squat-tracking', name);
      const rates = runGuards(frames);

      expect(rates.humanPassRate).toBeGreaterThanOrEqual(0.90);
      expect(rates.subjectPassRate).toBeGreaterThanOrEqual(0.95);
      expect(rates.bothPassRate).toBeGreaterThanOrEqual(0.88);
    });
  }
});

// ---------------------------------------------------------------------------
// Aggregate sanity check
// ---------------------------------------------------------------------------

describe('guard regression — aggregate', () => {
  test('average pass rate across all fixtures is >95%', () => {
    const allFixtures = [
      ...PULLUP_FIXTURES.map((n) => ({ dir: 'pullup-tracking', name: n })),
      ...PUSHUP_FIXTURES.map((n) => ({ dir: 'pushup-tracking', name: n })),
      ...SQUAT_FIXTURES.map((n) => ({ dir: 'squat-tracking', name: n })),
    ].filter((f) => fixtureExists(f.dir, f.name));

    let totalBothPass = 0;
    let totalWithJoints = 0;

    for (const { dir, name } of allFixtures) {
      const frames = loadFixture(dir, name);
      const rates = runGuards(frames);
      totalBothPass += rates.bothPassRate * rates.framesWithJoints;
      totalWithJoints += rates.framesWithJoints;
    }

    const avgPassRate = totalWithJoints > 0 ? totalBothPass / totalWithJoints : 0;
    expect(avgPassRate).toBeGreaterThanOrEqual(0.95);
  });
});
