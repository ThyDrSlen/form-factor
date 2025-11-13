import React from 'react';
import { Platform, View, ViewStyle, StyleProp } from 'react-native';

// Try to lazy-load native module on iOS only
let NativeCircularProgress: React.ComponentType<{ style?: StyleProp<ViewStyle> }> | null = null;

if (Platform.OS === 'ios') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const native = require('@expo/ui/Progress');
    NativeCircularProgress = native?.CircularProgress ?? null;
  } catch (e) {
    if (__DEV__) {
      console.warn('[shim:@expo/ui/Progress] Native module not found, falling back to placeholder');
    }
  }
}

export const CircularProgress: React.ComponentType<{ style?: StyleProp<ViewStyle> }> = (props) => {
  if (NativeCircularProgress) {
    return <NativeCircularProgress {...props} />;
  }
  // Web/Android placeholder
  return <View style={props.style} />;
};


