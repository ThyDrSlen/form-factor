import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@/features/auth/contexts/AuthContext';
import { theme } from '@/styles/theme';

/** Shared account entry keeps Profile out of the primary tab bar. */
export function TabHeader({ showBack = false }: { showBack?: boolean }) {
  const router = useRouter();
  const navigation = useNavigation();
  const { user } = useAuth();
  const name = user?.user_metadata?.full_name;
  const initial = typeof name === 'string' ? name.trim().charAt(0).toUpperCase() : '';

  return (
    <View style={styles.header}>
      {showBack ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back from profile"
          onPress={() => navigation.canGoBack() ? navigation.goBack() : router.replace('/(tabs)')}
          style={styles.back}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={20} color={theme.colors.text} />
          <Text style={styles.backText}>Profile</Text>
        </TouchableOpacity>
      ) : (
        <>
          <Text style={styles.brand}>FORM FACTOR</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open profile and settings"
            onPress={() => router.push('/(tabs)/profile')}
            style={styles.accountButton}
            activeOpacity={0.7}
          >
            <View style={styles.avatar}>
              {initial ? <Text style={styles.initial}>{initial}</Text> : (
                <Ionicons name="person-outline" size={18} color={theme.colors.text} />
              )}
            </View>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 52,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.background,
  },
  brand: { color: theme.colors.secondary, fontFamily: theme.font.medium, fontSize: 11, letterSpacing: 2 },
  accountButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { color: theme.colors.text, fontFamily: theme.font.medium, fontSize: 14 },
  back: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  backText: { color: theme.colors.text, fontFamily: theme.font.medium, fontSize: 15 },
});
