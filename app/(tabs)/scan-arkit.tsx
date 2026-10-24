
import { View, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
// Import ARKit module - Metro auto-resolves to .ios.ts or .web.ts
import { BodyTracker } from '@/lib/arkit/ARKitBodyTracker';
import { CrashBoundary } from '@/components/CrashBoundary';
import { ARKitUnsupportedPlaceholder } from '@/features/form-tracking/components/ARKitUnsupportedPlaceholder';
import { styles } from '@/features/form-tracking/styles/_scan-arkit.styles';
import { useScanSessionState } from '@/features/form-tracking/hooks/scan/use-scan-session-state';
import { useScanDiagnostics } from '@/features/form-tracking/hooks/scan/use-scan-diagnostics';
import { useScanWorkoutController } from '@/features/form-tracking/hooks/scan/use-scan-workout-controller';
import { useScanModeAndPlayback } from '@/features/form-tracking/hooks/scan/use-scan-mode-and-playback';
import { useScanPoseFrames } from '@/features/form-tracking/hooks/scan/use-scan-pose-frames';
import { useScanPose2DSmoothing } from '@/features/form-tracking/hooks/scan/use-scan-pose2d-smoothing';
import { useScanTrackingLifecycle } from '@/features/form-tracking/hooks/scan/use-scan-tracking-lifecycle';
import { useScanCuesAndExit } from '@/features/form-tracking/hooks/scan/use-scan-cues-and-exit';
import { useScanWatchMirror } from '@/features/form-tracking/hooks/scan/use-scan-watch-mirror';
import { useScanRecording } from '@/features/form-tracking/hooks/scan/use-scan-recording';
import { useScanActions } from '@/features/form-tracking/hooks/scan/use-scan-actions';
import { buildScanView } from '@/features/form-tracking/hooks/scan/scan-view-model';
import { ScanSupportLoading } from '@/features/form-tracking/components/scan/ScanSupportLoading';
import { ScanTopBar } from '@/features/form-tracking/components/scan/ScanTopBar';
import { ScanTrackingView } from '@/features/form-tracking/components/scan/ScanTrackingView';
import { ScanControls } from '@/features/form-tracking/components/scan/ScanControls';
import { ScanSettingsModal } from '@/features/form-tracking/components/scan/ScanSettingsModal';
import { ScanSheets } from '@/features/form-tracking/components/scan/ScanSheets';

// Each hook adds its outputs to the accumulated context. Order matters: it is
// the original hook and effect order of the screen.
export default function ScanARKitScreen() {
  const s1 = useScanSessionState();
  const s2 = { ...s1, ...useScanDiagnostics(s1) };
  const s3 = { ...s2, ...useScanWorkoutController(s2) };
  const s4 = { ...s3, ...useScanModeAndPlayback(s3) };
  const s5 = { ...s4, ...useScanPoseFrames(s4) };
  const s6 = { ...s5, ...useScanPose2DSmoothing(s5) };
  const s7 = { ...s6, ...useScanTrackingLifecycle(s6) };
  const s8 = { ...s7, ...useScanCuesAndExit(s7) };
  const s9 = { ...s8, ...useScanWatchMirror(s8) };
  const s10 = { ...s9, ...useScanRecording(s9) };
  const s11 = { ...s10, ...useScanActions(s10) };

  const {
    nativeSupported, supportStatus,
  } = s11;

  if (supportStatus === 'unknown') {
    return (
      <SafeAreaView style={styles.container}>
        <ScanSupportLoading ctx={s11} />
      </SafeAreaView>
    );
  }

  if (supportStatus === 'unsupported') {
    // Debug info: Check what BodyTracker reports (only surfaced in __DEV__).
    const nativeDiagnostics = BodyTracker.getSupportDiagnostics();
    const debugInfo = {
      platform: Platform.OS,
      platformVersion: Platform.Version,
      nativeSupported,
      nativeModuleLoaded: BodyTracker.isNativeModuleLoaded(),
      nativeDiagnostics,
      isSupportedResult: nativeDiagnostics?.finalSupported ?? nativeSupported,
    };

    return <ARKitUnsupportedPlaceholder debugInfo={debugInfo} />;
  }

  const view = { ...s11, ...buildScanView(s11) };

  return (
    <CrashBoundary
      fallbackTitle="Camera error"
      fallbackMessage="The body tracking camera encountered a problem. Tap below to restart."
    >
      <View style={styles.container}>
        <ScanTopBar ctx={view} />

        <ScanTrackingView ctx={view} />

        <ScanControls ctx={view} />

        <ScanSettingsModal ctx={view} />

        <ScanSheets ctx={view} />
      </View>
    </CrashBoundary>
  );
}
