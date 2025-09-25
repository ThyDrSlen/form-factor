import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface FoodEntry {
  id: string;
  name: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  date: string;
}

interface FoodContextValue {
  foods: FoodEntry[];
  addFood: (food: FoodEntry) => Promise<void>;
  refreshFoods: () => Promise<void>;
  deleteFood: (id: string) => Promise<void>;
  loading: boolean;
}

const FoodContext = createContext<FoodContextValue>({
  foods: [],
  addFood: async () => { },
  refreshFoods: async () => { },
  deleteFood: async () => { },
  loading: false,
});

export const FoodProvider = ({ children }: { children: ReactNode }) => {
  const [foods, setFoods] = useState<FoodEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch foods from Supabase on component mount
  useEffect(() => {
    fetchFoods();
  }, []);

  const fetchFoods = async () => {
    try {
      setLoading(true);
      console.log('[FoodProvider] Fetching foods from Supabase...');

      const { data, error } = await supabase
        .from('foods')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[FoodProvider] Error fetching foods:', error);
        // If table doesn't exist, create some sample data locally
        if (error.message.includes('relation "foods" does not exist')) {
          console.log('[FoodProvider] Food table does not exist, using local data');
          const sampleFoods: FoodEntry[] = [
            {
              id: '1',
              name: 'Chicken Breast',
              calories: 231,
              date: new Date(Date.now() - 86400000).toISOString(),
            },
            {
              id: '2',
              name: 'Apple',
              calories: 95,
              date: new Date().toISOString(),
            }
          ];
          setFoods(sampleFoods);
        }
        return;
      }

      // Transform Supabase data to match our FoodEntry interface
      const transformedFoods: FoodEntry[] = data.map(item => ({
        id: item.id,
        name: item.name,
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat,
        date: item.created_at,
      }));

      console.log('[FoodProvider] Fetched foods:', transformedFoods);
      setFoods(transformedFoods);
    } catch (error) {
      console.error('[FoodProvider] Error fetching foods:', error);
      // Fallback to sample data
      const sampleFoods: FoodEntry[] = [
        {
          id: '1',
          name: 'Apple',
          calories: 95,
          date: new Date().toISOString(),
        }
      ];
      setFoods(sampleFoods);
    } finally {
      setLoading(false);
    }
  };

  const deleteFood = async (id: string) => {
    try {
      console.log('[FoodProvider] Deleting food:', id);
      const { error } = await supabase
        .from('foods')
        .delete()
        .eq('id', id);

      if (error) {
        console.warn('[FoodProvider] Error deleting from Supabase, applying local fallback:', error);
      }

      setFoods(prev => prev.filter(f => f.id !== id));
    } catch (err) {
      console.error('[FoodProvider] Unexpected error during delete:', err);
      setFoods(prev => prev.filter(f => f.id !== id));
    }
  };

  const addFood = async (food: FoodEntry) => {
    try {
      console.log('[FoodProvider] Adding food to Supabase:', food);

      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      console.log('[FoodProvider] Current user:', { user: user?.id, email: user?.email, error: userError });

      if (!user) {
        throw new Error('User not authenticated');
      }

      // Try to save to Supabase first (let Supabase generate the ID)
      const foodData = {
        name: food.name,
        calories: food.calories,
        protein: food.protein || null,
        carbs: food.carbs || null,
        fat: food.fat || null,
      };

      console.log('[FoodProvider] Inserting food data:', foodData);

      const { data, error } = await supabase
        .from('foods')
        .insert([foodData])
        .select()
        .single();

      if (error) {
        console.error('[FoodProvider] Supabase error:', error);

        // If table doesn't exist or schema issues, just add to local state
        if (error.message.includes('relation "foods" does not exist') ||
          error.message.includes('user_id') ||
          error.message.includes('null value in column') ||
          error.code === 'PGRST204' ||
          error.code === '23502') {
          console.log('[FoodProvider] Schema issue or constraint violation, adding to local state only');
          setFoods(prev => {
            const newFoods = [food, ...prev];
            console.log('[FoodProvider] Updated local foods:', newFoods);
            return newFoods;
          });
          return;
        }

        throw error;
      }

      // Transform and add to local state
      const newFood: FoodEntry = {
        id: data.id,
        name: data.name,
        calories: data.calories,
        protein: data.protein,
        carbs: data.carbs,
        fat: data.fat,
        date: data.created_at,
      };

      console.log('[FoodProvider] Food saved to Supabase:', newFood);
      setFoods(prev => [newFood, ...prev]);
    } catch (error) {
      console.error('[FoodProvider] Error adding food:', error);

      // Fallback: add to local state if Supabase fails
      console.log('[FoodProvider] Falling back to local state');
      setFoods(prev => {
        const newFoods = [food, ...prev];
        console.log('[FoodProvider] Updated local foods (fallback):', newFoods);
        return newFoods;
      });
    }
  };

  return (
    <FoodContext.Provider value={{ foods, addFood, refreshFoods: fetchFoods, deleteFood, loading }}>
      {children}
    </FoodContext.Provider>
  );
};

export const useFood = () => useContext(FoodContext);
