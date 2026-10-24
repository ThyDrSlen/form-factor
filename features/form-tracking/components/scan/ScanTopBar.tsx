import { View, TouchableOpacity, Text } from 'react-native';
import { styles } from '@/features/form-tracking/styles/_scan-arkit.styles';
import { Ionicons } from '@expo/vector-icons';
import { getWorkoutIds, getWorkoutByMode } from '@/lib/workouts';
import { CameraPermissionBanner } from '@/features/form-tracking/components/CameraPermissionBanner';
import { toIoniconName } from '@/features/form-tracking/hooks/scan/scan-constants';
import type { ScanViewCtx } from '@/features/form-tracking/hooks/scan/scan-view-model';

export function ScanTopBar({ ctx }: { ctx: ScanViewCtx }) {
  const {
    activeWorkoutDef, handleCameraPermissionResume, handleCloseScan, handlePreSetPreviewCheck,
    isDropdownOpen, openWorkoutInsights, setDetectionMode, setIsDropdownOpen,
    setIsSettingsVisible, topBarBottom, topBarOffset,
  } = ctx;
  return (
    <>
      <View style={[styles.topBar, { paddingTop: topBarOffset }]}>
        <View style={styles.topBarContent}>
          <TouchableOpacity
            style={styles.topBarButton}
            onPress={handleCloseScan}
            accessibilityRole="button"
            accessibilityLabel="Close analysis and return to Form"
          >
            <Ionicons name="close" size={24} color="#F5F7FF" />
          </TouchableOpacity>

          <View style={styles.topBarCenter}>
            {/* Mode Selector (Dropdown) */}
            <View style={styles.workoutSelectorContainer}>
              <TouchableOpacity
                style={styles.workoutSelectorButton}
                onPress={() => setIsDropdownOpen(!isDropdownOpen)}
              >
                <Ionicons
                  name={toIoniconName(activeWorkoutDef.ui?.iconName)}
                  size={16}
                  color="#F5F7FF"
                />
                <Text style={styles.workoutSelectorText}>
                  {activeWorkoutDef.displayName}
                </Text>
                <Ionicons name="chevron-down" size={16} color="#F5F7FF" />
              </TouchableOpacity>

              {isDropdownOpen && (
                <View style={styles.dropdownMenu}>
                  {getWorkoutIds()
                    .map((mode) => (
                      <TouchableOpacity
                        key={mode}
                        style={styles.dropdownItem}
                        onPress={() => {
                          setDetectionMode(mode);
                          setIsDropdownOpen(false);
                        }}
                      >
                        <Text style={styles.dropdownItemText}>
                          {getWorkoutByMode(mode).displayName}
                        </Text>
                      </TouchableOpacity>
                    ))}
                </View>
              )}
              <TouchableOpacity
                style={styles.workoutSelectorButton}
                onPress={handlePreSetPreviewCheck}
                accessibilityRole="button"
                accessibilityLabel="Check my stance"
                testID="pre-set-preview-trigger"
              >
                <Ionicons name="sparkles-outline" size={14} color="#F5F7FF" />
                <Text style={styles.workoutSelectorText}>Check my stance</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.topBarActions}>
            <TouchableOpacity
              style={styles.topBarButton}
              onPress={openWorkoutInsights}
              accessibilityRole="button"
              accessibilityLabel="Open workout insights"
            >
              <Ionicons name="analytics-outline" size={18} color="#F5F7FF" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.topBarButton}
              onPress={() => setIsSettingsVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Open settings"
            >
              <Ionicons name="settings-outline" size={20} color="#F5F7FF" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/*
        Camera-permission banner (#542) — renders only when the scan
        surface is mounted without live camera access. Banner self-gates
        via useCameraPermissionGuard and is absolutely positioned so the
        underlying tracking canvas is never obscured by an empty wrapper.
      */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: topBarBottom + 8,
          left: 12,
          right: 12,
          zIndex: 130,
        }}
      >
        <CameraPermissionBanner
          onResume={handleCameraPermissionResume}
          testID="scan-arkit-camera-permission-banner"
        />
      </View>
    </>
  );
}
