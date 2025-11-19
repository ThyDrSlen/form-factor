import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  
  return (
    <View style={{
      flex: 1,
      backgroundColor: '#050E1F',
      paddingTop: insets.top,
    }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#4C8CFF',
          tabBarInactiveTintColor: '#6781A6',
          tabBarStyle: {
            backgroundColor: '#0F2339',
            borderTopColor: '#1B2E4A',
            height: 60 + (Platform.OS === 'ios' ? insets.bottom / 2 : 0),
            paddingBottom: Platform.OS === 'ios' ? insets.bottom / 2 : 8,
            paddingTop: 8,
            elevation: 0,
            position: 'absolute',
            ...(Platform.OS === 'web' ? {
              width: '90%',
              maxWidth: 500,
              left: '50%',
              transform: [{ translateX: '-50%' as any }],
              borderRadius: 24,
              bottom: 24,
              borderTopWidth: 0,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 12,
            } : {
              borderTopWidth: 1,
              bottom: 0,
              left: 0,
              right: 0,
            }),
          },
          tabBarLabelStyle: { 
            fontSize: 11, 
            fontWeight: '500',
            fontFamily: Platform.select({
              ios: 'System',
              web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
              default: 'sans-serif-medium',
            }),
            marginTop: 4,
          },
          tabBarItemStyle: {
            paddingVertical: 4,
          },
          headerStyle: {
            backgroundColor: '#050E1F',
            height: 44 + insets.top,
          },
          headerTitleStyle: {
            paddingTop: insets.top,
          },
          headerTitleContainerStyle: {
            paddingTop: insets.top,
          }
      }}
    >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, size }) => (
              <Ionicons 
                name="home-outline" 
                size={size} 
                color={color} 
              />
            ),
          }}
        />
        <Tabs.Screen
          name="workouts"
          options={{
            title: 'Workouts',
            tabBarIcon: ({ color, size }) => (
              <Ionicons
                name="barbell-outline"
                size={size}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="food"
          options={{
            title: 'Food',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="fast-food-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="scan-arkit"
          options={{
            title: 'Scan',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="scan-outline" size={size} color={color} />
            ),
            // Hide tab bar when this screen is active
            tabBarStyle: { display: 'none' },
            // Optional: remove from tab list entirely so it's only reachable via navigation
            // href: null,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="person-outline" size={size} color={color} />
            ),
          }}
        />
      </Tabs>
    </View>
  );
}
