/**
 * Apple HIG Design System - Button Component
 * Button component following Apple's button styles with haptic feedback
 */

import * as React from 'react';
import {
    Platform,
    TextStyle,
    TouchableOpacity,
    TouchableOpacityProps,
    ViewStyle,
} from 'react-native';
import { useTheme } from '../ThemeProvider';
import { createButtonStyle } from '../utils';
import { Text } from './Text';

import * as Haptics from 'expo-haptics';

interface ButtonProps extends Omit<TouchableOpacityProps, 'style'> {
  title: string;
  variant?: 'primary' | 'secondary' | 'destructive';
  size?: 'small' | 'medium' | 'large';
  fullWidth?: boolean;
  loading?: boolean;
  hapticFeedback?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  variant = 'primary',
  size = 'medium',
  fullWidth = false,
  loading = false,
  hapticFeedback = true,
  disabled,
  onPress,
  style,
  textStyle,
  ...props
}) => {
  const { theme, isReduceMotionEnabled } = useTheme();

  const handlePress = (event: any) => {
    if (disabled || loading) return;

    // Provide haptic feedback on iOS
    if (hapticFeedback && Platform.OS === 'ios') {
      const feedbackType = variant === 'destructive' 
        ? Haptics.NotificationFeedbackType.Warning 
        : Haptics.ImpactFeedbackStyle.Light;
      
      if (variant === 'destructive') {
        Haptics.notificationAsync(feedbackType as Haptics.NotificationFeedbackType);
      } else {
        Haptics.impactAsync(feedbackType as Haptics.ImpactFeedbackStyle);
      }
    }

    onPress?.(event);
  };

  const buttonStyle = createButtonStyle(theme, variant, size);
  
  const combinedStyle: ViewStyle = {
    ...buttonStyle,
    ...(fullWidth && { width: '100%' }),
    ...(disabled && { opacity: 0.6 }),
    ...(loading && { opacity: 0.8 }),
    ...style,
  };

  const getTextColor = () => {
    if (variant === 'primary' || variant === 'destructive') {
      return '#FFFFFF';
    }
    return theme.colors.label;
  };

  const getTextVariant = () => {
    switch (size) {
      case 'small':
        return 'footnote' as const;
      case 'large':
        return 'headline' as const;
      default:
        return 'body' as const;
    }
  };

  return (
    <TouchableOpacity
      style={combinedStyle}
      onPress={handlePress}
      disabled={disabled || loading}
      activeOpacity={0.7}
      {...props}
    >
      <Text
        variant={getTextVariant()}
        color={getTextColor()}
        weight="semibold"
        style={textStyle}
      >
        {loading ? 'Loading...' : title}
      </Text>
    </TouchableOpacity>
  );
};