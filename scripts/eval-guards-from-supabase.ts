/**
 * Evaluate validation guards against real ARKit data from Supabase.
 *
 * Pulls pose_samples with joint_positions (2D) from the database and
 * replays them through HumanValidationGuard and SubjectIdentityTracker.
 *
 * Usage:
 *   echo "SELECT ..." | bunx supabase db query --linked -o json > /tmp/real-poses.json
 *   bunx tsx scripts/eval-guards-from-supabase.ts /tmp/real-poses.json
 *
 * Or pipe directly:
 *   echo "SELECT frame_timestamp, left_elbow_deg, ..., joint_positions FROM pose_samples
 *         WHERE session_id = 'xxx' AND joint_positions IS NOT NULL
 *         ORDER BY frame_timestamp ASC;" \
 *     | bunx supabase db query --linked -o json \
 *     | bunx tsx scripts/eval-guards-from-supabase.ts -
 */

import fs from 'node:fs';
import { HumanValidationGuard } from '../lib/tracking-quality/human-validation';
import { SubjectIdentityTracker } from '../lib/tracking-quality/subject-identity';

type Joint2D = { x: number; y: number; isTracked: boolean; confidence?: number };
type Row = {
  frame_timestamp: number;
  joint_positions: Record<string, Joint2D> | null;
  phase?: string;
  rep_number?: number | null;
  left_elbow_deg?: string;
  right_elbow_deg?: string;
};

function loadRows(pathOrStdin: string): Row[] {
  let raw: string;
  if (pathOrStdin === '-') {
    raw = fs.readFileSync('/dev/stdin', 'utf8');
  } else {
    raw = fs.readFileSync(pathOrStdin, 'utf8');
  }

  const parsed = JSON.parse(raw);
  return parsed.rows ?? parsed;
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.log('Usage: bunx tsx scripts/eval-guards-from-supabase.ts <path-to-json | ->');
    console.log('\nThe JSON should have Supabase query output with joint_positions JSONB.');
    console.log('Run this AFTER recording a session with the updated pose logger that');
    console.log('now includes joints2D data in joint_positions.');
    process.exit(1);
  }

  const rows = loadRows(inputPath);
  console.log(`Loaded ${rows.length} frames`);

  const withJoints = rows.filter((r) => r.joint_positions != null);
  console.log(`Frames with joint_positions: ${withJoints.length} / ${rows.length}`);

  if (withJoints.length === 0) {
    console.log('\nNo frames with joint_positions data.');
    console.log('The pose logger was updated to save 2D joint positions.');
    console.log('Record a new session on device, then re-run this script.');
    process.exit(0);
  }

  // Run guards
  const humanGuard = new HumanValidationGuard();
  const subjectTracker = new SubjectIdentityTracker();

  let humanPass = 0;
  let humanFail = 0;
  let subjectPass = 0;
  let switchFrames = 0;
  const rejectionReasons: Record<string, number> = {};

  for (const row of withJoints) {
    const joints = row.joint_positions!;
    const humanResult = humanGuard.step(joints);
    const subjectResult = subjectTracker.step(joints);

    if (humanResult.isHuman) {
      humanPass++;
    } else {
      humanFail++;
      const reason = humanResult.rejectionReason ?? 'unknown';
      rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
    }

    if (!subjectResult.switchDetected) {
      subjectPass++;
    } else {
      switchFrames++;
    }
  }

  const total = withJoints.length;

  console.log('\n--- Human Validation Guard ---');
  console.log(`  Pass: ${humanPass} / ${total} (${((humanPass / total) * 100).toFixed(1)}%)`);
  console.log(`  Fail: ${humanFail} / ${total} (${((humanFail / total) * 100).toFixed(1)}%)`);
  if (Object.keys(rejectionReasons).length > 0) {
    console.log('  Rejection reasons:');
    for (const [reason, count] of Object.entries(rejectionReasons)) {
      console.log(`    ${reason}: ${count}`);
    }
  }

  console.log('\n--- Subject Identity Tracker ---');
  console.log(`  Original subject: ${subjectPass} / ${total} (${((subjectPass / total) * 100).toFixed(1)}%)`);
  console.log(`  Switch detected: ${switchFrames} / ${total} (${((switchFrames / total) * 100).toFixed(1)}%)`);
  console.log(`  Calibrated: ${subjectTracker.getSnapshot().isCalibrated}`);
  if (subjectTracker.getSnapshot().signature) {
    const sig = subjectTracker.getSnapshot().signature!;
  console.log(`  Baseline signature: shoulder=${sig.shoulderWidth.toFixed(4)} torso=${sig.torsoLength.toFixed(4)} arm=${sig.armRatio.toFixed(4)}`);
  }

  console.log('\n--- Verdict ---');
  const bothPassRate = (humanPass / total) * (subjectPass / total);
  if (humanPass / total >= 0.9 && subjectPass / total >= 0.95) {
    console.log('PASS: Guards would not interfere with normal tracking.');
  } else {
    console.log('WARN: Guards may be too aggressive for real ARKit data.');
    console.log('Review rejection reasons and tune thresholds.');
  }
}

main();
