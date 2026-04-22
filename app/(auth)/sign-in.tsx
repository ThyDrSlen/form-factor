import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { isIOS } from '@/lib/platform-utils';

type FormData = {
  email: string;
  password: string;
  fullName?: string;
};

type FieldError = { field: 'email' | 'password' | 'fullName' | 'form'; message: string };

export default function SignInScreen() {
  const router = useRouter();
  const { show: showToast } = useToast();
  const [isSignUp, setIsSignUp] = useState(false);
  const [isMagicLink, setIsMagicLink] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    email: '',
    password: '',
    fullName: '',
  });
  const isiOS = isIOS();
  const {
    signInWithGoogle,
    signInWithApple,
    signInWithEmail,
    signInWithMagicLink,
    signUpWithEmail,
    isSigningIn,
    error: authError,
    clearError
  } = useAuth();

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

  /**
   * Wave-31 Pack A / A8 (#562): map common Supabase auth errors to the
   * specific form field that owns them, so the validation copy appears
   * *next to* the field instead of only in the generic banner at the
   * top of the card. Falls through to the legacy `getErrorMessage` for
   * anything we don't recognize.
   */
  const mapSupabaseError = (error: any): FieldError => {
    if (!error) return { field: 'form', message: '' };

    const raw = (error.message || error.toString() || '').toLowerCase();
    const code = (error.code || error.name || '').toString().toLowerCase();

    // email_already_exists
    if (
      code === 'email_already_exists' ||
      raw.includes('email_already_exists') ||
      raw.includes('user already registered') ||
      raw.includes('already registered')
    ) {
      return { field: 'email', message: 'Email already exists. Sign in instead?' };
    }

    // weak_password
    if (
      code === 'weak_password' ||
      raw.includes('weak_password') ||
      raw.includes('password should be at least') ||
      raw.includes('password is too weak')
    ) {
      return {
        field: 'password',
        message: 'Password too weak. Use at least 6 characters with letters and numbers.',
      };
    }

    // invalid_credentials
    if (
      code === 'invalid_credentials' ||
      raw.includes('invalid_credentials') ||
      raw.includes('invalid login credentials')
    ) {
      return { field: 'password', message: 'Invalid email or password.' };
    }

    // network_error
    if (
      code === 'network_error' ||
      raw.includes('network request failed') ||
      raw.includes('network connection failed') ||
      raw.includes('unable to connect')
    ) {
      return {
        field: 'form',
        message: 'Network error — check your connection and try again.',
      };
    }

    // Fall back to the existing generic mapper for unrecognized codes
    return { field: 'form', message: getErrorMessage(error) };
  };

  const applyFieldError = (err: unknown) => {
    const mapped = mapSupabaseError(err);
    setFieldError(mapped.message ? mapped : null);
    if (mapped.field === 'form') {
      setErrorMessage(mapped.message);
    } else {
      setErrorMessage('');
    }
  };

  const handleEmailAuth = async () => {
    if (!formData.email || !formData.password) {
      setErrorMessage('Please fill in all fields');
      setFieldError(null);
      return;
    }

    setErrorMessage('');
    setFieldError(null);
    clearError();

    try {
      if (isSignUp) {
        if (!formData.fullName?.trim()) {
          setFieldError({ field: 'fullName', message: 'Please enter your full name' });
          return;
        }
        const { error } = await signUpWithEmail(
          formData.email,
          formData.password,
          { fullName: formData.fullName }
        );
        if (error) {
          applyFieldError(error);
          return;
        }
        // Wave-31 Pack A / A8 (#562): celebratory toast on sign-up success.
        // The Alert below is kept so users on slow networks still see a
        // blocking confirmation they need to open their inbox.
        showToast('Account created — check your email', { type: 'success' });
        setIsSignUp(false);
        setFormData((prev) => ({ ...prev, password: '' }));
        Alert.alert('Success', 'Check your email to confirm your account, then sign in.');
      } else {
        const { error } = await signInWithEmail(formData.email, formData.password);
        if (error) {
          applyFieldError(error);
          return;
        }
      }
    } catch (error) {
      applyFieldError(error);
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

  const handleMagicLink = async () => {
    if (!formData.email || !formData.email.includes('@')) {
      setErrorMessage('Please enter a valid email address');
      return;
    }

    setErrorMessage('');
    clearError();

    try {
      const { error } = await signInWithMagicLink(formData.email.trim());

      if (error) {
        setErrorMessage(getErrorMessage(error));
        return;
      }

      setMagicLinkSent(true);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={isiOS ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              Form Factor
            </Text>
          </View>

          {/* Main card container */}
          <View style={styles.card}>
            <View style={styles.logoContainer}>
              <Image
                source={require('../../assets/images/ff-logo.png')}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>

            <Text style={styles.welcomeTitle}>
              Welcome to Form Factor
            </Text>

            {/* Error message */}
            {(errorMessage || authError) && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>
                  {errorMessage || authError}
                </Text>
              </View>
            )}

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Email</Text>
              <TextInput
                style={[styles.input, fieldError?.field === 'email' && styles.inputError]}
                placeholder="Email"
                placeholderTextColor="#6781A6"
                value={formData.email}
                onChangeText={(text) => {
                  setFormData(prev => ({ ...prev, email: text.trim() }));
                  if (fieldError?.field === 'email') setFieldError(null);
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                textContentType="emailAddress"
                returnKeyType={isSignUp && !isMagicLink ? 'next' : 'done'}
                editable={!isSigningIn}
              />
              {fieldError?.field === 'email' && (
                <Text style={styles.fieldErrorText}>{fieldError.message}</Text>
              )}
            </View>

            {isSignUp && !isMagicLink && (
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Full Name</Text>
                <TextInput
                  style={[styles.input, fieldError?.field === 'fullName' && styles.inputError]}
                  placeholder="Full Name"
                  placeholderTextColor="#6781A6"
                  value={formData.fullName}
                  onChangeText={(text) => {
                    setFormData((prev) => ({ ...prev, fullName: text }));
                    if (fieldError?.field === 'fullName') setFieldError(null);
                  }}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="next"
                  editable={!isSigningIn}
                />
                {fieldError?.field === 'fullName' && (
                  <Text style={styles.fieldErrorText}>{fieldError.message}</Text>
                )}
              </View>
            )}

            {!isMagicLink && (
              <>
                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>Password</Text>
                  <TextInput
                    style={[styles.input, fieldError?.field === 'password' && styles.inputError]}
                    placeholder="Password"
                    placeholderTextColor="#6781A6"
                    value={formData.password}
                    onChangeText={(text) => {
                      setFormData(prev => ({ ...prev, password: text }));
                      if (fieldError?.field === 'password') setFieldError(null);
                    }}
                    secureTextEntry
                    autoComplete={isSignUp ? 'new-password' : 'current-password'}
                    textContentType={isSignUp ? 'newPassword' : 'password'}
                    returnKeyType="done"
                    editable={!isSigningIn}
                  />
                  {fieldError?.field === 'password' && (
                    <Text style={styles.fieldErrorText}>{fieldError.message}</Text>
                  )}
                </View>

                <TouchableOpacity
                  style={[styles.loginButton, isSigningIn && styles.buttonDisabled]}
                  onPress={handleEmailAuth}
                  disabled={isSigningIn}
                >
                  <Text style={styles.buttonText}>
                    {isSigningIn ? (isSignUp ? 'Creating Account...' : 'Logging In...') : (isSignUp ? 'Create Account' : 'Log In')}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            {isMagicLink && magicLinkSent && (
              <View style={styles.successContainer}>
                <Text style={styles.successText}>
                  Magic link sent! Check your email to sign in.
                </Text>
              </View>
            )}

            {!isSignUp && (
              <TouchableOpacity
                style={styles.magicLinkToggle}
                onPress={() => {
                  setIsMagicLink(!isMagicLink);
                  setErrorMessage('');
                  setMagicLinkSent(false);
                }}
                disabled={isSigningIn}
              >
                <Text style={styles.magicLinkToggleText}>
                  {isMagicLink ? 'Use password sign in' : 'Send magic link instead'}
                </Text>
              </TouchableOpacity>
            )}

            {isMagicLink && (
              <TouchableOpacity
                style={[styles.loginButton, isSigningIn && styles.buttonDisabled]}
                onPress={handleMagicLink}
                disabled={isSigningIn || magicLinkSent}
              >
                <Text style={styles.buttonText}>
                  {isSigningIn ? 'Sending...' : magicLinkSent ? 'Link Sent' : 'Send Magic Link'}
                </Text>
              </TouchableOpacity>
            )}

            <View style={styles.signUpContainer}>
              <Text style={styles.signUpText}>
                {isSignUp ? 'Already have an account? ' : 'Don\'t have an account? '}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setIsSignUp((prev) => !prev);
                  setIsMagicLink(false);
                  setMagicLinkSent(false);
                  setErrorMessage('');
                  setFieldError(null);
                  clearError();
                }}
                disabled={isSigningIn}
              >
                <Text style={styles.signUpLink}>
                  {isSignUp ? 'Sign in' : 'Sign up'}
                </Text>
              </TouchableOpacity>
            </View>

            {!isSignUp && !isMagicLink && (
              <View style={styles.signUpContainer}>
                <TouchableOpacity onPress={() => router.push('/forgot-password')} disabled={isSigningIn}>
                  <Text style={styles.signUpLink}>Forgot password?</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Social login buttons */}
            <TouchableOpacity
              style={[styles.socialButton, isSigningIn && styles.buttonDisabled]}
              onPress={() => handleSocialAuth('google')}
              disabled={isSigningIn}
            >
              <Text style={styles.socialButtonText}>
                Continue with Google
              </Text>
            </TouchableOpacity>

            {isiOS && (
              <TouchableOpacity
                style={[styles.socialButton, isSigningIn && styles.buttonDisabled]}
                onPress={() => handleSocialAuth('apple')}
                disabled={isSigningIn}
              >
                <Text style={styles.socialButtonText}>
                  Continue with Apple
                </Text>
              </TouchableOpacity>
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
  logoContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logo: {
    width: 80,
    height: 80,
  },
  welcomeTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 32,
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
  inputLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#9AACD1',
    marginBottom: 6,
    marginLeft: 2,
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
  inputError: {
    borderColor: '#FF453A',
  },
  fieldErrorText: {
    marginTop: 6,
    marginLeft: 4,
    fontSize: 12,
    color: '#FF453A',
  },
  loginButton: {
    backgroundColor: '#007AFF',
    marginTop: 16,
    marginBottom: 24,
    borderRadius: 25,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signUpContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
  },
  signUpLink: {
    fontSize: 16,
    color: '#007AFF',
    textDecorationLine: 'underline',
  },
  socialButton: {
    backgroundColor: '#13263C',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1B2E4A',
    borderRadius: 25,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  errorText: {
    fontSize: 13,
    color: '#FF453A',
    textAlign: 'center',
  },
  buttonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  signUpText: {
    fontSize: 16,
    color: '#8E8E93',
  },
  magicLinkToggle: {
    marginBottom: 16,
    paddingVertical: 8,
  },
  magicLinkToggleText: {
    fontSize: 14,
    color: '#007AFF',
    textAlign: 'center',
    fontWeight: '500',
  },
  successContainer: {
    backgroundColor: 'rgba(52, 199, 89, 0.1)',
    borderWidth: 1,
    borderColor: '#34C759',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  successText: {
    fontSize: 14,
    color: '#34C759',
    textAlign: 'center',
  },
  socialButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
