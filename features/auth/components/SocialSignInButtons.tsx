import { Ionicons } from '@expo/vector-icons';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { isIOS } from '@/lib/platform-utils';
import { authFonts } from '@/features/auth/styles/auth-fonts';

type Props = {
  disabled: boolean;
  onPress: (provider: 'google' | 'apple') => void;
};

export function SocialSignInButtons({ disabled, onPress }: Props) {
  return (
    <View style={styles.stack}>
      {/* These StyleSheet-only controls need RN's style callback unchanged.
          NativeWind's native wrapper otherwise drops the callback's styles. */}
      <Pressable
        cssInterop={false}
        accessibilityRole="button"
        accessibilityLabel="Sign in with Google"
        accessibilityState={{ disabled, busy: disabled }}
        disabled={disabled}
        onPress={() => onPress('google')}
        style={({ pressed }) => [styles.button, styles.google, (pressed || disabled) && styles.dimmed]}
      >
        <Image source={require('../../../assets/images/google-g.png')} style={styles.googleIcon} resizeMode="contain" accessible={false} />
        <Text style={styles.googleText}>Continue with Google</Text>
      </Pressable>
      {isIOS() && (
        <Pressable
          cssInterop={false}
          accessibilityRole="button"
          accessibilityLabel="Sign in with Apple"
          accessibilityState={{ disabled, busy: disabled }}
          disabled={disabled}
          onPress={() => onPress('apple')}
          style={({ pressed }) => [styles.button, styles.apple, (pressed || disabled) && styles.dimmed]}
        >
          <Ionicons name="logo-apple" size={22} color="#FFFFFF" accessible={false} />
          <Text style={styles.appleText}>Continue with Apple</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  button: { minHeight: 54, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, borderWidth: 1 },
  google: { backgroundColor: '#FFFFFF', borderColor: '#747775' },
  apple: { backgroundColor: '#000000', borderColor: '#747775' },
  googleIcon: { width: 20, height: 20 },
  googleText: { color: '#1F1F1F', fontSize: 16, fontFamily: authFonts.medium },
  appleText: { color: '#FFFFFF', fontSize: 16, fontFamily: authFonts.medium },
  dimmed: { opacity: 0.6 },
});
