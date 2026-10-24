import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
// NativeWind skips component registration under NODE_ENV=test. Register the
// real native wrappers so this regression exercises the device's style path.
import 'react-native-css-interop/dist/runtime/components';
import { SocialSignInButtons } from '@/features/auth/components/SocialSignInButtons';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('@/lib/platform-utils', () => ({ isIOS: () => true }));

it('keeps Google contrast and horizontal button layout through native CSS interop', () => {
  const { getByRole, getByText } = render(<SocialSignInButtons disabled={false} onPress={jest.fn()} />);
  const google = getByRole('button', { name: 'Sign in with Google' });
  expect(StyleSheet.flatten(google.props.style)).toMatchObject({
    backgroundColor: '#FFFFFF', flexDirection: 'row', minHeight: 54,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  });
  expect(StyleSheet.flatten(getByText('Continue with Google').props.style).color).toBe('#1F1F1F');
});

it('keeps Apple contrast and horizontal button layout through native CSS interop', () => {
  const { getByRole, getByText } = render(<SocialSignInButtons disabled={false} onPress={jest.fn()} />);
  expect(StyleSheet.flatten(getByRole('button', { name: 'Sign in with Apple' }).props.style)).toMatchObject({
    backgroundColor: '#000000', flexDirection: 'row', minHeight: 54,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  });
  expect(StyleSheet.flatten(getByText('Continue with Apple').props.style).color).toBe('#FFFFFF');
});

it.each(['Google', 'Apple'] as const)('%s preserves its container while pressed, disabled and re-enabled', (provider) => {
  const onPress = jest.fn();
  const { getByRole, rerender } = render(<SocialSignInButtons disabled={false} onPress={onPress} />);
  const button = () => getByRole('button', { name: `Sign in with ${provider}` });
  const backgroundColor = provider === 'Google' ? '#FFFFFF' : '#000000';
  // Check the callback delivered to RN itself, after JSX interop. A host-level
  // fireEvent('pressIn') does not drive RN's internal Pressability state machine.
  let nativeButton = button().parent;
  while (nativeButton && typeof nativeButton.props.style !== 'function') nativeButton = nativeButton.parent;
  expect(nativeButton).not.toBeNull();
  expect(StyleSheet.flatten(nativeButton!.props.style({ pressed: true }))).toMatchObject({ backgroundColor, flexDirection: 'row', opacity: 0.6 });
  expect(StyleSheet.flatten(nativeButton!.props.style({ pressed: false })).opacity).toBeUndefined();
  fireEvent.press(button());
  expect(onPress).toHaveBeenCalledWith(provider.toLowerCase());
  onPress.mockClear();
  rerender(<SocialSignInButtons disabled onPress={onPress} />);
  expect(button()).toBeDisabled();
  expect(button().props.accessibilityState).toMatchObject({ disabled: true, busy: true });
  expect(StyleSheet.flatten(button().props.style)).toMatchObject({ backgroundColor, flexDirection: 'row', opacity: 0.6 });
  fireEvent.press(button());
  expect(onPress).not.toHaveBeenCalled();
  rerender(<SocialSignInButtons disabled={false} onPress={onPress} />);
  expect(button()).toBeEnabled();
  expect(StyleSheet.flatten(button().props.style)).toMatchObject({ backgroundColor, flexDirection: 'row' });
  expect(StyleSheet.flatten(button().props.style).opacity).toBeUndefined();
});
