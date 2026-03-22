import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { formatRelativeDate } from '@/lib/utils';
import type { GoalProfile } from '@form-factor/shared/types/workout-session';

interface WorkoutRow {
  id: string;
  name: string | null;
  goal_profile: GoalProfile;
  started_at: string;
  ended_at: string | null;
  notes: string | null;
  template: { name: string } | null;
  exercises: {
    id: string;
    sort_order: number;
    exercise: { name: string } | null;
    sets: { id: string }[];
  }[];
}

const goalColors: Record<GoalProfile, string> = {
  hypertrophy: 'bg-purple-500/15 text-purple-400',
  strength: 'bg-red-500/15 text-red-400',
  power: 'bg-orange-500/15 text-orange-400',
  endurance: 'bg-green-500/15 text-green-400',
  mixed: 'bg-accent/15 text-accent',
};

export default async function WorkoutsPage() {
  const supabase = await createClient();

  const { data: sessions } = await supabase
    .from('workout_sessions')
    .select(`
      id, name, goal_profile, started_at, ended_at, notes,
      template:workout_templates(name),
      exercises:workout_session_exercises(
        id, sort_order,
        exercise:exercises(name),
        sets:workout_session_sets(id)
      )
    `)
    .order('started_at', { ascending: false })
    .limit(20);

  const workouts = (sessions ?? []) as unknown as WorkoutRow[];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Workouts</h1>
          <p className="text-text-secondary text-sm mt-1">Your recent training sessions</p>
        </div>
        <Link
          href="/workouts/add"
          className="bg-accent text-white font-bold text-sm px-4 py-2.5 rounded-xl hover:bg-accent/90 transition-colors"
        >
          + Log Workout
        </Link>
      </div>

      {workouts.length === 0 ? (
        <div className="bg-card border border-line rounded-2xl p-12 text-center">
          <p className="text-text-secondary">No workouts yet. Start a session in the app!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {workouts.map((workout) => {
            const exerciseCount = workout.exercises?.length ?? 0;
            const totalSets = workout.exercises?.reduce((sum, ex) => sum + (ex.sets?.length ?? 0), 0) ?? 0;
            const displayName = workout.name || workout.template?.name || 'Workout';

            return (
              <Link key={workout.id} href={`/workouts/${workout.id}`} className="block bg-card border border-line rounded-2xl p-5 hover:border-accent/30 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2.5 mb-1">
                      <h3 className="font-bold text-text-primary">{displayName}</h3>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${goalColors[workout.goal_profile]}`}>
                        {workout.goal_profile}
                      </span>
                    </div>
                    <p className="text-sm text-text-muted">{formatRelativeDate(workout.started_at)}</p>
                  </div>
                </div>

                <div className="flex gap-4 mt-3">
                  <div className="bg-panel rounded-xl px-3 py-2">
                    <span className="text-xs text-text-muted block">Exercises</span>
                    <span className="text-sm font-bold text-text-primary">{exerciseCount}</span>
                  </div>
                  <div className="bg-panel rounded-xl px-3 py-2">
                    <span className="text-xs text-text-muted block">Sets</span>
                    <span className="text-sm font-bold text-text-primary">{totalSets}</span>
                  </div>
                  {workout.ended_at && (
                    <div className="bg-panel rounded-xl px-3 py-2">
                      <span className="text-xs text-text-muted block">Duration</span>
                      <span className="text-sm font-bold text-text-primary">
                        {Math.round((new Date(workout.ended_at).getTime() - new Date(workout.started_at).getTime()) / 60000)}m
                      </span>
                    </div>
                  )}
                </div>

                {workout.exercises && workout.exercises.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {workout.exercises
                      .sort((a, b) => a.sort_order - b.sort_order)
                      .slice(0, 5)
                      .map((ex) => (
                        <span
                          key={ex.id}
                          className="text-xs bg-edge text-text-secondary px-2 py-1 rounded-lg"
                        >
                          {ex.exercise?.name ?? 'Unknown'}
                        </span>
                      ))}
                    {exerciseCount > 5 && (
                      <span className="text-xs text-text-muted px-2 py-1">+{exerciseCount - 5} more</span>
                    )}
                  </div>
                )}

                {workout.notes && (
                  <p className="text-sm text-text-muted mt-2 italic">{workout.notes}</p>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
