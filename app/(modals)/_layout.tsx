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
      <Stack.Screen
        name="rep-insights"
        options={{
          presentation: 'modal',
          gestureEnabled: true,
          contentStyle: { backgroundColor: '#0B1626' },
        }}
      />
      <Stack.Screen name="help-support" options={{ presentation: 'modal', gestureEnabled: true }} />
      <Stack.Screen name="notifications" options={{ presentation: 'modal', gestureEnabled: true }} />
      <Stack.Screen name="about" options={{ presentation: 'modal', gestureEnabled: true }} />
      <Stack.Screen name="privacy" options={{ presentation: 'modal', gestureEnabled: true }} />
      <Stack.Screen name="video-comments" options={{ presentation: 'modal', gestureEnabled: true }} />
      <Stack.Screen
        name="workout-session"
        options={{
          presentation: 'fullScreenModal',
          contentStyle: { backgroundColor: '#050E1F' },
        }}
      />
      <Stack.Screen
        name="add-workout"
        options={{
          presentation: 'modal',
          contentStyle: { backgroundColor: '#F8F9FF' },
        }}
      />
      <Stack.Screen
        name="session-history"
        options={{
          presentation: 'modal',
          gestureEnabled: true,
          contentStyle: { backgroundColor: '#050E1F' },
        }}
      />
      <Stack.Screen
        name="rep-pain-journal"
        options={{
          presentation: 'modal',
          gestureEnabled: true,
          contentStyle: { backgroundColor: '#050E1F' },
        }}
      />
      <Stack.Screen
        name="session-timeline"
        options={{
          presentation: 'modal',
          gestureEnabled: true,
          contentStyle: { backgroundColor: '#050E1F' },
        }}
      />
      <Stack.Screen
        name="coach-history"
        options={{
          presentation: 'modal',
          gestureEnabled: true,
          contentStyle: { backgroundColor: '#050E1F' },
        }}
      />
      <Stack.Screen
        name="template-builder"
        options={{
          presentation: 'fullScreenModal',
          contentStyle: { backgroundColor: '#050E1F' },
        }}
      />
      <Stack.Screen
        name="templates"
        options={{
          presentation: 'modal',
          contentStyle: { backgroundColor: '#050E1F' },
        }}
      />
      <Stack.Screen
        name="practice-mode"
        options={{
          presentation: 'modal',
          gestureEnabled: true,
          contentStyle: { backgroundColor: '#050E1F' },
        }}
      />
      <Stack.Screen
        name="calibration-failure-recovery"
        options={{
          presentation: 'modal',
          gestureEnabled: true,
          contentStyle: { backgroundColor: '#050E1F' },
        }}
      />
      <Stack.Screen
        name="settings-coaching"
        options={{
          presentation: 'modal',
          gestureEnabled: true,
          contentStyle: { backgroundColor: '#050E1F' },
        }}
      />
      <Stack.Screen
        name="fault-heatmap"
        options={{
          presentation: 'fullScreenModal',
          contentStyle: { backgroundColor: '#050E1F' },
        }}
      />
      <Stack.Screen
        name="progression-plan"
        options={{
          presentation: 'modal',
          gestureEnabled: true,
          contentStyle: { backgroundColor: '#050E1F' },
        }}
      />
    </Stack>
  );
}
