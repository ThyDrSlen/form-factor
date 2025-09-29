import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';

type ToastType = 'info' | 'success' | 'error';

interface ToastOptions {
  type?: ToastType;
  duration?: number;
}

interface ToastContextValue {
  show: (message: string, options?: ToastOptions) => void;
}

interface ToastData {
  message: string;
  type: ToastType;
  expiresAt: number;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastData | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, options?: ToastOptions) => {
    if (!message) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const nextToast: ToastData = {
      message,
      type: options?.type ?? 'info',
      expiresAt: Date.now() + (options?.duration ?? 2500),
    };

    setToast(nextToast);

    Animated.timing(opacity, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();

    timerRef.current = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setToast(null);
        }
      });
    }, nextToast.expiresAt - Date.now());
  }, [opacity]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.container,
            Platform.select({ web: styles.containerWeb, default: undefined }),
            { opacity },
          ]}
        >
          <View
            style={[
              styles.toast,
              toast.type === 'success' && styles.success,
              toast.type === 'error' && styles.error,
            ]}
          >
            <Text style={styles.text}>{toast.message}</Text>
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 32,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  containerWeb: {
    pointerEvents: 'none',
  },
  toast: {
    maxWidth: '90%',
    borderRadius: 9999,
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(17, 25, 40, 0.9)',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 6,
  },
  success: {
    backgroundColor: 'rgba(52, 199, 89, 0.9)',
  },
  error: {
    backgroundColor: 'rgba(255, 59, 48, 0.92)',
  },
  text: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
