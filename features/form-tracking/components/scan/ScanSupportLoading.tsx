import { View, Text, Modal, ActivityIndicator } from 'react-native';
import { styles } from '@/features/form-tracking/styles/_scan-arkit.styles';
import type { ScanActionsCtx } from '@/features/form-tracking/hooks/scan/use-scan-actions';

export function ScanSupportLoading({ ctx }: { ctx: ScanActionsCtx }) {
  const {
    isPoseModelLoading, setIsPoseModelLoading,
  } = ctx;
  return (
    <>
      <View
        style={styles.loaderContainer}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Loading body tracking"
        accessibilityState={{ busy: true }}
        testID="scan-arkit-loader"
      >
        <View style={styles.loaderCard} accessibilityElementsHidden>
          <View style={styles.loaderLineShort} />
          <View style={styles.loaderLine} />
          <View style={styles.loaderLine} />
        </View>
        <View style={styles.loaderCard} accessibilityElementsHidden>
          <View style={styles.loaderLineShort} />
          <View style={styles.loaderLine} />
          <View style={styles.loaderLine} />
        </View>
        <Text style={styles.loaderCaption} accessibilityElementsHidden>
          Initializing form tracking…
        </Text>
      </View>
      {/*
       * Pose-model loading modal (#551).
       *
       * On iOS the MediaPipe pose-landmarker lite model has to be
       * resolved from the bundled asset (and occasionally re-downloaded
       * on first run). We surface the progress via an indeterminate
       * modal so users know the screen hasn't hung. Dismisses
       * automatically once supportStatus resolves or the asset download
       * effect completes (see setIsPoseModelLoading(false) calls above).
       */}
      <Modal
        visible={isPoseModelLoading}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {
          // User-initiated close: clear the flag so the modal goes away.
          // If tracking still needs the model, subsequent frames will
          // degrade gracefully to the proxy provider + surface the
          // existing "Pose tracking degraded" toast.
          setIsPoseModelLoading(false);
        }}
      >
        <View style={styles.poseModelModalBackdrop}>
          <View
            style={styles.poseModelModalCard}
            accessible
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            accessibilityLabel="Downloading pose model"
            testID="scan-arkit-pose-model-loading-modal"
          >
            <ActivityIndicator size="large" color="#4C8CFF" />
            <Text style={styles.poseModelModalTitle}>
              Downloading pose model…
            </Text>
            <Text style={styles.poseModelModalSubtitle}>
              One-time setup on this device.
            </Text>
          </View>
        </View>
      </Modal>
    </>
  );
}
