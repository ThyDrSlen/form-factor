import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ARKIT_ONBOARDING_KEY = 'ff.arkitOnboardingCompleted';

interface ARKitOnboardingContextValue {
  hasCompletedARKitOnboarding: boolean;
  isLoading: boolean;
  completeARKitOnboarding: () => Promise<void>;
  resetARKitOnboarding: () => Promise<void>;
}

const ARKitOnboardingContext = createContext<ARKitOnboardingContextValue | null>(null);

export function ARKitOnboardingProvider({ children }: { children: React.ReactNode }) {
  const [hasCompletedARKitOnboarding, setHasCompleted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if ARKit onboarding has been completed
    const checkOnboardingStatus = async () => {
      try {
        const status = await AsyncStorage.getItem(ARKIT_ONBOARDING_KEY);
        setHasCompleted(status === 'true');
      } catch (error) {
        console.error('Error checking ARKit onboarding status:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkOnboardingStatus();
  }, []);

  const completeARKitOnboarding = async () => {
    try {
      await AsyncStorage.setItem(ARKIT_ONBOARDING_KEY, 'true');
      setHasCompleted(true);
    } catch (error) {
      console.error('Error completing ARKit onboarding:', error);
    }
  };

  const resetARKitOnboarding = async () => {
    try {
      await AsyncStorage.removeItem(ARKIT_ONBOARDING_KEY);
      setHasCompleted(false);
    } catch (error) {
      console.error('Error resetting ARKit onboarding:', error);
    }
  };

  return (
    <ARKitOnboardingContext.Provider 
      value={{ 
        hasCompletedARKitOnboarding, 
        isLoading,
        completeARKitOnboarding, 
        resetARKitOnboarding 
      }}
    >
      {children}
    </ARKitOnboardingContext.Provider>
  );
}

export function useARKitOnboarding() {
  const context = useContext(ARKitOnboardingContext);
  if (!context) {
    throw new Error('useARKitOnboarding must be used within an ARKitOnboardingProvider');
  }
  return context;
}
