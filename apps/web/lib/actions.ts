'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// =============================================================================
// Food Actions
// =============================================================================

export async function addFood(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const name = (formData.get('name') as string)?.trim();
  if (!name) throw new Error('Name is required');

  const calories = parseFloat(formData.get('calories') as string) || null;
  const protein = parseFloat(formData.get('protein') as string) || null;
  const carbs = parseFloat(formData.get('carbs') as string) || null;
  const fat = parseFloat(formData.get('fat') as string) || null;
  const mealType = (formData.get('meal_type') as string) || null;

  const { error } = await supabase.from('foods').insert({
    user_id: user.id,
    name,
    calories,
    protein,
    carbs,
    fat,
    meal_type: mealType,
    date: new Date().toISOString(),
  });

  if (error) throw new Error(error.message);

  revalidatePath('/food');
  redirect('/food');
}

export async function deleteFood(foodId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { error } = await supabase
    .from('foods')
    .delete()
    .eq('id', foodId)
    .eq('user_id', user.id);

  if (error) throw new Error(error.message);

  revalidatePath('/food');
}

// =============================================================================
// Workout Actions
// =============================================================================

export async function addWorkout(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const exerciseId = (formData.get('exercise_id') as string)?.trim();
  if (!exerciseId) throw new Error('Exercise is required');

  const exerciseName = (formData.get('exercise_name') as string)?.trim();
  if (!exerciseName) throw new Error('Exercise name is required');

  const sets = parseInt(formData.get('sets') as string) || 1;
  const reps = parseInt(formData.get('reps') as string) || 0;
  const weight = parseFloat(formData.get('weight') as string) || 0;
  const timestamp = new Date().toISOString();

  const { data: session, error: sessionError } = await supabase
    .from('workout_sessions')
    .insert({
      user_id: user.id,
      name: exerciseName,
      goal_profile: 'mixed',
      started_at: timestamp,
      ended_at: timestamp,
    })
    .select('id')
    .single();

  if (sessionError) throw new Error(sessionError.message);

  const { data: sessionExercise, error: sessionExerciseError } = await supabase
    .from('workout_session_exercises')
    .insert({
      session_id: session.id,
      exercise_id: exerciseId,
      sort_order: 0,
    })
    .select('id')
    .single();

  if (sessionExerciseError) throw new Error(sessionExerciseError.message);

  const workoutSets = Array.from({ length: sets }, (_, index) => ({
    session_exercise_id: sessionExercise.id,
    sort_order: index,
    set_type: 'normal',
    actual_reps: reps,
    actual_weight: weight,
    completed_at: timestamp,
  }));

  const { error } = await supabase.from('workout_session_sets').insert(workoutSets);

  if (error) throw new Error(error.message);

  revalidatePath('/workouts');
  redirect('/workouts');
}

// =============================================================================
// Profile Actions
// =============================================================================

export async function updateProfile(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const username = (formData.get('username') as string)?.trim().toLowerCase() || undefined;
  const displayName = (formData.get('display_name') as string)?.trim() || null;
  const bio = (formData.get('bio') as string)?.trim() || null;

  const update: Record<string, unknown> = {};
  if (username) update.username = username;
  if (formData.has('display_name')) update.display_name = displayName;
  if (formData.has('bio')) update.bio = bio;

  if (Object.keys(update).length === 0) {
    redirect('/profile');
  }

  const { error } = await supabase
    .from('profiles')
    .update(update)
    .eq('user_id', user.id);

  if (error) throw new Error(error.message);

  revalidatePath('/profile');
  redirect('/profile');
}

// =============================================================================
// Auth Actions
// =============================================================================

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/sign-in');
}
