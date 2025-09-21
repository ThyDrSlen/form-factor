import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, TouchableOpacity } from 'react-native';
import { Text, TextInput, Button } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useState } from 'react';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const router = useRouter();

  const handleResetPassword = async () => {
    try {
      setLoading(true);
      // TODO: Implement password reset logic
      // This is where you would call your auth provider's password reset function
      // For now, we'll just simulate a successful response
      await new Promise(resolve => setTimeout(resolve, 1000));
      setEmailSent(true);
    } catch (error) {
      console.error('Password reset error:', error);
      // Handle error (show error message to user)
    } finally {
      setLoading(false);
    }
  };

  if (emailSent) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.inner}>
          <Text variant="headlineMedium" style={styles.title}>Check Your Email</Text>
          <Text style={styles.message}>
            We've sent password reset instructions to {email}. Please check your email and follow the instructions to reset your password.
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
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoidingView}
      >
        <ScrollView 
          contentContainerStyle={styles.scrollViewContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.inner}>
            <Text variant="headlineMedium" style={styles.title}>Reset Password</Text>
            <Text variant="bodyMedium" style={styles.subtitle}>
              Enter your email address and we'll send you a link to reset your password.
            </Text>
            
            <View style={styles.form}>
              <TextInput
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
                mode="contained" 
                onPress={handleResetPassword}
                loading={loading}
                disabled={!email || loading}
                style={styles.button}
              >
                Send Reset Link
              </Button>
              
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
    backgroundColor: '#fff',
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
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: 32,
    color: '#666',
  },
  form: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
  },
  input: {
    marginBottom: 16,
    backgroundColor: '#fff',
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
    color: '#1976D2',
    marginVertical: 4,
  },
  message: {
    textAlign: 'center',
    marginBottom: 32,
    color: '#333',
    lineHeight: 22,
  },
});
