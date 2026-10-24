import { theme } from '@/styles/theme';
import { TabHeader } from '@/components/navigation/TabHeader';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const styles = createStyles(insets, width, fontScale);
  
  return (
    <View style={styles.container}>
      <Tabs
        backBehavior="history"
        screenOptions={{
          headerShown: true,
          header: () => <TabHeader />,
          tabBarActiveTintColor: theme.colors.accentText,
          tabBarLabelPosition: 'below-icon',
          tabBarHideOnKeyboard: true,
          tabBarInactiveTintColor: theme.colors.muted,
          tabBarStyle: styles.tabBar,
          tabBarLabelStyle: styles.tabBarLabel,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarAccessibilityLabel: 'Home',
            tabBarIcon: ({ color }) => (
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
            tabBarAccessibilityLabel: 'Workouts',
            tabBarIcon: ({ color }) => (
              <Ionicons
                name="barbell-outline"
                size={20}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="form"
          options={{
            title: 'Form',
            tabBarAccessibilityLabel: 'Form',
            tabBarIcon: ({ color }) => (
              <Ionicons name="scan-outline" size={20} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="trends"
          options={{
            title: 'Trends',
            tabBarAccessibilityLabel: 'Trends',
            tabBarIcon: ({ color }) => (
              <Ionicons name="stats-chart-outline" size={20} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="food"
          options={{
            title: 'Food',
            tabBarAccessibilityLabel: 'Food',
            tabBarIcon: ({ color }) => (
              <Ionicons name="nutrition-outline" size={20} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="coach"
          options={{
            title: 'Coach',
            tabBarAccessibilityLabel: 'Coach',
            tabBarIcon: ({ color }) => (
              <Ionicons name="sparkles-outline" size={20} color={color} />
            ),
            href: null,
          }}
        />
        <Tabs.Screen
          name="scan-arkit"
          options={{
            title: 'Analyze',
            tabBarAccessibilityLabel: 'Analyze',
            tabBarIcon: ({ color }) => (
              <Ionicons name="scan-outline" size={20} color={color} />
            ),
            headerShown: false,
            // Analyze remains a full-screen child flow entered from Form.
            tabBarStyle: styles.hiddenTabBar,
            href: null,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            href: null,
            header: () => <TabHeader showBack />,
            tabBarAccessibilityLabel: 'Profile',
            tabBarIcon: ({ color }) => (
              <Ionicons name="person-outline" size={20} color={color} />
            ),
          }}
        />
      </Tabs>
    </View>
  );
}

const createStyles = (
  insets: ReturnType<typeof useSafeAreaInsets>,
  width: number,
  fontScale: number,
) => {
  const bottomPadding = Math.max(insets.bottom, 8);
  // Keep the touch/label area consistent independently of the home indicator.
  const contentHeight = 56 + Math.max(0, fontScale - 1) * 14;
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
      paddingTop: insets.top,
    },
    tabBar: {
      backgroundColor: theme.colors.surface,
      borderTopColor: theme.colors.border,
      borderTopWidth: 1,
      height: contentHeight + bottomPadding,
      paddingBottom: bottomPadding,
      paddingTop: 0,
      elevation: 0,
    },
    tabBarLabel: {
      fontSize: width < 360 ? 10 : 11,
      fontWeight: '500',
      fontFamily: Platform.select({
        ios: 'System',
        web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        default: 'sans-serif-medium',
      }),
      marginTop: 2,
    },
    hiddenTabBar: {
      display: 'none',
    },
  });

};
