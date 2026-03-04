import * as React from 'react';
import { requireNativeViewManager } from 'expo-modules-core';
import { ViewProps } from 'react-native';

const NativeARKitBodyView: React.ComponentType<ViewProps> = requireNativeViewManager('ARKitBodyTracker');

export function ARKitBodyView(props: ViewProps) {
  return <NativeARKitBodyView {...props} />;
}

export default ARKitBodyView;
