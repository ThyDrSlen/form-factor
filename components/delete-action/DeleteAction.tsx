import React from 'react';
import { Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

export interface DeleteActionProps {
  id: string;
  onDelete: (id: string) => void | Promise<void>;
  label?: string;
  confirmTitle?: string;
  confirmMessage?: string;
  size?: 'small' | 'medium';
  variant?: 'icon' | 'button';
  style?: object;
}

export function DeleteAction({
  id,
  onDelete,
  label = 'Delete',
  confirmTitle = 'Delete item?',
  confirmMessage = 'This action cannot be undone.',
  size = 'medium',
  variant = 'button',
  style,
}: DeleteActionProps) {
  function handleConfirm() {
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }

    Alert.alert(
      confirmTitle,
      confirmMessage,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await onDelete(id);
              if (Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
            } catch {
              // No-op; upstream can handle errors via toasts/logs
            }
          },
        },
      ]
    );
  }

  const content = (
    <View style={styles.contentRow}>
      <Ionicons name="trash-outline" size={size === 'small' ? 16 : 18} color="#FF3B30" />
      {variant === 'button' && (
        <Text style={[styles.label, size === 'small' ? styles.labelSmall : styles.labelMedium]}>{label}</Text>
      )}
    </View>
  );

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={handleConfirm}
      style={[variant === 'button' ? styles.button : styles.iconOnly, style]}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      testID={`delete-action-${id}`}
    >
      {content}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  contentRow: { flexDirection: 'row', alignItems: 'center' },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 12 },
  iconOnly: { padding: 4 },
  label: { marginLeft: 6, color: '#FF3B30', fontWeight: '600' },
  labelSmall: { fontSize: 12 },
  labelMedium: { fontSize: 14 },
});
