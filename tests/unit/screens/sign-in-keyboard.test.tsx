import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Keyboard, TextInput } from 'react-native';
import SignInScreen from '@/app/(auth)/sign-in';
import { useAuth } from '@/features/auth/contexts/AuthContext';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/features/auth/contexts/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const mockUseAuth = jest.mocked(useAuth);
const auth = {
  signInWithEmail: jest.fn(),
  signUpWithEmail: jest.fn(),
  signInWithMagicLink: jest.fn(),
  signInWithGoogle: jest.fn(),
  signInWithApple: jest.fn(),
  clearError: jest.fn(),
  isSigningIn: false,
  error: null,
};

function focusSpy(label: string) {
  const input = screen.UNSAFE_getAllByType(TextInput).find(
    (node) => node.props.accessibilityLabel === label,
  );
  // RN shares its default focus mock across inputs; give each native instance
  // its own spy so the test distinguishes the name field from the password.
  const focus = jest.fn();
  input!.instance.focus = focus;
  return focus;
}

describe('sign-in keyboard interactions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    auth.signInWithEmail.mockResolvedValue({});
    auth.signUpWithEmail.mockResolvedValue({});
    auth.signInWithMagicLink.mockResolvedValue({});
    mockUseAuth.mockReturnValue(auth as unknown as ReturnType<typeof useAuth>);
    jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('moves from email to password without submitting or dismissing the keyboard', () => {
    render(<SignInScreen />);
    const focusPassword = focusSpy('Password');

    fireEvent.changeText(screen.getByLabelText('Email'), 'member@example.com');
    fireEvent(screen.getByLabelText('Email'), 'submitEditing');

    expect(focusPassword).toHaveBeenCalledTimes(1);
    expect(auth.signInWithEmail).not.toHaveBeenCalled();
    expect(Keyboard.dismiss).not.toHaveBeenCalled();
  });

  it('moves through email, full name, and password when creating an account', () => {
    render(<SignInScreen />);
    fireEvent.press(screen.getByText('Sign up'));
    const focusName = focusSpy('Full name');
    const focusPassword = focusSpy('Password');

    fireEvent(screen.getByLabelText('Email'), 'submitEditing');
    expect(focusName).toHaveBeenCalledTimes(1);
    expect(focusPassword).not.toHaveBeenCalled();

    fireEvent(screen.getByLabelText('Full name'), 'submitEditing');
    expect(focusPassword).toHaveBeenCalledTimes(1);
    expect(auth.signUpWithEmail).not.toHaveBeenCalled();
  });

  it('submits the entered credentials from the password keyboard and dismisses it', async () => {
    render(<SignInScreen />);
    fireEvent.changeText(screen.getByLabelText('Email'), 'member@example.com');
    fireEvent.changeText(screen.getByLabelText('Password'), 'example-password');

    await act(async () => {
      fireEvent(screen.getByLabelText('Password'), 'submitEditing');
    });

    expect(auth.signInWithEmail).toHaveBeenCalledWith('member@example.com', 'example-password');
    expect(Keyboard.dismiss).toHaveBeenCalledTimes(1);
  });

  it('keeps the keyboard available when required fields are missing', async () => {
    render(<SignInScreen />);

    await act(async () => {
      fireEvent(screen.getByLabelText('Password'), 'submitEditing');
    });

    expect(screen.getByText('Please fill in all fields')).toBeTruthy();
    expect(auth.signInWithEmail).not.toHaveBeenCalled();
    expect(Keyboard.dismiss).not.toHaveBeenCalled();
  });

  it('focuses the missing full name instead of creating an incomplete account', async () => {
    render(<SignInScreen />);
    fireEvent.press(screen.getByText('Sign up'));
    const focusName = focusSpy('Full name');
    jest.mocked(Keyboard.dismiss).mockClear();
    fireEvent.changeText(screen.getByLabelText('Email'), 'member@example.com');
    fireEvent.changeText(screen.getByLabelText('Password'), 'example-password');

    await act(async () => {
      fireEvent(screen.getByLabelText('Password'), 'submitEditing');
    });

    expect(screen.getByText('Please enter your full name')).toBeTruthy();
    expect(focusName).toHaveBeenCalledTimes(1);
    expect(auth.signUpWithEmail).not.toHaveBeenCalled();
    expect(Keyboard.dismiss).not.toHaveBeenCalled();
  });

  it('sends a magic link from the email keyboard without sending it again after success', async () => {
    render(<SignInScreen />);
    fireEvent.press(screen.getByText('Send magic link instead'));
    fireEvent.changeText(screen.getByLabelText('Email'), 'member@example.com');

    await act(async () => {
      fireEvent(screen.getByLabelText('Email'), 'submitEditing');
    });

    expect(auth.signInWithMagicLink).toHaveBeenCalledWith('member@example.com');
    expect(screen.getByText('Magic link sent! Check your email to sign in.')).toBeTruthy();

    await act(async () => {
      fireEvent(screen.getByLabelText('Email'), 'submitEditing');
    });
    expect(auth.signInWithMagicLink).toHaveBeenCalledTimes(1);
  });

  it('does not submit credentials again while authentication is pending', async () => {
    const { rerender } = render(<SignInScreen />);
    fireEvent.changeText(screen.getByLabelText('Email'), 'member@example.com');
    fireEvent.changeText(screen.getByLabelText('Password'), 'example-password');
    mockUseAuth.mockReturnValue({ ...auth, isSigningIn: true } as unknown as ReturnType<typeof useAuth>);
    rerender(<SignInScreen />);

    await act(async () => {
      fireEvent(screen.getByLabelText('Password'), 'submitEditing');
    });

    expect(auth.signInWithEmail).not.toHaveBeenCalled();
  });
});
