import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { Button, Text, useTheme } from '@/design-system';

type FormData = {
  email: string;
  password: string;
  fullName?: string;
};

export default function SignInScreen() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [formData, setFormData] = useState<FormData>({
    email: '',
    password: '',
    fullName: '',
  });
  const {
    signInWithGoogle,
    signInWithApple,
    signInWithEmail,
    signUpWithEmail,
    resetPassword,
    isSigningIn,
    error: authError,
    clearError
  } = useAuth();
  const { theme } = useTheme();

  const getErrorMessage = (error: any): string => {
    if (!error) return '';

    const message = error.message || error.toString();

    // Handle network and configuration errors
    if (message.includes('Network request failed') || message.includes('Network connection failed')) {
      return 'Unable to connect to the server. Please check your internet connection and try again.';
    }
    if (message.includes('App configuration error') || message.includes('Supabase configuration is missing')) {
      return 'App configuration error. Please restart the app or contact support if the issue persists.';
    }
    if (message.includes('Unable to connect to authentication server')) {
      return 'Cannot reach authentication server. Please check your internet connection.';
    }

    // Handle common authentication errors with user-friendly messages
    if (message.includes('Invalid login credentials')) {
      return 'Invalid email or password. Please check your credentials and try again.';
    }
    if (message.includes('Email not confirmed')) {
      return 'Please check your email and click the confirmation link before signing in.';
    }
    if (message.includes('Too many requests')) {
      return 'Too many login attempts. Please wait a few minutes before trying again.';
    }
    if (message.includes('User not found')) {
      return 'No account found with this email address. Please sign up first.';
    }
    if (message.includes('Password should be at least')) {
      return 'Password must be at least 6 characters long.';
    }
    if (message.includes('Unable to validate email address')) {
      return 'Please enter a valid email address.';
    }
    if (message.includes('cancelled') || message.includes('dismissed')) {
      return ''; // Don't show error for user cancellation
    }

    // Default error message
    return message || 'An unexpected error occurred. Please try again.';
  };

  const handleEmailAuth = async () => {
    if (!formData.email || !formData.password) {
      setErrorMessage('Please fill in all fields');
      return;
    }

    setErrorMessage('');
    clearError();

    try {
      if (isSignUp) {
        if (!formData.fullName?.trim()) {
          setErrorMessage('Please enter your full name');
          return;
        }
        const { error } = await signUpWithEmail(
          formData.email,
          formData.password,
          { fullName: formData.fullName }
        );
        if (error) {
          setErrorMessage(getErrorMessage(error));
          return;
        }
        Alert.alert('Success', 'Check your email to confirm your account!');
      } else {
        const { error } = await signInWithEmail(formData.email, formData.password);
        if (error) {
          setErrorMessage(getErrorMessage(error));
          return;
        }
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const handleSocialAuth = async (provider: 'google' | 'apple') => {
    setErrorMessage('');
    clearError();

    try {
      const { error } = provider === 'google'
        ? await signInWithGoogle()
        : await signInWithApple();

      if (error) {
        const errorMsg = getErrorMessage(error);
        if (errorMsg) setErrorMessage(errorMsg);
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header with help button */}
          <View style={styles.header}>
            <Text variant="headline" weight="semibold" color="#FFFFFF">
              Form Factor
            </Text>
            <TouchableOpacity style={styles.helpButton}>
              <Ionicons name="help-circle-outline" size={24} color="#8E8E93" />
            </TouchableOpacity>
          </View>

          {/* Main card container */}
          <View style={styles.card}>
            <Text variant="largeTitle" weight="normal" color="#FFFFFF" align="center" style={styles.welcomeTitle}>
              Welcome to Form Factor
            </Text>

            {/* Error message */}
            {(errorMessage || authError) && (
              <View style={styles.errorContainer}>
                <Text variant="footnote" color="#FF453A" align="center">
                  {errorMessage || authError}
                </Text>
              </View>
            )}

            {/* Email input */}
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor="#6781A6"
                value={formData.email}
                onChangeText={(text) => setFormData(prev => ({ ...prev, email: text.trim() }))}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isSigningIn}
              />
            </View>

            {/* Password input */}
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="#6781A6"
                value={formData.password}
                onChangeText={(text) => setFormData(prev => ({ ...prev, password: text }))}
                secureTextEntry
                editable={!isSigningIn}
              />
            </View>

            {/* Login button */}
            <Button
              title={isSigningIn ? 'Logging In...' : 'Log In'}
              variant="primary"
              size="large"
              fullWidth
              onPress={handleEmailAuth}
              disabled={isSigningIn}
              style={styles.loginButton}
            />

            {/* Sign up link */}
            <View style={styles.signUpContainer}>
              <Text variant="body" color="#8E8E93">
                Don't have an account?{' '}
              </Text>
              <TouchableOpacity onPress={() => setIsSignUp(!isSignUp)} disabled={isSigningIn}>
                <Text variant="body" color="#007AFF" style={styles.signUpLink}>
                  Sign up
                </Text>
              </TouchableOpacity>
            </View>

            {/* Social login buttons */}
            <Button
              title="Continue with Google"
              variant="secondary"
              size="large"
              fullWidth
              onPress={() => handleSocialAuth('google')}
              disabled={isSigningIn}
              style={styles.socialButton}
              textStyle={{ color: '#FFFFFF' }}
            />

            {Platform.OS === 'ios' && (
              <Button
                title="Continue with Apple"
                variant="secondary"
                size="large"
                fullWidth
                onPress={() => handleSocialAuth('apple')}
                disabled={isSigningIn}
                style={styles.socialButton}
                textStyle={{ color: '#FFFFFF' }}
              />
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050E1F',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 40,
  },
  helpButton: {
    padding: 8,
  },
  card: {
    backgroundColor: '#0F2339',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#1B2E4A',
    padding: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  welcomeTitle: {
    marginBottom: 32,
    lineHeight: 40,
  },
  errorContainer: {
    backgroundColor: 'rgba(255, 69, 58, 0.1)',
    borderWidth: 1,
    borderColor: '#FF453A',
    borderRadius: 12,
    padding: 12,
    marginBottom: 24,
  },
  inputContainer: {
    marginBottom: 16,
  },
  input: {
    backgroundColor: '#13263C',
    borderWidth: 1,
    borderColor: '#1B2E4A',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
    color: '#F5F7FF',
    minHeight: 50,
  },
  loginButton: {
    marginTop: 16,
    marginBottom: 24,
    borderRadius: 25, // More rounded like in the design
  },
  signUpContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
  },
  signUpLink: {
    textDecorationLine: 'underline',
  },
  socialButton: {
    backgroundColor: '#13263C',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
});