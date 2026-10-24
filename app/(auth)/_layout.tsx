import { Slot, Redirect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '../../features/auth/contexts/AuthContext';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet, View } from 'react-native';
import { MD3DarkTheme, PaperProvider } from 'react-native-paper';
import { theme } from '@/styles/theme';
import { Skeleton } from 'moti/skeleton';

const authTheme = {
  ...MD3DarkTheme,
  colors: { ...MD3DarkTheme.colors, primary: theme.colors.accentText, background: theme.colors.background, surface: theme.colors.surface, onSurface: theme.colors.text, onSurfaceVariant: theme.colors.secondary, outline: theme.colors.border },
};

export default function AuthLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.loadingContainer]} edges={['top', 'bottom', 'left', 'right']}>
        <StatusBar style="light" backgroundColor={theme.colors.background} />
        <View style={styles.skeletonContainer}>
          <Skeleton height={80} width="80%" radius="square" />
          <View style={styles.spacer} />
          <Skeleton height={20} width="60%" />
          <View style={styles.spacerSmall} />
          <Skeleton height={20} width="60%" />
        </View>
      </SafeAreaView>
    );
  }

  if (user) {
    return <Redirect href="/" />;
  }

  return (
    <PaperProvider theme={authTheme}>
      <StatusBar style="light" backgroundColor={theme.colors.background} />
      <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
        <Slot />
      </SafeAreaView>
    </PaperProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  skeletonContainer: {
    alignItems: 'center',
    width: '100%',
  },
  spacer: {
    height: 16,
  },
  spacerSmall: {
    height: 8,
  },
});
