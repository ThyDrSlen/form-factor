import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { deleteFood } from '@/lib/actions';

interface FoodEntry {
  id: string;
  name: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  meal_type: string | null;
  date: string;
}

function MacroPill({ label, value, unit, color }: { label: string; value: number | null; unit: string; color: string }) {
  return (
    <div className="bg-panel rounded-xl px-3 py-2 text-center">
      <span className="text-xs text-text-muted block">{label}</span>
      <span className={`text-sm font-bold ${color}`}>
        {value !== null ? `${Math.round(value)}${unit}` : '--'}
      </span>
    </div>
  );
}

export default async function FoodPage() {
  const supabase = await createClient();

  const today = new Date().toISOString().slice(0, 10);

  const { data: entries } = await supabase
    .from('foods')
    .select('id, name, calories, protein, carbs, fat, meal_type, date')
    .gte('date', `${today}T00:00:00`)
    .lte('date', `${today}T23:59:59`)
    .order('date', { ascending: false });

  const foods = (entries ?? []) as FoodEntry[];

  const totals = foods.reduce(
    (acc, f) => ({
      calories: acc.calories + (f.calories ?? 0),
      protein: acc.protein + (f.protein ?? 0),
      carbs: acc.carbs + (f.carbs ?? 0),
      fat: acc.fat + (f.fat ?? 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const mealGroups = new Map<string, FoodEntry[]>();
  for (const food of foods) {
    const meal = food.meal_type ?? 'other';
    const group = mealGroups.get(meal) ?? [];
    group.push(food);
    mealGroups.set(meal, group);
  }

  const mealOrder = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Food Log</h1>
          <p className="text-text-secondary text-sm mt-1">Today&apos;s nutrition</p>
        </div>
        <Link
          href="/food/add"
          className="bg-accent text-white font-bold text-sm px-4 py-2.5 rounded-xl hover:bg-accent/90 transition-colors"
        >
          + Log Food
        </Link>
      </div>

      {/* Daily Summary */}
      <div className="bg-card border border-line rounded-2xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-text-secondary mb-3">Daily Totals</h2>
        <div className="grid grid-cols-4 gap-3">
          <MacroPill label="Calories" value={totals.calories} unit="" color="text-text-primary" />
          <MacroPill label="Protein" value={totals.protein} unit="g" color="text-success" />
          <MacroPill label="Carbs" value={totals.carbs} unit="g" color="text-accent" />
          <MacroPill label="Fat" value={totals.fat} unit="g" color="text-weight" />
        </div>
      </div>

      {/* Entries by Meal */}
      {foods.length === 0 ? (
        <div className="bg-card border border-line rounded-2xl p-12 text-center">
          <p className="text-text-secondary">No food logged today. Add entries in the app!</p>
        </div>
      ) : (
        <div className="space-y-4">
          {mealOrder.map((meal) => {
            const group = mealGroups.get(meal);
            if (!group || group.length === 0) return null;

            return (
              <div key={meal}>
                <h2 className="text-sm font-semibold text-text-secondary capitalize mb-2">{meal}</h2>
                <div className="space-y-2">
                  {group.map((food) => (
                    <div
                      key={food.id}
                      className="bg-card border border-line rounded-xl px-4 py-3 flex items-center justify-between"
                    >
                      <div>
                        <p className="font-medium text-text-primary">{food.name}</p>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="text-text-primary font-semibold">
                          {food.calories ?? '--'} cal
                        </span>
                        <span className="text-success">{food.protein ?? '--'}p</span>
                        <span className="text-accent">{food.carbs ?? '--'}c</span>
                        <span className="text-weight">{food.fat ?? '--'}f</span>
                        <form action={async () => { 'use server'; await deleteFood(food.id); }}>
                          <button type="submit" className="text-text-muted hover:text-red-400 text-xs ml-2 transition-colors">
                            Delete
                          </button>
                        </form>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
