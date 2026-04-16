import React from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { PreSetPreviewResult } from '@/lib/services/pre-set-preview';

export interface PreSetPreviewCardProps {
  visible: boolean;
  isChecking: boolean;
  verdict: PreSetPreviewResult | null;
  error: Error | null;
  exerciseName: string;
  onStartSet?: () => void;
  onDismiss: () => void;
  onRetry?: () => void;
}

export function PreSetPreviewCard({
  visible,
  isChecking,
  verdict,
  error,
  exerciseName,
  onStartSet,
  onDismiss,
  onRetry,
}: PreSetPreviewCardProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View style={styles.backdrop} testID="pre-set-preview-backdrop">
        <View style={styles.card} testID="pre-set-preview-card">
          <Text style={styles.title}>Stance check</Text>
          <Text style={styles.subtitle}>{exerciseName}</Text>

          {isChecking && (
            <View style={styles.bodyRow} testID="pre-set-preview-loading">
              <ActivityIndicator color="#4C8CFF" />
              <Text style={styles.bodyText}>Checking your stance…</Text>
            </View>
          )}

          {!isChecking && verdict && (
            <View
              style={[
                styles.verdictBlock,
                verdict.isFormGood ? styles.verdictGood : styles.verdictWarn,
              ]}
              testID="pre-set-preview-verdict"
            >
              <Text style={styles.verdictText}>{verdict.verdict}</Text>
              <Text style={styles.providerTag}>
                via {verdict.provider === 'gemma' ? 'Gemma (on-device)' : 'OpenAI'}
              </Text>
            </View>
          )}

          {!isChecking && error && (
            <View style={styles.errorBlock} testID="pre-set-preview-error">
              <Text style={styles.errorText}>
                Could not check stance: {error.message}
              </Text>
            </View>
          )}

          <View style={styles.actions}>
            {!isChecking && error && onRetry && (
              <TouchableOpacity
                style={[styles.actionButton, styles.actionSecondary]}
                onPress={onRetry}
                accessibilityRole="button"
                accessibilityLabel="Retry stance check"
                testID="pre-set-preview-retry"
              >
                <Text style={styles.actionSecondaryText}>Retry</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.actionButton, styles.actionSecondary]}
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel="Dismiss stance check"
              testID="pre-set-preview-dismiss"
            >
              <Text style={styles.actionSecondaryText}>Dismiss</Text>
            </TouchableOpacity>
            {!isChecking && verdict?.isFormGood && onStartSet && (
              <TouchableOpacity
                style={[styles.actionButton, styles.actionPrimary]}
                onPress={onStartSet}
                accessibilityRole="button"
                accessibilityLabel="Start set"
                testID="pre-set-preview-start-set"
              >
                <Text style={styles.actionPrimaryText}>Start Set</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 12, 24, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#141B2D',
    borderRadius: 18,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  title: {
    color: '#F5F7FF',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 2,
  },
  subtitle: {
    color: '#97A3C2',
    fontSize: 13,
    marginBottom: 16,
    textTransform: 'capitalize',
  },
  bodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  bodyText: {
    color: '#F5F7FF',
    fontSize: 14,
  },
  verdictBlock: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  verdictGood: {
    backgroundColor: 'rgba(60, 200, 169, 0.18)',
    borderColor: '#3CC8A9',
    borderWidth: 1,
  },
  verdictWarn: {
    backgroundColor: 'rgba(255, 184, 76, 0.18)',
    borderColor: '#FFB84C',
    borderWidth: 1,
  },
  verdictText: {
    color: '#F5F7FF',
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 4,
  },
  providerTag: {
    color: '#97A3C2',
    fontSize: 11,
  },
  errorBlock: {
    backgroundColor: 'rgba(255, 92, 92, 0.18)',
    borderColor: '#FF5C5C',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  errorText: {
    color: '#F5F7FF',
    fontSize: 13,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    flexWrap: 'wrap',
  },
  actionButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  actionSecondary: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  actionSecondaryText: {
    color: '#F5F7FF',
    fontSize: 14,
    fontWeight: '500',
  },
  actionPrimary: {
    backgroundColor: '#4C8CFF',
  },
  actionPrimaryText: {
    color: '#0B0F1C',
    fontSize: 14,
    fontWeight: '700',
  },
});
