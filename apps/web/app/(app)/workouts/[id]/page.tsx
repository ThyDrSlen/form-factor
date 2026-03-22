import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { formatDate } from '@/lib/utils';
import type { GoalProfile } from '@form-factor/shared/types/workout-session';

interface SetRow {
  id: string;
  sort_order: number;
  set_type: string;
  planned_reps: number | null;
  actual_reps: number | null;
  planned_weight: number | null;
  actual_weight: number | null;
  tut_ms: number | null;
  perceived_rpe: number | null;
  completed_at: string | null;
}

interface ExerciseRow {
  id: string;
  sort_order: number;
  notes: string | null;
  exercise: { name: string; category: string | null } | null;
  sets: SetRow[];
}

interface SessionDetail {
  id: string;
  name: string | null;
  goal_profile: GoalProfile;
  started_at: string;
  ended_at: string | null;
  bodyweight_lb: number | null;
  notes: string | null;
  template: { name: string } | null;
  exercises: ExerciseRow[];
}

interface RepRow {
  rep_index: number;
  fqi: number | null;
  faults_detected: string[] | null;
}

const setTypeLabels: Record<string, string> = {
  normal: '',
  warmup: 'W',
  dropset: 'D',
  amrap: 'AMRAP',
  failure: 'F',
  timed: 'T',
};

function fqiColor(fqi: number): string {
  if (fqi >= 80) return 'text-success';
  if (fqi >= 60) return 'text-accent';
  if (fqi >= 40) return 'text-yellow-400';
  return 'text-red-400';
}

export default async function WorkoutDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: session } = await supabase
    .from('workout_sessions')
    .select(`
      id, name, goal_profile, started_at, ended_at, bodyweight_lb, notes,
      template:workout_templates(name),
      exercises:workout_session_exercises(
        id, sort_order, notes,
        exercise:exercises(name, category),
        sets:workout_session_sets(
          id, sort_order, set_type, planned_reps, actual_reps,
          planned_weight, actual_weight, tut_ms, perceived_rpe, completed_at
        )
      )
    `)
    .eq('id', id)
    .maybeSingle();

  if (!session) notFound();

  const workout = session as unknown as SessionDetail;
  const displayName = workout.name || workout.template?.name || 'Workout';
  const durationMin = workout.ended_at
    ? Math.round((new Date(workout.ended_at).getTime() - new Date(workout.started_at).getTime()) / 60000)
    : null;

  // Fetch rep-level data for FQI display
  const { data: repsData } = await supabase
    .from('reps')
    .select('rep_index, fqi, faults_detected')
    .eq('session_id', id)
    .order('rep_index', { ascending: true })
    .limit(200);

  const reps = (repsData ?? []) as RepRow[];
  const validFqi = reps.filter((r) => r.fqi !== null).map((r) => r.fqi!);
  const avgFqi = validFqi.length > 0 ? Math.round(validFqi.reduce((a, b) => a + b, 0) / validFqi.length) : null;

  const totalSets = workout.exercises?.reduce((sum, ex) => sum + (ex.sets?.length ?? 0), 0) ?? 0;
  const completedSets = workout.exercises?.reduce(
    (sum, ex) => sum + (ex.sets?.filter((s) => s.completed_at).length ?? 0),
    0
  ) ?? 0;

  return (
    <div>
      <Link href="/workouts" className="text-sm text-accent hover:underline mb-4 inline-block">
        &larr; Back to workouts
      </Link>

      {/* Header */}
      <div className="bg-card border border-line rounded-2xl p-6 mb-4">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">{displayName}</h1>
            <p className="text-sm text-text-muted mt-1">{formatDate(workout.started_at)}</p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-accent/15 text-accent">
            {workout.goal_profile}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-panel rounded-xl px-3 py-2.5 text-center">
            <span className="text-xs text-text-muted block">Duration</span>
            <span className="text-lg font-bold text-text-primary">{durationMin ? `${durationMin}m` : '--'}</span>
          </div>
          <div className="bg-panel rounded-xl px-3 py-2.5 text-center">
            <span className="text-xs text-text-muted block">Sets</span>
            <span className="text-lg font-bold text-text-primary">{completedSets}/{totalSets}</span>
          </div>
          <div className="bg-panel rounded-xl px-3 py-2.5 text-center">
            <span className="text-xs text-text-muted block">Reps Tracked</span>
            <span className="text-lg font-bold text-text-primary">{reps.length}</span>
          </div>
          <div className="bg-panel rounded-xl px-3 py-2.5 text-center">
            <span className="text-xs text-text-muted block">Avg FQI</span>
            <span className={`text-lg font-bold ${avgFqi !== null ? fqiColor(avgFqi) : 'text-text-muted'}`}>
              {avgFqi !== null ? avgFqi : '--'}
            </span>
          </div>
        </div>

        {workout.bodyweight_lb && (
          <p className="text-sm text-text-secondary mt-3">Bodyweight: {workout.bodyweight_lb} lbs</p>
        )}
        {workout.notes && (
          <p className="text-sm text-text-muted mt-2 italic">{workout.notes}</p>
        )}
      </div>

      {/* Exercises */}
      <div className="space-y-3">
        {workout.exercises
          ?.sort((a, b) => a.sort_order - b.sort_order)
          .map((ex) => (
            <div key={ex.id} className="bg-card border border-line rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-text-primary">
                  {ex.exercise?.name ?? 'Unknown Exercise'}
                </h3>
                {ex.exercise?.category && (
                  <span className="text-xs text-text-muted capitalize">{ex.exercise.category.replace('_', ' ')}</span>
                )}
              </div>

              {/* Sets Table */}
              {ex.sets && ex.sets.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-text-muted text-xs uppercase tracking-wide">
                        <th className="text-left py-1.5 pr-3">Set</th>
                        <th className="text-center py-1.5 px-3">Reps</th>
                        <th className="text-center py-1.5 px-3">Weight</th>
                        <th className="text-center py-1.5 px-3">RPE</th>
                        <th className="text-center py-1.5 pl-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ex.sets
                        .sort((a, b) => a.sort_order - b.sort_order)
                        .map((set, i) => {
                          const typeLabel = setTypeLabels[set.set_type] || '';
                          const reps = set.actual_reps ?? set.planned_reps;
                          const weight = set.actual_weight ?? set.planned_weight;
                          const done = !!set.completed_at;

                          return (
                            <tr key={set.id} className="border-t border-line/50">
                              <td className="py-2 pr-3 text-text-secondary">
                                {i + 1}
                                {typeLabel && (
                                  <span className="ml-1.5 text-[10px] text-accent font-semibold">{typeLabel}</span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-center text-text-primary font-medium">
                                {reps ?? '--'}
                              </td>
                              <td className="py-2 px-3 text-center text-text-primary font-medium">
                                {weight ? `${weight} lbs` : '--'}
                              </td>
                              <td className="py-2 px-3 text-center text-text-muted">
                                {set.perceived_rpe ?? '--'}
                              </td>
                              <td className="py-2 pl-3 text-center">
                                <span className={`inline-block h-2 w-2 rounded-full ${done ? 'bg-success' : 'bg-line'}`} />
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}

              {ex.notes && (
                <p className="text-xs text-text-muted mt-2 italic">{ex.notes}</p>
              )}
            </div>
          ))}
      </div>

      {/* Rep FQI Breakdown */}
      {reps.length > 0 && (
        <div className="bg-card border border-line rounded-2xl p-5 mt-4">
          <h3 className="font-bold text-text-primary mb-3">Rep Quality (FQI)</h3>
          <div className="flex flex-wrap gap-2">
            {reps.map((rep) => (
              <div
                key={rep.rep_index}
                className="bg-panel rounded-lg px-2.5 py-1.5 text-center min-w-[48px]"
              >
                <span className="text-[10px] text-text-muted block">#{rep.rep_index + 1}</span>
                <span className={`text-sm font-bold ${rep.fqi !== null ? fqiColor(rep.fqi) : 'text-text-muted'}`}>
                  {rep.fqi ?? '--'}
                </span>
                {rep.faults_detected && rep.faults_detected.length > 0 && (
                  <span className="text-[9px] text-red-400 block">{rep.faults_detected.length} fault{rep.faults_detected.length > 1 ? 's' : ''}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
