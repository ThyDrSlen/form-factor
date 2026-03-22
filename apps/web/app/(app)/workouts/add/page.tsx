'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { addWorkout } from '@/lib/actions';
import { createClient } from '@/lib/supabase/client';

interface ExerciseOption {
  id: string;
  name: string;
  category: string | null;
  is_compound: boolean;
}

const categoryLabels: Record<string, string> = {
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  core: 'Core',
  cardio: 'Cardio',
  full_body: 'Full Body',
};

export default function AddWorkoutPage() {
  const [exercises, setExercises] = useState<ExerciseOption[]>([]);
  const [search, setSearch] = useState('');
  const [selectedExercise, setSelectedExercise] = useState('');
  const [selectedExerciseId, setSelectedExerciseId] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from('exercises')
      .select('id, name, category, is_compound')
      .order('name')
      .then(({ data }) => {
        if (data) setExercises(data as ExerciseOption[]);
      });
  }, []);

  const filtered = exercises.filter(
    (ex) =>
      ex.name.toLowerCase().includes(search.toLowerCase()) ||
      (ex.category && categoryLabels[ex.category]?.toLowerCase().includes(search.toLowerCase()))
  );

  const grouped = filtered.reduce<Record<string, ExerciseOption[]>>((acc, ex) => {
    const cat = ex.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(ex);
    return acc;
  }, {});

  const handleSubmit = async (formData: FormData) => {
    if (!selectedExerciseId) {
      setError('Please select an exercise');
      return;
    }
    formData.set('exercise_id', selectedExerciseId);
    formData.set('exercise_name', selectedExercise);
    setError(null);
    setLoading(true);
    try {
      await addWorkout(formData);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add workout');
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Log Workout</h1>
        <Link href="/workouts" className="text-sm text-text-secondary hover:text-text-primary transition-colors">
          Cancel
        </Link>
      </div>

      <form action={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Exercise Selector */}
        <div>
          <label htmlFor="exercise-search" className="block text-sm font-medium text-text-secondary mb-1.5">
            Exercise *
          </label>
           <input
             id="exercise-search"
             type="text"
             value={search}
             onChange={(e) => {
               setSearch(e.target.value);
               setDropdownOpen(true);
             }}
             onFocus={() => setDropdownOpen(true)}
             className="w-full bg-card border border-line rounded-xl px-4 py-3 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors mb-2"
             placeholder="Search exercises..."
           />
          {selectedExercise && (
            <div className="flex items-center gap-2 mb-2">
              <span className="bg-accent/15 text-accent text-sm font-semibold px-3 py-1.5 rounded-lg">
                {selectedExercise}
              </span>
              <button
                type="button"
               onClick={() => {
                   setSelectedExercise('');
                   setSelectedExerciseId('');
                   setDropdownOpen(true);
                 }}
                className="text-text-muted hover:text-red-400 text-sm"
              >
                Clear
              </button>
            </div>
          )}
          {dropdownOpen && (
             <div data-testid="exercise-dropdown" className="bg-card border border-line rounded-xl max-h-48 overflow-y-auto">
               {Object.entries(grouped).map(([category, exs]) => (
                 <div key={category}>
                   <div className="px-3 py-1.5 text-xs font-semibold text-text-muted uppercase tracking-wide bg-panel/50 sticky top-0 z-10">
                     {categoryLabels[category] || category}
                   </div>
                   {exs.map((ex) => (
                     <button
                       key={ex.id}
                       type="button"
                       onClick={() => {
                         setSelectedExercise(ex.name);
                         setSelectedExerciseId(ex.id);
                         setSearch('');
                         setDropdownOpen(false);
                       }}
                       className={`w-full text-left px-3 py-2 text-sm hover:bg-panel transition-colors ${
                         selectedExercise === ex.name ? 'text-accent font-semibold' : 'text-text-primary'
                       }`}
                     >
                       {ex.name}
                       {ex.is_compound && (
                         <span className="ml-1.5 text-[10px] text-text-muted">(compound)</span>
                       )}
                     </button>
                   ))}
                 </div>
               ))}
               {filtered.length === 0 && (
                 <div className="px-3 py-4 text-sm text-text-muted text-center">
                   {exercises.length === 0 ? 'Loading exercises...' : 'No matches'}
                 </div>
               )}
             </div>
           )}
          <input type="hidden" name="exercise_id" value={selectedExerciseId} />
          <input type="hidden" name="exercise_name" value={selectedExercise} />
        </div>

        {/* Sets / Reps / Weight */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label htmlFor="sets" className="block text-sm font-medium text-text-secondary mb-1.5">
              Sets
            </label>
            <input
              id="sets"
              name="sets"
              type="number"
              min="1"
              max="20"
              defaultValue="3"
              className="w-full bg-card border border-line rounded-xl px-4 py-3 text-text-primary text-center focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors"
            />
          </div>
          <div>
            <label htmlFor="reps" className="block text-sm font-medium text-text-secondary mb-1.5">
              Reps
            </label>
            <input
              id="reps"
              name="reps"
              type="number"
              min="0"
              max="100"
              defaultValue="10"
              className="w-full bg-card border border-line rounded-xl px-4 py-3 text-text-primary text-center focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors"
            />
          </div>
          <div>
            <label htmlFor="weight" className="block text-sm font-medium text-text-secondary mb-1.5">
              Weight (lbs)
            </label>
            <input
              id="weight"
              name="weight"
              type="number"
              min="0"
              max="1000"
              step="5"
              defaultValue="0"
              className="w-full bg-card border border-line rounded-xl px-4 py-3 text-text-primary text-center focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !selectedExerciseId}
          className="w-full bg-accent text-white font-bold py-3 rounded-xl hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-2"
        >
          {loading ? 'Saving...' : 'Log Workout'}
        </button>
      </form>
    </div>
  );
}
