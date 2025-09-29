import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface Workout {
  id: string;
  exercise: string;
  sets: number;
  reps?: number;
  weight?: number;
  duration?: number;
  date: string;
}

interface WorkoutsContextValue {
  workouts: Workout[];
  addWorkout: (workout: Workout) => Promise<void>;
  refreshWorkouts: () => Promise<void>;
  deleteWorkout: (id: string) => Promise<void>;
  loading: boolean;
  isWorkoutInProgress: boolean;
  startWorkout: () => void;
  endWorkout: () => void;
}

const WorkoutsContext = createContext<WorkoutsContextValue>({
  workouts: [],
  addWorkout: async () => {},
  refreshWorkouts: async () => {},
  deleteWorkout: async () => {},
  loading: false,
  isWorkoutInProgress: false,
  startWorkout: () => {},
  endWorkout: () => {},
});

export const WorkoutsProvider = ({ children }: { children: ReactNode }) => {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [isWorkoutInProgress, setIsWorkoutInProgress] = useState(false);

  // Fetch workouts from Supabase on component mount
  useEffect(() => {
    fetchWorkouts();
  }, []);

  const fetchWorkouts = async () => {
    try {
      setLoading(true);
      console.log('[WorkoutsProvider] Fetching workouts from Supabase...');
      
      const { data, error } = await supabase
        .from('workouts')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[WorkoutsProvider] Error fetching workouts:', error);
        // If table doesn't exist, create some sample data locally
        if (error.message.includes('relation "workouts" does not exist')) {
          console.log('[WorkoutsProvider] Workouts table does not exist, using local data');
          const sampleWorkouts: Workout[] = [
            {
              id: '1',
              exercise: 'Push-ups',
              sets: 3,
              reps: 15,
              date: new Date(Date.now() - 86400000).toISOString(),
            },
            {
              id: '2',
              exercise: 'Squats',
              sets: 4,
              reps: 20,
              weight: 135,
              date: new Date(Date.now() - 172800000).toISOString(),
            }
          ];
          setWorkouts(sampleWorkouts);
        }
        return;
      }

      // Transform Supabase data to match our Workout interface
      const transformedWorkouts: Workout[] = data.map(item => ({
        id: item.id,
        exercise: item.exercise,
        sets: item.sets,
        reps: item.reps,
        weight: item.weight,
        duration: item.duration,
        date: item.created_at,
      }));

      console.log('[WorkoutsProvider] Fetched workouts:', transformedWorkouts);
      setWorkouts(transformedWorkouts);
    } catch (error) {
      console.error('[WorkoutsProvider] Error fetching workouts:', error);
      // Fallback to sample data
      const sampleWorkouts: Workout[] = [
        {
          id: '1',
          exercise: 'Push-ups',
          sets: 3,
          reps: 15,
          date: new Date(Date.now() - 86400000).toISOString(),
        }
      ];
      setWorkouts(sampleWorkouts);
    } finally {
      setLoading(false);
    }
  };

  const startWorkout = () => setIsWorkoutInProgress(true);
  const endWorkout = () => setIsWorkoutInProgress(false);

  const deleteWorkout = async (id: string) => {
    try {
      console.log('[WorkoutsProvider] Deleting workout:', id);
      // Try Supabase first
      const { error } = await supabase
        .from('workouts')
        .delete()
        .eq('id', id);

      if (error) {
        console.warn('[WorkoutsProvider] Error deleting from Supabase, applying local fallback:', error);
      }

      setWorkouts(prev => prev.filter(w => w.id !== id));
    } catch (err) {
      console.error('[WorkoutsProvider] Unexpected error during delete:', err);
      setWorkouts(prev => prev.filter(w => w.id !== id));
    }
  };

  const addWorkout = async (workout: Workout) => {
    try {
      console.log('[WorkoutsProvider] Adding workout to Supabase:', workout);
      
      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      console.log('[WorkoutsProvider] Current user:', { user: user?.id, email: user?.email, error: userError });
      
      if (!user) {
        throw new Error('User not authenticated');
      }

      // Try to save to Supabase first (let Supabase generate the ID)
      const workoutData = {
        exercise: workout.exercise,
        sets: workout.sets,
        reps: workout.reps || null,
        weight: workout.weight || null,
        duration: workout.duration || null,
      };
      
      console.log('[WorkoutsProvider] Inserting workout data:', workoutData);
      
      const { data, error } = await supabase
        .from('workouts')
        .insert([workoutData])
        .select()
        .single();

      if (error) {
        console.error('[WorkoutsProvider] Supabase error:', error);
        
        // If table doesn't exist or schema issues, just add to local state
        if (error.message.includes('relation "workouts" does not exist') || 
            error.message.includes('user_id') ||
            error.message.includes('null value in column') ||
            error.code === 'PGRST204' ||
            error.code === '23502') {
          console.log('[WorkoutsProvider] Schema issue or constraint violation, adding to local state only');
          setWorkouts(prev => {
            const newWorkouts = [workout, ...prev];
            console.log('[WorkoutsProvider] Updated local workouts:', newWorkouts);
            return newWorkouts;
          });
          return;
        }
        
        throw error;
      }

      // Transform and add to local state
      const newWorkout: Workout = {
        id: data.id,
        exercise: data.exercise,
        sets: data.sets,
        reps: data.reps,
        weight: data.weight,
        duration: data.duration,
        date: data.created_at,
      };

      console.log('[WorkoutsProvider] Workout saved to Supabase:', newWorkout);
      setWorkouts(prev => [newWorkout, ...prev]);
    } catch (error) {
      console.error('[WorkoutsProvider] Error adding workout:', error);
      
      // Fallback: add to local state if Supabase fails
      console.log('[WorkoutsProvider] Falling back to local state');
      setWorkouts(prev => {
        const newWorkouts = [workout, ...prev];
        console.log('[WorkoutsProvider] Updated local workouts (fallback):', newWorkouts);
        return newWorkouts;
      });
    }
  };

  return (
    <WorkoutsContext.Provider value={{ workouts, addWorkout, refreshWorkouts: fetchWorkouts, deleteWorkout, loading, isWorkoutInProgress, startWorkout, endWorkout }}>
      {children}
    </WorkoutsContext.Provider>
  );
};

export const useWorkouts = () => useContext(WorkoutsContext);
