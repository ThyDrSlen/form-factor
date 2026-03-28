import { View, StyleSheet, ScrollView, KeyboardAvoidingView, TouchableOpacity } from 'react-native';
import { Text, TextInput, Button } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
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
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        behavior={getPlatformValue({ ios: 'padding', default: 'height' })}
        style={styles.keyboardAvoidingView}
      >
        <ScrollView 
          contentContainerStyle={styles.scrollViewContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.inner}>
            <Text variant="headlineMedium" style={styles.title}>Create Account</Text>
            <Text variant="bodyMedium" style={styles.subtitle}>Sign up to get started</Text>
            
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050E1F',
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollViewContent: {
    flexGrow: 1,
  },
  inner: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  title: {
    textAlign: 'center',
    marginBottom: 16,
    fontWeight: 'bold',
    color: '#F5F7FF',
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: 32,
    color: '#9AACD1',
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
    color: '#9AACD1',
    marginBottom: 6,
    marginLeft: 2,
  },
  input: {
    backgroundColor: '#13263C',
  },
  button: {
    marginTop: 8,
    paddingVertical: 6,
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
    color: '#4C8CFF',
    marginVertical: 4,
  },
});
