import { View, StyleSheet, ScrollView, KeyboardAvoidingView, TouchableOpacity } from 'react-native';
import { Text, TextInput, Button } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { errorWithTs } from '@/lib/logger';
import { getPlatformValue } from '@/lib/platform-utils';
import { supabase } from '@/lib/supabase';
import { createError, logError, mapToUserMessage } from '@/lib/services/ErrorHandler';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const router = useRouter();

  const mapResetErrorMessage = (error: unknown): string => {
    const status = typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
    const rawMessage = error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message ?? 'Failed to send reset email')
        : 'Failed to send reset email';
    const message = rawMessage.toLowerCase();

    if (status === 429) {
      return 'Too many reset attempts. Please wait a minute and try again.';
    }

    if (status && status >= 500) {
      return 'Reset service is temporarily unavailable. Please try again shortly.';
    }

    if (message.includes('network') || message.includes('fetch')) {
      return mapToUserMessage(
        createError('network', 'RESET_PASSWORD_NETWORK_ERROR', rawMessage, {
          retryable: true,
          severity: 'warning',
          details: error,
        })
      );
    }

    if (message.includes('invalid') || message.includes('email')) {
      return 'Please enter a valid email address.';
    }

    return mapToUserMessage(
      createError('auth', 'RESET_PASSWORD_FAILED', rawMessage, {
        retryable: true,
        severity: 'error',
        details: error,
      })
    );
  };

  const handleResetPassword = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);

      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: Linking.createURL('/reset-password'),
      });

      if (error) {
        throw error;
      }

      setEmailSent(true);
    } catch (error) {
      errorWithTs('Password reset error:', error);
      const appError = createError('auth', 'RESET_PASSWORD_FAILED', 'Failed to send reset email', {
        retryable: true,
        severity: 'error',
        details: error,
      });
      logError(appError, { feature: 'auth', location: 'forgot-password' });
      setErrorMessage(mapResetErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  if (emailSent) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.inner}>
          <Text testID="forgot-password-success-message" variant="headlineMedium" style={styles.title}>Check Your Email</Text>
          <Text style={styles.message}>
            We&apos;ve sent password reset instructions to {email}. Please check your email and follow the instructions to reset your password.
          </Text>
          <Button 
            mode="contained" 
            onPress={() => router.push('/auth/sign-in')}
            style={styles.button}
          >
            Back to Sign In
          </Button>
        </View>
      </SafeAreaView>
    );
  }

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
            <Text variant="headlineMedium" style={styles.title}>Reset Password</Text>
            <Text variant="bodyMedium" style={styles.subtitle}>
              Enter your email address and we&apos;ll send you a link to reset your password.
            </Text>
            
            <View style={styles.form}>
              <TextInput
                testID="forgot-password-email-input"
                label="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                style={styles.input}
                mode="outlined"
              />
              
              <Button 
                testID="forgot-password-submit-button"
                mode="contained" 
                onPress={handleResetPassword}
                loading={loading}
                disabled={!email || loading}
                style={styles.button}
              >
                Send Reset Link
              </Button>

              {errorMessage ? (
                <Text testID="forgot-password-error-message" style={styles.errorText}>
                  {errorMessage}
                </Text>
              ) : null}
              
              <View style={styles.linksContainer}>
                <TouchableOpacity 
                  onPress={() => router.push('/auth/sign-in')}
                >
                  <Text style={styles.link}>
                    Back to Sign In
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
  input: {
    marginBottom: 16,
    backgroundColor: '#13263C',
  },
  button: {
    marginTop: 8,
    paddingVertical: 6,
  },
  linksContainer: {
    marginTop: 24,
    alignItems: 'center',
  },
  link: {
    color: '#4C8CFF',
    marginVertical: 4,
  },
  message: {
    textAlign: 'center',
    marginBottom: 32,
    color: '#9AACD1',
    lineHeight: 22,
  },
  errorText: {
    color: '#ff7b7b',
    marginTop: 12,
    textAlign: 'center',
  },
});
