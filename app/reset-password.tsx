import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { errorWithTs } from '@/lib/logger';
import { getPlatformValue } from '@/lib/platform-utils';
import { createError, logError, mapToUserMessage } from '@/lib/services/ErrorHandler';
import { supabase } from '@/lib/supabase';

type RecoveryTokens = {
  accessToken: string;
  refreshToken: string;
};

function parseRecoveryTokens(url: string): RecoveryTokens | null {
  const hashMatch = url.match(/#(.+)/);
  const queryMatch = url.match(/\?(.+?)(?:#|$)/);
  const rawParams = hashMatch?.[1] ?? queryMatch?.[1];

  if (!rawParams) {
    return null;
  }

  const searchParams = new URLSearchParams(rawParams);
  const accessToken = searchParams.get('access_token') ?? searchParams.get('accessToken');
  const refreshToken = searchParams.get('refresh_token') ?? searchParams.get('refreshToken');

  if (!accessToken || !refreshToken) {
    return null;
  }

  return {
    accessToken,
    refreshToken,
  };
}

function mapResetUpdateError(error: unknown): string {
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : undefined;

  const rawMessage = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message ?? 'Failed to update password')
      : 'Failed to update password';

  const message = rawMessage.toLowerCase();

  if (status === 429) {
    return 'Too many attempts. Please wait a minute and try again.';
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

  if (message.includes('invalid') || message.includes('expired') || message.includes('recovery') || message.includes('token')) {
    return 'Recovery link is invalid or expired. Please request a new password reset email.';
  }

  if (message.includes('weak') || message.includes('password')) {
    return 'Please choose a stronger password (at least 8 characters).';
  }

  return mapToUserMessage(
    createError('auth', 'RESET_PASSWORD_UPDATE_FAILED', rawMessage, {
      retryable: true,
      severity: 'error',
      details: error,
    })
  );
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const ensureRecoverySession = async (): Promise<boolean> => {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      throw sessionError;
    }

    if (sessionData.session) {
      return true;
    }

    const initialUrl = await Linking.getInitialURL();
    if (!initialUrl) {
      return false;
    }

    const tokens = parseRecoveryTokens(initialUrl);
    if (!tokens) {
      return false;
    }

    const { error } = await supabase.auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });

    if (error) {
      throw error;
    }

    return true;
  };

  const handleUpdatePassword = async () => {
    if (!password.trim() || password.trim().length < 8) {
      setErrorMessage('Please choose a stronger password (at least 8 characters).');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    try {
      setLoading(true);
      setErrorMessage(null);

      const hasRecoverySession = await ensureRecoverySession();
      if (!hasRecoverySession) {
        setErrorMessage('Recovery link is invalid or expired. Please request a new password reset email.');
        return;
      }

      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) {
        throw error;
      }

      setPasswordUpdated(true);
    } catch (error) {
      errorWithTs('Reset password update error:', error);
      const appError = createError('auth', 'RESET_PASSWORD_UPDATE_FAILED', 'Failed to update password', {
        retryable: true,
        severity: 'error',
        details: error,
      });
      logError(appError, { feature: 'auth', location: 'reset-password' });
      setErrorMessage(mapResetUpdateError(error));
    } finally {
      setLoading(false);
    }
  };

  if (passwordUpdated) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.inner}>
          <Text testID="reset-password-success-message" variant="headlineMedium" style={styles.title}>Password Updated</Text>
          <Text style={styles.message}>
            Your password has been updated successfully. You can now sign in with your new password.
          </Text>
          <Button
            mode="contained"
            onPress={() => router.push('/sign-in')}
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
            <Text variant="headlineMedium" style={styles.title}>Set New Password</Text>
            <Text variant="bodyMedium" style={styles.subtitle}>
              Enter your new password below.
            </Text>

            <View style={styles.form}>
              <TextInput
                testID="reset-password-input"
                label="New Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                style={styles.input}
                mode="outlined"
              />

              <TextInput
                testID="reset-password-confirm-input"
                label="Confirm New Password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                autoCapitalize="none"
                style={styles.input}
                mode="outlined"
              />

              <Button
                testID="reset-password-submit-button"
                mode="contained"
                onPress={handleUpdatePassword}
                loading={loading}
                disabled={loading}
                style={styles.button}
              >
                Update Password
              </Button>

              {errorMessage ? (
                <Text testID="reset-password-error-message" style={styles.errorText}>
                  {errorMessage}
                </Text>
              ) : null}

              <View style={styles.linksContainer}>
                <TouchableOpacity onPress={() => router.push('/sign-in')}>
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
