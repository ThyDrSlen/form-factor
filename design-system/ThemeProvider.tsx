/**
 * Apple HIG Design System - Theme Provider
 * React Context for managing theme state and accessibility preferences
 */

import * as React from 'react';
import { ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { AccessibilityInfo, ColorSchemeName, useColorScheme } from 'react-native';
import { Theme, createTheme } from './theme';

interface ThemeContextType {
  theme: Theme;
  colorScheme: ColorSchemeName;
  setColorScheme: (scheme: ColorSchemeName) => void;
  isReduceMotionEnabled: boolean;
  isHighContrastEnabled: boolean;
  isDynamicTypeEnabled: boolean;
  accessibilityTextSize: 'default' | 'AX1' | 'AX2' | 'AX3';
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const systemColorScheme = useColorScheme();
  const [colorScheme, setColorScheme] = useState<ColorSchemeName>(systemColorScheme);
  const [isReduceMotionEnabled, setIsReduceMotionEnabled] = useState(false);
  const [isHighContrastEnabled, setIsHighContrastEnabled] = useState(false);
  const [isDynamicTypeEnabled, setIsDynamicTypeEnabled] = useState(false);
  const [accessibilityTextSize, setAccessibilityTextSize] = useState<'default' | 'AX1' | 'AX2' | 'AX3'>('default');

  // Listen for system color scheme changes
  useEffect(() => {
    if (colorScheme === null) {
      setColorScheme(systemColorScheme);
    }
  }, [systemColorScheme, colorScheme]);

  // Listen for accessibility preference changes
  useEffect(() => {
    const checkAccessibilitySettings = async () => {
      try {
        // Check for reduce motion
        const reduceMotion = await AccessibilityInfo.isReduceMotionEnabled();
        setIsReduceMotionEnabled(reduceMotion);

        // Check for high contrast (iOS 13+)
        if (typeof (AccessibilityInfo as any).isHighTextContrastEnabled === 'function') {
          const highContrast = await (AccessibilityInfo as any).isHighTextContrastEnabled();
          setIsHighContrastEnabled(highContrast);
        }

        // Check for dynamic type preferences
        // Note: This is a simplified check - in a real app you'd want to use
        // more sophisticated detection for accessibility text sizes
        const screenReaderEnabled = await AccessibilityInfo.isScreenReaderEnabled();
        setIsDynamicTypeEnabled(screenReaderEnabled);
      } catch (error) {
        console.warn('Error checking accessibility settings:', error);
      }
    };

    checkAccessibilitySettings();

    // Set up listeners for accessibility changes
    const reduceMotionListener = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setIsReduceMotionEnabled
    );

    let highContrastListener: any;
    if (typeof (AccessibilityInfo as any).isHighTextContrastEnabled === 'function') {
      // Note: There's no event listener for high contrast changes in React Native
      // This would need to be implemented differently or removed
    }

    const screenReaderListener = AccessibilityInfo.addEventListener(
      'screenReaderChanged',
      setIsDynamicTypeEnabled
    );

    return () => {
      reduceMotionListener?.remove();
      highContrastListener?.remove();
      screenReaderListener?.remove();
    };
  }, []);

  const theme = createTheme(colorScheme);

  const contextValue: ThemeContextType = {
    theme,
    colorScheme,
    setColorScheme,
    isReduceMotionEnabled,
    isHighContrastEnabled,
    isDynamicTypeEnabled,
    accessibilityTextSize,
  };

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

// Hook for accessing just the theme object
export const useAppTheme = (): Theme => {
  const { theme } = useTheme();
  return theme;
};