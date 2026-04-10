import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

type WeightUnit = 'kg' | 'lbs';

interface UnitsContextType {
  weightUnit: WeightUnit;
  toggleWeightUnit: () => void;
  convertWeight: (kg: number) => number;
  getWeightLabel: () => string;
}

const UnitsContext = createContext<UnitsContextType | undefined>(undefined);

const WEIGHT_UNIT_KEY = '@weight_unit';

export function UnitsProvider({ children }: { children: React.ReactNode }) {
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('lbs');

  // Load saved preference
  useEffect(() => {
    AsyncStorage.getItem(WEIGHT_UNIT_KEY).then((saved) => {
      if (saved === 'kg' || saved === 'lbs') {
        setWeightUnit(saved);
      }
    });
  }, []);

  const toggleWeightUnit = useCallback(async () => {
    const newUnit: WeightUnit = weightUnit === 'kg' ? 'lbs' : 'kg';
    setWeightUnit(newUnit);
    await AsyncStorage.setItem(WEIGHT_UNIT_KEY, newUnit);
  }, [weightUnit]);

  const convertWeight = useCallback(
    (kg: number): number => {
      if (weightUnit === 'lbs') {
        return kg * 2.20462;
      }
      return kg;
    },
    [weightUnit],
  );

  const getWeightLabel = useCallback(
    (): string => (weightUnit === 'kg' ? 'kg' : 'lbs'),
    [weightUnit],
  );

  const value = useMemo(
    () => ({ weightUnit, toggleWeightUnit, convertWeight, getWeightLabel }),
    [weightUnit, toggleWeightUnit, convertWeight, getWeightLabel],
  );

  return (
    <UnitsContext.Provider value={value}>
      {children}
    </UnitsContext.Provider>
  );
}

export function useUnits() {
  const context = useContext(UnitsContext);
  if (!context) {
    throw new Error('useUnits must be used within a UnitsProvider');
  }
  return context;
}
