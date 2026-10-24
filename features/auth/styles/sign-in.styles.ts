import { StyleSheet } from 'react-native';
import { theme } from '@/styles/theme';
import { authFonts as font } from './auth-fonts';

const { colors, radius } = theme;

export const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  keyboardView: { flex: 1 },
  scrollView: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 24, paddingBottom: 32, width: '100%', maxWidth: 480, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 36 },
  headerTitle: { fontFamily: font.bold, fontSize: 13, letterSpacing: 2.2, color: colors.text },
  card: { width: '100%' },
  welcomeTitle: { fontFamily: font.bold, fontSize: 34, letterSpacing: -1.2, color: colors.text, marginBottom: 10 },
  subtitle: { fontFamily: font.regular, fontSize: 15, lineHeight: 23, color: colors.secondary, marginBottom: 28 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 14, marginVertical: 26 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.secondary, fontSize: 12, fontFamily: font.regular },
  errorContainer: { backgroundColor: '#2A1C21', borderRadius: radius.input, padding: 14, marginBottom: 20 },
  errorText: { fontFamily: font.regular, fontSize: 13, lineHeight: 20, color: colors.danger },
  inputContainer: { marginBottom: 18 },
  inputLabel: { fontFamily: font.medium, fontSize: 13, color: colors.secondary, marginBottom: 8 },
  input: { fontFamily: font.regular, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.input, paddingHorizontal: 16, paddingVertical: 16, fontSize: 16, color: colors.text, minHeight: 54 },
  inputError: { borderColor: colors.danger },
  fieldErrorText: { fontFamily: font.regular, marginTop: 6, fontSize: 12, lineHeight: 18, color: colors.danger },
  loginButton: { backgroundColor: colors.accent, marginTop: 4, marginBottom: 20, borderRadius: radius.button, paddingVertical: 16, minHeight: 54, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontFamily: font.bold, fontSize: 16, color: colors.onAccent },
  buttonDisabled: { opacity: 0.5 },
  signUpContainer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', marginBottom: 14 },
  signUpLink: { fontFamily: font.medium, fontSize: 14, color: colors.accentText, paddingVertical: 12 },
  signUpText: { fontFamily: font.regular, fontSize: 14, color: colors.secondary },
  magicLinkToggle: { paddingVertical: 14, marginBottom: 4 },
  magicLinkToggleText: { fontFamily: font.medium, fontSize: 13, color: colors.secondary, textAlign: 'center' },
  successContainer: { backgroundColor: '#172C26', borderRadius: radius.input, padding: 14, marginBottom: 18 },
  successText: { fontFamily: font.regular, fontSize: 14, lineHeight: 21, color: colors.success },
});
