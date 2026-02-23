import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type LogoutConfirmDialogProps = {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export default function LogoutConfirmDialog({
  visible,
  onCancel,
  onConfirm,
}: LogoutConfirmDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Close sign out dialog"
          activeOpacity={1}
          onPress={onCancel}
          style={styles.backdrop}
        />
        <View style={styles.card}>
          <Text style={styles.title}>Sign Out</Text>
          <Text style={styles.message}>
            Are you sure you want to sign out? Your local progress is preserved and will sync next time you sign in.
          </Text>
          <View style={styles.actions}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Cancel sign out"
              onPress={onCancel}
              style={[styles.button, styles.secondaryButton]}
            >
              <Text style={[styles.buttonText, styles.secondaryButtonText]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Confirm sign out"
              onPress={() => {
                void onConfirm();
              }}
              style={[styles.button, styles.destructiveButton]}
            >
              <Text style={[styles.buttonText, styles.destructiveButtonText]}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(3, 9, 20, 0.72)',
  },
  card: {
    backgroundColor: '#0F2339',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#213A59',
    padding: 20,
    gap: 14,
  },
  title: {
    color: '#F5F8FF',
    fontFamily: 'Lexend_700Bold',
    fontSize: 18,
  },
  message: {
    color: '#A8B7D4',
    fontFamily: 'Lexend_400Regular',
    fontSize: 14,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  button: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 96,
    alignItems: 'center',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#35557A',
    backgroundColor: 'rgba(53, 85, 122, 0.16)',
  },
  destructiveButton: {
    backgroundColor: '#FF5B5B',
  },
  buttonText: {
    fontFamily: 'Lexend_500Medium',
    fontSize: 14,
  },
  secondaryButtonText: {
    color: '#E2ECFF',
  },
  destructiveButtonText: {
    color: '#0D1728',
  },
});
