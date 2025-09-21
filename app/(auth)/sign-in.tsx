import { useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';

// Public URLs for social login icons
const GOOGLE_ICON_URL = 'https://upload.wikimedia.org/wikipedia/commons/5/53/Google_%22G%22_Logo.svg';
const APPLE_ICON_URL = 'https://upload.wikimedia.org/wikipedia/commons/f/fa/Apple_logo_black.svg';

type AuthMethod = 'google' | 'apple' | 'email' | null;

type FormData = {
  email: string;
  password: string;
  fullName?: string;
};

export default function SignInScreen() {
  const [selectedMethod, setSelectedMethod] = useState<AuthMethod>(null);
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

  const getErrorMessage = (error: any): string => {
    if (!error) return '';
    
    const message = error.message || error.toString();
    
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

  const handleAuthPress = async (method: AuthMethod) => {
    if (isSigningIn) return;
    
    // Clear any previous errors
    setErrorMessage('');
    clearError();
    setSelectedMethod(method);
    
    try {
      if (method === 'google') {
        const { error } = await signInWithGoogle();
        if (error) {
          const errorMsg = getErrorMessage(error);
          if (errorMsg) setErrorMessage(errorMsg);
          return;
        }
      } else if (method === 'apple') {
        const { error } = await signInWithApple();
        if (error) {
          const errorMsg = getErrorMessage(error);
          if (errorMsg) setErrorMessage(errorMsg);
          return;
        }
      } else if (method === 'email' && formData.email && formData.password) {
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
            const errorMsg = getErrorMessage(error);
            if (errorMsg) setErrorMessage(errorMsg);
            return;
          }
          Alert.alert('Success', 'Check your email to confirm your account!');
        } else {
          const { error } = await signInWithEmail(formData.email, formData.password);
          if (error) {
            const errorMsg = getErrorMessage(error);
            if (errorMsg) setErrorMessage(errorMsg);
            return;
          }
        }
      } else {
        setErrorMessage('Please fill in all required fields');
        return;
      }
    } catch (error) {
      console.error('Authentication error:', error);
      const errorMsg = getErrorMessage(error);
      if (errorMsg) setErrorMessage(errorMsg);
    } finally {
      setSelectedMethod(null);
    }
  };

  const handlePasswordReset = async () => {
    if (!formData.email?.trim()) {
      setErrorMessage('Please enter your email address');
      return;
    }
    
    setErrorMessage('');
    
    try {
      const { error } = await resetPassword(formData.email);
      if (error) {
        const errorMsg = getErrorMessage(error);
        if (errorMsg) setErrorMessage(errorMsg);
        return;
      }
      Alert.alert('Success', 'Check your email for a password reset link');
    } catch (error) {
      console.error('Password reset error:', error);
      const errorMsg = getErrorMessage(error);
      if (errorMsg) setErrorMessage(errorMsg);
    }
  };

  const updateFormData = (field: keyof FormData, value: string) => {
    // Clear errors when user starts typing
    if (errorMessage) setErrorMessage('');
    if (authError) clearError();
    
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const renderErrorMessage = () => {
    const displayError = errorMessage || authError;
    if (!displayError) return null;

    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{displayError}</Text>
      </View>
    );
  };

  const renderAuthButton = (method: AuthMethod, icon: string | null, label: string, buttonStyle: any, textStyle: any) => {
    if (selectedMethod && selectedMethod !== method) return null;
    
    return (
      <TouchableOpacity
        style={[styles.button, buttonStyle]}
        onPress={() => method === 'email' ? handleAuthPress(method) : handleAuthPress(method as Exclude<AuthMethod, 'email'>)}
        disabled={isSigningIn}
      >
        {icon && (
          <Image
            source={{ uri: icon }}
            style={[styles.buttonIcon]}
            resizeMode="contain"
            tintColor={method === 'apple' ? '#fff' : undefined}
          />
        )}
        <Text style={[styles.buttonText, textStyle]}>
          {isSigningIn && selectedMethod === method ? 'Signing in...' : label}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderEmailForm = () => (
    <View style={styles.formContainer}>
      {renderErrorMessage()}
      
      {isSignUp && (
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Full Name</Text>
          <TextInput
            style={[styles.input, errorMessage && styles.inputError]}
            placeholder="John Doe"
            value={formData.fullName}
            onChangeText={(text) => updateFormData('fullName', text)}
            autoCapitalize="words"
            editable={!isSigningIn}
          />
        </View>
      )}
      <View style={styles.inputContainer}>
        <Text style={styles.label}>Email</Text>
        <TextInput
          style={[styles.input, errorMessage && styles.inputError]}
          placeholder="your@email.com"
          value={formData.email}
          onChangeText={(text) => updateFormData('email', text.trim())}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isSigningIn}
        />
      </View>
      <View style={styles.inputContainer}>
        <Text style={styles.label}>Password</Text>
        <TextInput
          style={[styles.input, errorMessage && styles.inputError]}
          placeholder="••••••••"
          value={formData.password}
          onChangeText={(text) => updateFormData('password', text)}
          secureTextEntry
          editable={!isSigningIn}
        />
      </View>
      {!isSignUp && (
        <TouchableOpacity 
          style={styles.forgotPasswordButton}
          onPress={handlePasswordReset}
          disabled={isSigningIn}
        >
          <Text style={styles.forgotPasswordText}>Forgot password?</Text>
        </TouchableOpacity>
      )}
      {renderAuthButton('email', null, isSignUp ? 'Sign Up' : 'Sign In', styles.emailButton, styles.emailButtonText)}
      <View style={styles.toggleAuthContainer}>
        <Text style={styles.toggleAuthText}>
          {isSignUp ? 'Already have an account?' : "Don't have an account?"}
        </Text>
        <TouchableOpacity 
          onPress={() => {
            setIsSignUp(!isSignUp);
            setSelectedMethod(null);
            setErrorMessage('');
            clearError();
          }}
          disabled={isSigningIn}
        >
          <Text style={styles.toggleAuthButton}>
            {isSignUp ? ' Sign In' : ' Sign Up'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderAuthOptions = () => {
    if (selectedMethod) return null;
    
    return (
      <View style={styles.authOptionsContainer}>
        <TouchableOpacity
          style={styles.emailOption}
          onPress={() => setSelectedMethod('email')}
        >
          <Text style={styles.emailOptionText}>Continue with Email</Text>
        </TouchableOpacity>
        
        <View style={styles.dividerContainer}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>OR</Text>
          <View style={styles.dividerLine} />
        </View>
        
        <TouchableOpacity
          style={styles.authOption}
          onPress={() => setSelectedMethod('google')}
        >
          <Image
            source={{ uri: GOOGLE_ICON_URL }}
            style={styles.authOptionIcon}
            resizeMode="contain"
          />
          <Text style={styles.authOptionText}>Continue with Google</Text>
        </TouchableOpacity>

        {Platform.OS === 'ios' && (
          <TouchableOpacity
            style={[styles.authOption, styles.appleButton]}
            onPress={() => setSelectedMethod('apple')}
          >
            <Image
              source={{ uri: APPLE_ICON_URL }}
              style={[styles.authOptionIcon, { tintColor: '#fff' }]}
              resizeMode="contain"
            />
            <Text style={[styles.authOptionText, { color: '#fff' }]}>Continue with Apple</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          <Text style={styles.title}>
            {isSignUp ? 'Create Account' : 'Welcome Back'}
          </Text>
          <Text style={styles.subtitle}>
            {isSignUp ? 'Sign up to get started' : 'Sign in to continue'}
          </Text>

          {selectedMethod === 'email' ? (
            renderEmailForm()
          ) : selectedMethod === 'google' ? (
            <View>
              {renderErrorMessage()}
              {renderAuthButton('google', GOOGLE_ICON_URL, 'Continue with Google', styles.googleButton, styles.googleButtonText)}
            </View>
          ) : selectedMethod === 'apple' ? (
            <View>
              {renderErrorMessage()}
              {renderAuthButton('apple', APPLE_ICON_URL, 'Continue with Apple', styles.appleButton, styles.appleButtonText)}
            </View>
          ) : (
            <>
              {renderErrorMessage()}
              {renderAuthOptions()}
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  content: {
    padding: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
    color: '#000000',
  },
  subtitle: {
    fontSize: 16,
    color: '#666666',
    marginBottom: 32,
    textAlign: 'center',
  },
  formContainer: {
    marginTop: 16,
  },
  inputContainer: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 8,
    fontWeight: '500',
  },
  input: {
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  forgotPasswordButton: {
    alignSelf: 'flex-end',
    marginBottom: 24,
  },
  forgotPasswordText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: '500',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  buttonIcon: {
    width: 20,
    height: 20,
    marginRight: 12,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  emailButton: {
    backgroundColor: '#007AFF',
    borderWidth: 0,
  },
  emailButtonText: {
    color: '#ffffff',
  },
  emailOption: {
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  emailOptionText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
  },
  googleButton: {
    backgroundColor: '#ffffff',
  },
  googleButtonText: {
    color: '#000000',
  },
  appleButton: {
    backgroundColor: '#000000',
  },
  appleButtonText: {
    color: '#ffffff',
  },
  authOptionsContainer: {
    marginTop: 16,
  },
  authOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  authOptionIcon: {
    width: 24,
    height: 24,
    marginRight: 12,
  },
  authOptionText: {
    fontSize: 16,
    color: '#333333',
    fontWeight: '500',
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e0e0e0',
  },
  dividerText: {
    paddingHorizontal: 10,
    color: '#999999',
    fontSize: 14,
  },
  toggleAuthContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
  },
  toggleAuthText: {
    color: '#666666',
    fontSize: 14,
  },
  toggleAuthButton: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: '600',
  },
  errorContainer: {
    backgroundColor: '#FFF2F2',
    borderWidth: 1,
    borderColor: '#FFB3B3',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#D32F2F',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  inputError: {
    borderColor: '#FF3B30',
    borderWidth: 1,
  },
});
