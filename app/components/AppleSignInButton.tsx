import { AppleAuthenticationButton, AppleAuthenticationButtonStyle, AppleAuthenticationButtonType } from 'expo-apple-authentication';
import { StyleSheet, View } from 'react-native';
import { signInWithApple } from '../../lib/auth-utils';

type AppleSignInButtonProps = {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
};

function AppleSignInButton({ onSuccess, onError }: AppleSignInButtonProps) {
  const handlePress = async () => {
    try {
      await signInWithApple();
      onSuccess?.();
    } catch (error) {
      console.error('Apple Sign In Error:', error);
      onError?.(error as Error);
    }
  };

  return (
    <View style={styles.container}>
      <AppleAuthenticationButton
        buttonType={AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={8}
        style={styles.button}
        onPress={handlePress}
      />
    </View>
  );
}

export default AppleSignInButton;

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: 44,
    marginVertical: 10,
  },
  button: {
    width: '100%',
    height: '100%',
  },
});
