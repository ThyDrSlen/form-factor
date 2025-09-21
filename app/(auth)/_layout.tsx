import { Slot, Redirect } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet, View } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { Skeleton } from 'moti/skeleton';

export default function AuthLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.loadingContainer]}>
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
    <PaperProvider>
      <SafeAreaView style={styles.container}>
        <Slot />
      </SafeAreaView>
    </PaperProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
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
