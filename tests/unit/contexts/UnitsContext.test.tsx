import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type * as UnitsContextModule from '@/contexts/UnitsContext';

type UnitsModule = typeof UnitsContextModule;
let UnitsProvider: UnitsModule['UnitsProvider'];
let useUnits: UnitsModule['useUnits'];

const STORAGE_KEY = '@weight_unit';

beforeAll(() => {
  const mod = require('@/contexts/UnitsContext') as UnitsModule;
  UnitsProvider = mod.UnitsProvider;
  useUnits = mod.useUnits;
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <UnitsProvider>{children}</UnitsProvider>
);

describe('UnitsContext', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  describe('initial load', () => {
    it('defaults to lbs when AsyncStorage is empty', async () => {
      const { result } = renderHook(() => useUnits(), { wrapper });

      // Wait for the initial effect to settle
      await waitFor(() => {
        expect(result.current.weightUnit).toBe('lbs');
      });
      expect(result.current.getWeightLabel()).toBe('lbs');
    });

    it('loads saved unit "kg" from AsyncStorage', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, 'kg');

      const { result } = renderHook(() => useUnits(), { wrapper });

      await waitFor(() => {
        expect(result.current.weightUnit).toBe('kg');
      });
      expect(result.current.getWeightLabel()).toBe('kg');
    });

    it('loads saved unit "lbs" from AsyncStorage', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, 'lbs');

      const { result } = renderHook(() => useUnits(), { wrapper });

      await waitFor(() => {
        expect(result.current.weightUnit).toBe('lbs');
      });
    });

    it('ignores unexpected values in AsyncStorage and keeps default', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, 'stones');

      const { result } = renderHook(() => useUnits(), { wrapper });

      // Give the load effect a tick
      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.weightUnit).toBe('lbs');
    });

    it('throws when useUnits is called outside provider', () => {
      const prevError = console.error;
      console.error = jest.fn();
      try {
        expect(() => renderHook(() => useUnits()).result.current).toThrow(
          /useUnits must be used within a UnitsProvider/,
        );
      } finally {
        console.error = prevError;
      }
    });
  });

  describe('toggleWeightUnit', () => {
    it('switches lbs → kg and persists', async () => {
      const { result } = renderHook(() => useUnits(), { wrapper });
      await waitFor(() => expect(result.current.weightUnit).toBe('lbs'));

      await act(async () => {
        await result.current.toggleWeightUnit();
      });

      expect(result.current.weightUnit).toBe('kg');
      await waitFor(async () => {
        expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe('kg');
      });
    });

    it('switches kg → lbs and persists', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, 'kg');
      const { result } = renderHook(() => useUnits(), { wrapper });
      await waitFor(() => expect(result.current.weightUnit).toBe('kg'));

      await act(async () => {
        await result.current.toggleWeightUnit();
      });

      expect(result.current.weightUnit).toBe('lbs');
      await waitFor(async () => {
        expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe('lbs');
      });
    });
  });

  describe('convertWeight', () => {
    it('returns kg unchanged when unit is kg', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, 'kg');
      const { result } = renderHook(() => useUnits(), { wrapper });
      await waitFor(() => expect(result.current.weightUnit).toBe('kg'));

      expect(result.current.convertWeight(100)).toBe(100);
      expect(result.current.convertWeight(0)).toBe(0);
      expect(result.current.convertWeight(72.5)).toBe(72.5);
    });

    it('converts kg → lbs using 2.20462 ratio', async () => {
      // default is lbs
      const { result } = renderHook(() => useUnits(), { wrapper });
      await waitFor(() => expect(result.current.weightUnit).toBe('lbs'));

      expect(result.current.convertWeight(0)).toBe(0);
      expect(result.current.convertWeight(1)).toBeCloseTo(2.20462, 5);
      expect(result.current.convertWeight(100)).toBeCloseTo(220.462, 3);
      expect(result.current.convertWeight(45.36)).toBeCloseTo(100.001563, 3);
    });

    it('handles negative inputs (treats as valid signed kg)', async () => {
      const { result } = renderHook(() => useUnits(), { wrapper });
      await waitFor(() => expect(result.current.weightUnit).toBe('lbs'));

      expect(result.current.convertWeight(-10)).toBeCloseTo(-22.0462, 3);
    });

    it('propagates NaN when input is NaN', async () => {
      const { result } = renderHook(() => useUnits(), { wrapper });
      await waitFor(() => expect(result.current.weightUnit).toBe('lbs'));

      expect(result.current.convertWeight(NaN)).toBeNaN();
    });

    it('propagates Infinity when input is Infinity', async () => {
      const { result } = renderHook(() => useUnits(), { wrapper });
      await waitFor(() => expect(result.current.weightUnit).toBe('lbs'));

      expect(result.current.convertWeight(Infinity)).toBe(Infinity);
      expect(result.current.convertWeight(-Infinity)).toBe(-Infinity);
    });
  });

  describe('getWeightLabel', () => {
    it('returns "kg" when unit is kg', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, 'kg');
      const { result } = renderHook(() => useUnits(), { wrapper });
      await waitFor(() => expect(result.current.getWeightLabel()).toBe('kg'));
    });

    it('returns "lbs" when unit is lbs', async () => {
      const { result } = renderHook(() => useUnits(), { wrapper });
      await waitFor(() => expect(result.current.getWeightLabel()).toBe('lbs'));
    });
  });
});
