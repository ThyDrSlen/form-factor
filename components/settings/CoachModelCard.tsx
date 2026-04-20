import { StyleSheet, View } from 'react-native';
import { Button, Card, ProgressBar, Text } from 'react-native-paper';
import type { CoachModelStatus } from '@/lib/services/coach-model-manager';

export interface CoachModelCardProps {
  status: CoachModelStatus;
  /** 0..1 when downloading */
  progress?: number;
  errorMessage?: string;
  modelId?: string;
  onStartDownload?: () => void;
  onRetry?: () => void;
  onCancel?: () => void;
}

interface StatusCopy {
  title: string;
  body: string;
  accessibilityLabel: string;
}

function statusCopy(status: CoachModelStatus, modelId?: string, errorMessage?: string): StatusCopy {
  switch (status) {
    case 'none':
      return {
        title: 'On-device coach',
        body: 'Download the Gemma model to run the coach privately on your device.',
        accessibilityLabel: 'On-device coach model not downloaded',
      };
    case 'downloading':
      return {
        title: 'Downloading model…',
        body: 'Keep the app open. You can cancel at any time.',
        accessibilityLabel: 'On-device coach model is downloading',
      };
    case 'ready':
      return {
        title: 'On-device coach ready',
        body: modelId ? `Model: ${modelId}. Coach can run offline.` : 'Coach can run offline.',
        accessibilityLabel: 'On-device coach model is ready',
      };
    case 'error':
      return {
        title: 'Model download failed',
        body: errorMessage || 'Something went wrong. You can try again or stay on the cloud coach.',
        accessibilityLabel: 'On-device coach model error',
      };
  }
}

export function CoachModelCard(props: CoachModelCardProps) {
  const { status, progress, errorMessage, modelId, onStartDownload, onRetry, onCancel } = props;
  const copy = statusCopy(status, modelId, errorMessage);

  return (
    <Card
      mode="outlined"
      style={styles.card}
      accessible
      accessibilityLabel={copy.accessibilityLabel}
      testID="coach-model-card"
    >
      <Card.Title
        title={copy.title}
        subtitle={copy.body}
        subtitleNumberOfLines={3}
      />
      {status === 'downloading' && typeof progress === 'number' && (
        <View style={styles.progressWrap} testID="coach-model-card-progress">
          <ProgressBar progress={Math.max(0, Math.min(1, progress))} />
          <Text variant="labelSmall" style={styles.progressLabel}>
            {Math.round(Math.max(0, Math.min(1, progress)) * 100)}%
          </Text>
        </View>
      )}
      <Card.Actions>
        {status === 'none' && onStartDownload && (
          <Button onPress={onStartDownload} accessibilityLabel="Download coach model" testID="coach-model-card-download">
            Download
          </Button>
        )}
        {status === 'downloading' && onCancel && (
          <Button onPress={onCancel} accessibilityLabel="Cancel coach model download" testID="coach-model-card-cancel">
            Cancel
          </Button>
        )}
        {status === 'error' && onRetry && (
          <Button onPress={onRetry} accessibilityLabel="Retry coach model download" testID="coach-model-card-retry">
            Retry
          </Button>
        )}
      </Card.Actions>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginVertical: 8,
  },
  progressWrap: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 4,
  },
  progressLabel: {
    alignSelf: 'flex-end',
  },
});
