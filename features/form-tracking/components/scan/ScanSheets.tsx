import { Modal } from 'react-native';
import { RecordingReview } from '@/features/form-tracking/components/RecordingReview';
import { PreSetPreviewCard } from '@/features/form-tracking/components/PreSetPreviewCard';
import { ExitMidSessionSheet } from '@/features/form-tracking/components/ExitMidSessionSheet';
import { VoiceCommandFeedback } from '@/features/form-tracking/components/VoiceCommandFeedback';
import { formatBytes } from '@/features/form-tracking/hooks/scan/scan-constants';
import type { ScanViewCtx } from '@/features/form-tracking/hooks/scan/scan-view-model';

export function ScanSheets({ ctx }: { ctx: ScanViewCtx }) {
  const {
    activeWorkoutDef, computeAverageFqi, confirmDiscardRecording, handleExitCancel,
    handleExitDiscard, handleExitSaveSnapshot, handlePreSetPreviewCheck, handlePublishRecording,
    handleSaveOnlyRecording, handleStartSetFromPreview, isExitMidSessionSheetVisible,
    isPreviewVisible, preSetPreview, preSetPreviewVisible, previewDuration, previewError,
    previewFormScore, previewPrimaryDisplay, previewPrimaryLabel, previewQuality, previewReps,
    previewSecondary, recordPreview, repCount, savingRecording, setPreSetPreviewVisible,
    uploading,
  } = ctx;
  return (
    <>
      <Modal
        visible={isPreviewVisible}
        animationType="fade"
        onRequestClose={confirmDiscardRecording}
        statusBarTranslucent
      >
        {isPreviewVisible && recordPreview?.uri ? (
          <RecordingReview
            uri={recordPreview.uri}
            exercise={recordPreview.exercise}
            reps={previewReps}
            score={previewFormScore}
            duration={previewDuration}
            primaryLabel={previewPrimaryLabel}
            primaryValue={previewPrimaryDisplay}
            secondaryLabel={previewSecondary.label}
            secondaryValue={previewSecondary.display}
            quality={previewQuality}
            size={formatBytes(recordPreview.sizeBytes)}
            error={previewError}
            uploading={uploading}
            saving={savingRecording}
            onPublish={handlePublishRecording}
            onSave={handleSaveOnlyRecording}
            onDiscard={confirmDiscardRecording}
          />
        ) : null}
      </Modal>
      <PreSetPreviewCard
        visible={preSetPreviewVisible}
        isChecking={preSetPreview.isChecking}
        verdict={preSetPreview.verdict}
        error={preSetPreview.error}
        exerciseName={activeWorkoutDef.displayName}
        onStartSet={handleStartSetFromPreview}
        onRetry={handlePreSetPreviewCheck}
        onDismiss={() => {
          setPreSetPreviewVisible(false);
          preSetPreview.reset();
        }}
      />
      <ExitMidSessionSheet
        visible={isExitMidSessionSheetVisible}
        exerciseDisplayName={activeWorkoutDef.displayName}
        repCount={repCount}
        currentFqi={computeAverageFqi()}
        onDiscard={handleExitDiscard}
        onSaveSnapshot={handleExitSaveSnapshot}
        onCancel={handleExitCancel}
      />
      <VoiceCommandFeedback />
    </>
  );
}
