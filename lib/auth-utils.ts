import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import { supabase } from './supabase'; // We'll create this next

// Generate a secure random string for the nonce
const generateNonce = async (length: number = 32): Promise<string> => {
  const randomBytes = await Crypto.getRandomBytesAsync(length);
  return Array.from(randomBytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

// Sign in with Apple
export const signInWithApple = async () => {
  try {
    // Generate a secure nonce
    const rawNonce = await generateNonce();
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce
    )

    // Start the sign-in request
    const appleCredential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
      state: rawNonce, // Store the raw nonce in state to verify later
    });

    // Send the credential to your backend for verification
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: appleCredential.identityToken!,
      nonce: rawNonce, // Send the raw nonce for verification
    });

    if (error) throw error;
    return data;
  } catch (error: any) {
    if (error.code === 'ERR_CANCELED') {
      // Handle cancelation
      console.log('Sign in with Apple was canceled');
    } else {
      console.error('Error signing in with Apple:', error);
      throw error;
    }
  }
};

// Sign out from Apple
export const signOutFromApple = async () => {
  try {
    // Sign out from Supabase
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    
    // Also sign out from Apple if needed
    try {
      await AppleAuthentication.signOutAsync({
        user: 'currentUser',
      });
    } catch (appleError) {
      // Handle Apple sign out error
      console.error('Error signing out from Apple:', appleError);
    }
  } catch (error) {
    console.error('Error signing out:', error);
    throw error;
  }
};
