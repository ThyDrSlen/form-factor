/**
 * SetNotesModal
 *
 * Small modal for tap-to-edit set notes.
 */

import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { colors } from '@/styles/workout-session.styles';

interface SetNotesModalProps {
  visible: boolean;
  notes: string;
  onSave: (notes: string) => void;
  onClose: () => void;
}

export default function SetNotesModal({ visible, notes, onSave, onClose }: SetNotesModalProps) {
  const [value, setValue] = useState(notes);

  useEffect(() => {
    if (visible) setValue(notes);
  }, [visible, notes]);

  const handleSave = () => {
    onSave(value);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={modalStyles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={modalStyles.center}
        >
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
            <View style={modalStyles.card}>
              <Text style={modalStyles.title}>Set notes</Text>
              <TextInput
                style={modalStyles.input}
                value={value}
                onChangeText={setValue}
                placeholder="Add notes..."
                placeholderTextColor={colors.textSecondary}
                multiline
                numberOfLines={3}
                autoFocus
              />
              <View style={modalStyles.actions}>
                <TouchableOpacity style={modalStyles.cancelBtn} onPress={onClose}>
                  <Text style={modalStyles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={modalStyles.saveBtn} onPress={handleSave}>
                  <Text style={modalStyles.saveText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </TouchableOpacity>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  center: {
    justifyContent: 'center',
  },
  card: {
    backgroundColor: colors.cardSurface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  title: {
    fontSize: 16,
    fontFamily: 'Lexend_600SemiBold',
    color: colors.textPrimary,
    marginBottom: 12,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    fontFamily: 'Lexend_400Regular',
    color: colors.textPrimary,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 16,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  cancelText: {
    fontSize: 15,
    fontFamily: 'Lexend_500Medium',
    color: colors.textSecondary,
  },
  saveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: colors.accent,
    borderRadius: 10,
  },
  saveText: {
    fontSize: 15,
    fontFamily: 'Lexend_600SemiBold',
    color: '#fff',
  },
});
