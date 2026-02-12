import { Stack } from 'expo-router';

export default function ModalsLayout() {
  return (
    <Stack
      screenOptions={{
        presentation: 'modal',
        headerShown: false,
        contentStyle: { backgroundColor: '#F8F9FF' },
      }}
    >
      <Stack.Screen name="share-video" options={{ presentation: 'transparentModal', contentStyle: { backgroundColor: 'transparent' } }} />
      <Stack.Screen name="shared-inbox" options={{ presentation: 'modal' }} />
      <Stack.Screen name="share-thread" options={{ presentation: 'modal' }} />
      <Stack.Screen name="followers" options={{ presentation: 'modal' }} />
      <Stack.Screen name="follow-requests" options={{ presentation: 'modal' }} />
      <Stack.Screen name="user-profile" options={{ presentation: 'modal' }} />
      <Stack.Screen name="workout-insights" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
