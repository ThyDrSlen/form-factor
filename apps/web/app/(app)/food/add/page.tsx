'use client';

import { useState } from 'react';
import Link from 'next/link';
import { addFood } from '@/lib/actions';

const mealTypes = ['breakfast', 'lunch', 'dinner', 'snack'];

export default function AddFoodPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (formData: FormData) => {
    setError(null);
    setLoading(true);
    try {
      await addFood(formData);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add food');
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Log Food</h1>
        <Link href="/food" className="text-sm text-text-secondary hover:text-text-primary transition-colors">
          Cancel
        </Link>
      </div>

      <form action={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="name" className="block text-sm font-medium text-text-secondary mb-1.5">
            Food name *
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            className="w-full bg-card border border-line rounded-xl px-4 py-3 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors"
            placeholder="e.g. Chicken breast, rice bowl"
          />
        </div>

        <div>
          <label htmlFor="meal_type" className="block text-sm font-medium text-text-secondary mb-1.5">
            Meal
          </label>
          <select
            id="meal_type"
            name="meal_type"
            className="w-full bg-card border border-line rounded-xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors"
          >
            {mealTypes.map((type) => (
              <option key={type} value={type} className="bg-card capitalize">
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="calories" className="block text-sm font-medium text-text-secondary mb-1.5">
              Calories
            </label>
            <input
              id="calories"
              name="calories"
              type="number"
              step="1"
              min="0"
              className="w-full bg-card border border-line rounded-xl px-4 py-3 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors"
              placeholder="0"
            />
          </div>
          <div>
            <label htmlFor="protein" className="block text-sm font-medium text-text-secondary mb-1.5">
              Protein (g)
            </label>
            <input
              id="protein"
              name="protein"
              type="number"
              step="0.1"
              min="0"
              className="w-full bg-card border border-line rounded-xl px-4 py-3 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors"
              placeholder="0"
            />
          </div>
          <div>
            <label htmlFor="carbs" className="block text-sm font-medium text-text-secondary mb-1.5">
              Carbs (g)
            </label>
            <input
              id="carbs"
              name="carbs"
              type="number"
              step="0.1"
              min="0"
              className="w-full bg-card border border-line rounded-xl px-4 py-3 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors"
              placeholder="0"
            />
          </div>
          <div>
            <label htmlFor="fat" className="block text-sm font-medium text-text-secondary mb-1.5">
              Fat (g)
            </label>
            <input
              id="fat"
              name="fat"
              type="number"
              step="0.1"
              min="0"
              className="w-full bg-card border border-line rounded-xl px-4 py-3 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors"
              placeholder="0"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-accent text-white font-bold py-3 rounded-xl hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-2"
        >
          {loading ? 'Saving...' : 'Log Food'}
        </button>
      </form>
    </div>
  );
}
