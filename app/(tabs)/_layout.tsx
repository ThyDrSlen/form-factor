import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  
  return (
    <View style={{
      flex: 1,
      backgroundColor: '#F8F9FF',
      paddingTop: insets.top,
    }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#007AFF',
          tabBarInactiveTintColor: '#8E8E93',
          tabBarStyle: {
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            borderTopWidth: 0,
            height: 60 + (Platform.OS === 'ios' ? insets.bottom / 2 : 0),
            paddingBottom: Platform.OS === 'ios' ? insets.bottom / 2 : 8,
            paddingTop: 8,
            boxShadow: '0 -1px 4px rgba(0,0,0,0.1)',
            elevation: 4,
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
          },
          tabBarLabelStyle: { 
            fontSize: 11, 
            fontWeight: '500',
            fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif-medium',
            marginTop: 4,
          },
          tabBarItemStyle: {
            paddingVertical: 4,
          },
          headerStyle: {
            backgroundColor: '#F8F9FF',
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
