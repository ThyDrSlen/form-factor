import React, { createContext, useContext, useState, useEffect } from 'react';
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

  const toggleWeightUnit = async () => {
    const newUnit: WeightUnit = weightUnit === 'kg' ? 'lbs' : 'kg';
    setWeightUnit(newUnit);
    await AsyncStorage.setItem(WEIGHT_UNIT_KEY, newUnit);
  };

  const convertWeight = (kg: number): number => {
    if (weightUnit === 'lbs') {
      return kg * 2.20462;
    }
    return kg;
  };

  const getWeightLabel = (): string => {
    return weightUnit === 'kg' ? 'kg' : 'lbs';
  };

  return (
    <UnitsContext.Provider value={{ weightUnit, toggleWeightUnit, convertWeight, getWeightLabel }}>
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
