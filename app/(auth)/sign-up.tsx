import { View, StyleSheet, ScrollView, KeyboardAvoidingView, TouchableOpacity } from 'react-native';
import { Text, TextInput, Button } from 'react-native-paper';
import { BrandMark } from '@/components/BrandMark';
import { theme } from '@/styles/theme';
import { useRouter } from 'expo-router';
import { useAuth } from '../../features/auth/contexts/AuthContext';
import { useState } from 'react';
import { errorWithTs } from '@/lib/logger';
import { getPlatformValue } from '@/lib/platform-utils';

function mapSignUpErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Unable to create your account right now. Please try again.';
  }

  const message = error.message.toLowerCase();

  if (message.includes('already registered') || message.includes('already exists')) {
    return 'An account with this email already exists. Please sign in instead.';
  }

  if (message.includes('validate email') || message.includes('invalid email')) {
    return 'Please enter a valid email address.';
  }

  if (message.includes('password should be at least')) {
    return 'Password must be at least 6 characters long.';
  }

  if (message.includes('network') || message.includes('fetch')) {
    return 'Unable to connect to the server. Please try again.';
  }

  return error.message || 'Unable to create your account right now. Please try again.';
}

export default function SignUpScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { signUpWithEmail } = useAuth();
  const router = useRouter();

  const handleSignUp = async () => {
    const trimmedFullName = fullName.trim();
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();

    if (!trimmedEmail || !trimmedPassword || !trimmedFullName) {
      setErrorMessage(trimmedEmail && trimmedPassword ? 'Please enter your full name' : 'Please fill in all fields');
      return;
    }

    try {
      setLoading(true);
      setErrorMessage(null);

      const { error } = await signUpWithEmail(trimmedEmail, trimmedPassword, { fullName: trimmedFullName });
      if (error) throw error;
      // On successful sign-up, the auth state will change and the user will be redirected
    } catch (error) {
      errorWithTs('Sign up error:', error);
      setErrorMessage(mapSignUpErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView 
        behavior={getPlatformValue({ ios: 'padding', default: 'height' })}
        style={styles.keyboardAvoidingView}
      >
        <ScrollView 
          contentContainerStyle={styles.scrollViewContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.inner}>
            <View style={styles.brandRow}>
              <BrandMark size={44} />
              <Text style={styles.wordmark}>FORM FACTOR</Text>
            </View>
            <Text variant="headlineMedium" style={styles.title}>Start strong.</Text>
            <Text variant="bodyMedium" style={styles.subtitle}>Better movement starts with your next rep.</Text>
            
            <View style={styles.form}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Full Name</Text>
                <TextInput
                  testID="sign-up-full-name-input"
                  placeholder="Full Name"
                  value={fullName}
                  onChangeText={(value) => {
                    setFullName(value);
                    if (errorMessage) {
                      setErrorMessage(null);
                    }
                  }}
                  autoCapitalize="words"
                  returnKeyType="next"
                  style={styles.input}
                  mode="outlined"
                  outlineStyle={{ borderRadius: theme.radius.input }}
                  textColor={theme.colors.text}
                  placeholderTextColor={theme.colors.muted}
                />
              </View>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Email</Text>
                <TextInput
                  testID="sign-up-email-input"
                  placeholder="Email"
                  value={email}
                  onChangeText={(value) => {
                    setEmail(value);
                    if (errorMessage) {
                      setErrorMessage(null);
                    }
                  }}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  returnKeyType="next"
                  style={styles.input}
                  mode="outlined"
                  outlineStyle={{ borderRadius: theme.radius.input }}
                  textColor={theme.colors.text}
                  placeholderTextColor={theme.colors.muted}
                />
              </View>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Password</Text>
                <TextInput
                  testID="sign-up-password-input"
                  placeholder="Password"
                  value={password}
                  onChangeText={(value) => {
                    setPassword(value);
                    if (errorMessage) {
                      setErrorMessage(null);
                    }
                  }}
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                  returnKeyType="done"
                  style={styles.input}
                  mode="outlined"
                  outlineStyle={{ borderRadius: theme.radius.input }}
                  textColor={theme.colors.text}
                  placeholderTextColor={theme.colors.muted}
                />
              </View>

              {errorMessage ? (
                <Text testID="sign-up-error-message" style={styles.errorText}>
                  {errorMessage}
                </Text>
              ) : null}
              
              <Button 
                testID="sign-up-submit-button"
                mode="contained"
                buttonColor={theme.colors.accent}
                textColor={theme.colors.onAccent}
                onPress={handleSignUp}
                loading={loading}
                disabled={loading}
                style={styles.button}
              >
                Sign Up
              </Button>
              
              <View style={styles.linksContainer}>
                <TouchableOpacity 
                  testID="sign-up-sign-in-link"
                  onPress={() => router.push('/sign-in')}
                >
                  <Text style={styles.link}>
                    Already have an account? Sign in
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollViewContent: {
    flexGrow: 1,
  },
  inner: {
    flex: 1,
    padding: 28,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 36 },
  wordmark: { color: theme.colors.text, fontFamily: theme.font.bold, fontSize: 13, letterSpacing: 2.2 },
  title: {
    fontFamily: theme.font.bold,
    fontSize: 34,
    letterSpacing: -1.2,
    marginBottom: 10,
    color: theme.colors.text,
  },
  subtitle: {
    fontFamily: theme.font.regular,
    marginBottom: 28,
    color: theme.colors.secondary,
  },
  form: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: theme.colors.secondary,
    marginBottom: 6,
    marginLeft: 2,
  },
  input: {
    backgroundColor: theme.colors.surface,
  },
  button: {
    marginTop: 8,
    paddingVertical: 8,
    borderRadius: theme.radius.button,
  },
  errorText: {
    color: '#ff7b7b',
    marginTop: 4,
    marginBottom: 8,
    textAlign: 'center',
  },
  linksContainer: {
    marginTop: 24,
    alignItems: 'center',
  },
  link: {
    color: theme.colors.accentText,
    marginVertical: 4,
  },
});
