import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const styles = createStyles(insets);
  
  return (
    <View style={styles.container}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#4C8CFF',
          tabBarInactiveTintColor: '#6781A6',
          tabBarStyle: styles.tabBar,
          tabBarLabelStyle: styles.tabBarLabel,
          tabBarItemStyle: styles.tabBarItem,
          headerStyle: styles.header,
          headerTitleStyle: styles.headerTitle,
          headerTitleContainerStyle: styles.headerTitle,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, size }) => (
              <Ionicons 
                name="home-outline" 
                size={20}
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
                size={20}
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
              <Ionicons name="nutrition-outline" size={20} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="coach"
          options={{
            title: 'Coach',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="sparkles-outline" size={20} color={color} />
            ),
            href: Platform.OS === 'web' ? undefined : null,
          }}
        />
        <Tabs.Screen
          name="scan-arkit"
          options={{
            title: 'Scan',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="scan-outline" size={20} color={color} />
            ),
            // Hide tab bar when this screen is active
            tabBarStyle: styles.hiddenTabBar,
            href: Platform.OS === 'web' ? null : undefined,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="person-outline" size={20} color={color} />
            ),
          }}
        />
      </Tabs>
    </View>
  );
}

const createStyles = (insets: ReturnType<typeof useSafeAreaInsets>) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: '#050E1F',
      paddingTop: insets.top,
    },
    tabBar: {
      backgroundColor: '#0F2339',
      borderTopColor: '#1B2E4A',
      height: 70 + (Platform.OS === 'ios' ? insets.bottom / 2 : 0),
      paddingBottom: Platform.OS === 'ios' ? insets.bottom / 2 + 4 : 12,
      paddingTop: 6,
      elevation: 0,
      position: 'absolute',
      paddingHorizontal: 16,
      ...(Platform.OS === 'web'
        ? {
            width: '90%',
            maxWidth: 600,
            left: '50%',
            transform: [{ translateX: '-50%' as any }],
            borderRadius: 24,
            bottom: 24,
            borderTopWidth: 0,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 12,
          }
        : {
            borderTopWidth: 1,
            bottom: 0,
            left: 0,
            right: 0,
          }),
    },
    tabBarLabel: {
      fontSize: 11,
      fontWeight: '500',
      fontFamily: Platform.select({
        ios: 'System',
        web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        default: 'sans-serif-medium',
      }),
      marginTop: 4,
    },
    tabBarItem: {
      paddingVertical: 6,
    },
    header: {
      backgroundColor: '#050E1F',
      height: 44 + insets.top,
    },
    headerTitle: {
      paddingTop: insets.top,
    },
    hiddenTabBar: {
      display: 'none',
    },
  });
