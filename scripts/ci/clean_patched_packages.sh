#!/usr/bin/env bash
set -euo pipefail

rm -rf node_modules/expo node_modules/expo-av node_modules/expo-modules-core \
       node_modules/react-native-gesture-handler node_modules/react-native-reanimated \
       node_modules/react-native-vision-camera node_modules/react-native-worklets-core \
       node_modules/react-native-worklets 2>/dev/null || true
