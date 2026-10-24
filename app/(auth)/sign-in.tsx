import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@/features/auth/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { isIOS } from '@/lib/platform-utils';
import { BrandMark } from '@/components/BrandMark';
import { SocialSignInButtons } from '@/features/auth/components/SocialSignInButtons';
import { styles } from '@/features/auth/styles/sign-in.styles';

type FormData = {
  email: string;
  password: string;
  fullName?: string;
};

type FieldError = { field: 'email' | 'password' | 'fullName' | 'form'; message: string };

export default function SignInScreen() {
  const router = useRouter();
  const { show: showToast } = useToast();
  const fullNameInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);
  // TODO(wave-36): honor `mode=existing` query to default to the existing-account tab
  // (forwarded from app/(onboarding)/welcome.tsx's "I already have an account" CTA).
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
    if (isSigningIn) return;

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
          fullNameInputRef.current?.focus();
          return;
        }
        Keyboard.dismiss();
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
        Keyboard.dismiss();
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
    Keyboard.dismiss();
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
    if (isSigningIn || magicLinkSent) return;

    if (!formData.email || !formData.email.includes('@')) {
      setErrorMessage('Please enter a valid email address');
      return;
    }

    Keyboard.dismiss();
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
        enabled={!isiOS}
        behavior="height"
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          // The auth layout owns safe-area padding. On iOS, let the native
          // scroll view inset and reveal focused fields without resizing it twice.
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustKeyboardInsets={isiOS}
          keyboardDismissMode={isiOS ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <BrandMark size={44} />
            <Text style={styles.headerTitle}>FORM FACTOR</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.welcomeTitle}>
              {isSignUp ? 'Start strong.' : 'Welcome back.'}
            </Text>
            <Text style={styles.subtitle}>
              {isSignUp ? 'Better movement starts with your next rep.' : 'Your training. Your progress. All in one place.'}
            </Text>
            <SocialSignInButtons disabled={isSigningIn} onPress={handleSocialAuth} />
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or continue with email</Text>
              <View style={styles.dividerLine} />
            </View>

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
                placeholder="you@example.com"
                accessibilityLabel="Email"
                placeholderTextColor="#A4ABB8"
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
                returnKeyType={isMagicLink ? 'send' : 'next'}
                submitBehavior="submit"
                onSubmitEditing={() => {
                  if (isMagicLink) {
                    void handleMagicLink();
                  } else if (isSignUp) {
                    fullNameInputRef.current?.focus();
                  } else {
                    passwordInputRef.current?.focus();
                  }
                }}
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
                  ref={fullNameInputRef}
                  style={[styles.input, fieldError?.field === 'fullName' && styles.inputError]}
                  placeholder="Your full name"
                  accessibilityLabel="Full name"
                  placeholderTextColor="#A4ABB8"
                  value={formData.fullName}
                  onChangeText={(text) => {
                    setFormData((prev) => ({ ...prev, fullName: text }));
                    if (fieldError?.field === 'fullName') setFieldError(null);
                  }}
                  autoCapitalize="words"
                  autoComplete="name"
                  textContentType="name"
                  autoCorrect={false}
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => passwordInputRef.current?.focus()}
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
                    ref={passwordInputRef}
                    style={[styles.input, fieldError?.field === 'password' && styles.inputError]}
                    placeholder="Enter your password"
                    accessibilityLabel="Password"
                    placeholderTextColor="#A4ABB8"
                    value={formData.password}
                    onChangeText={(text) => {
                      setFormData(prev => ({ ...prev, password: text }));
                      if (fieldError?.field === 'password') setFieldError(null);
                    }}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete={isSignUp ? 'new-password' : 'current-password'}
                    textContentType={isSignUp ? 'newPassword' : 'password'}
                    returnKeyType="go"
                    submitBehavior="submit"
                    onSubmitEditing={() => void handleEmailAuth()}
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
                    {isSigningIn ? (isSignUp ? 'Creating Account...' : 'Signing in...') : (isSignUp ? 'Create Account' : 'Sign in')}
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
                  Keyboard.dismiss();
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
                  Keyboard.dismiss();
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

          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
