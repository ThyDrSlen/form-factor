import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, TouchableOpacity } from 'react-native';
import { Text, TextInput, Button } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { useState } from 'react';

export default function SignUpScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const { signUpWithEmail } = useAuth();
  const router = useRouter();

  const handleSignUp = async () => {
    try {
      setLoading(true);
      const { error } = await signUpWithEmail(email, password, { fullName });
      if (error) throw error;
      // On successful sign-up, the auth state will change and the user will be redirected
    } catch (error) {
      console.error('Sign up error:', error);
      // Handle error (show error message to user)
    } finally {
      setLoading(false);
    }
  };

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
            <Text variant="headlineMedium" style={styles.title}>Create Account</Text>
            <Text variant="bodyMedium" style={styles.subtitle}>Sign up to get started</Text>
            
            <View style={styles.form}>
              <TextInput
                label="Full Name"
                value={fullName}
                onChangeText={setFullName}
                autoCapitalize="words"
                style={styles.input}
                mode="outlined"
              />
              
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
              
              <TextInput
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                style={styles.input}
                mode="outlined"
              />
              
              <Button 
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
                  onPress={() => router.push('/auth/sign-in')}
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
    marginBottom: 8,
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
});
