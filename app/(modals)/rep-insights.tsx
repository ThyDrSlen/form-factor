/**
 * RepInsightsModal
 *
 * Aggregates all rep-level analytics into a single scrollable modal.
 * Accepts `?exerciseId=` and `?sessionId=` query params:
 *   - When `sessionId` is present, the fault heatmap and rep rewind are
 *     scoped to that session; longitudinal cards still use `exerciseId`.
 *   - When only `exerciseId` is present, all cards show longitudinal views.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { FqiTrendChart } from '@/components/insights/FqiTrendChart';
import { FaultHeatmap } from '@/components/insights/FaultHeatmap';
import { RomProgressionCard } from '@/components/insights/RomProgressionCard';
import { SymmetryCard } from '@/components/insights/SymmetryCard';
import { RepRewindCarousel } from '@/components/insights/RepRewindCarousel';
import { shareRepData } from '@/lib/services/rep-export';
import {
  FormTrackingErrorCode,
  createError,
  withErrorHandling,
} from '@/lib/services/ErrorHandler';
import { useToast } from '@/contexts/ToastContext';
import type { FaultHeatmapScope } from '@/lib/services/rep-analytics';

export default function RepInsightsModal() {
  const router = useRouter();
  const { show: showToast } = useToast();
  const params = useLocalSearchParams<{ exerciseId?: string; sessionId?: string }>();
  const exerciseId = typeof params.exerciseId === 'string' ? params.exerciseId : '';
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : undefined;

  const [exporting, setExporting] = useState<'csv' | 'json' | null>(null);
  // GAP-6: persist the last export error (plus its format) so the UI
  // can render an inline retry banner instead of an Alert that users
  // dismiss without context. `message` keeps the original error text.
  const [exportError, setExportError] = useState<{ format: 'csv' | 'json'; message: string } | null>(null);

  const faultScope = useMemo<FaultHeatmapScope>(
    () => (sessionId ? { sessionId } : { exerciseId, days: 30 }),
    [sessionId, exerciseId],
  );

  const handleExport = useCallback(
    async (format: 'csv' | 'json') => {
      if (!exerciseId && !sessionId) {
        showToast('Open this screen from a session or exercise to enable export.', { type: 'info' });
        return;
      }
      setExporting(format);
      setExportError(null);

      const outcome = await withErrorHandling(
        () => shareRepData(
          sessionId ? { sessionId } : { exerciseId, days: 30 },
          format,
        ),
        (err) => createError(
          'form-tracking',
          FormTrackingErrorCode.EXPORT_FAILED,
          err instanceof Error ? err.message : 'Unknown export error',
          { details: err, retryable: true },
        ),
        { feature: 'form-tracking', location: `rep-insights.handleExport.${format}` },
      );

      setExporting(null);

      if (!outcome.ok) {
        setExportError({ format, message: outcome.error.message });
        showToast(`Export failed: ${outcome.error.message}`, { type: 'error' });
        return;
      }

      const result = outcome.data;
      if (!result.shared) {
        showToast(
          result.fileUri
            ? 'Export ready — sharing unavailable; file written locally.'
            : 'Sharing is unavailable on this build.',
          { type: 'info' },
        );
      }
    },
    [exerciseId, sessionId, showToast],
  );

  const handleDismissExportError = useCallback(() => {
    setExportError(null);
  }, []);

  const handleRetryExport = useCallback(() => {
    if (!exportError) return;
    void handleExport(exportError.format);
  }, [exportError, handleExport]);

  if (!exerciseId && !sessionId) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={22} color="#F5F7FF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Rep Insights</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centerState}>
          <Ionicons name="analytics-outline" size={42} color="#6781A6" />
          <Text style={styles.stateTitle}>Choose an exercise</Text>
          <Text style={styles.stateText}>
            Open this screen from an exercise detail or completed session to see its analytics.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="arrow-back" size={22} color="#F5F7FF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Rep Insights</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        showsVerticalScrollIndicator={false}
      >
        {exerciseId ? (
          <FqiTrendChart exerciseId={exerciseId} />
        ) : (
          <View style={styles.inlineNote}>
            <Text style={styles.inlineNoteText}>FQI trend requires an exercise scope.</Text>
          </View>
        )}

        <FaultHeatmap scope={faultScope} />

        {exerciseId && <RomProgressionCard exerciseId={exerciseId} />}
        {exerciseId && <SymmetryCard exerciseId={exerciseId} />}

        <RepRewindCarousel sessionId={sessionId} exerciseId={exerciseId || undefined} />

        <View style={styles.exportCard}>
          <Text style={styles.exportTitle}>Export rep data</Text>
          <Text style={styles.exportSubtitle}>
            Share your rep telemetry with a coach or import into a spreadsheet.
          </Text>
          {exportError ? (
            <View style={styles.exportErrorBanner} testID="rep-export-error-banner">
              <View style={styles.exportErrorHeader}>
                <Ionicons name="alert-circle" size={18} color="#EF4444" />
                <Text style={styles.exportErrorTitle}>
                  {exportError.format.toUpperCase()} export failed
                </Text>
              </View>
              <Text
                style={styles.exportErrorMessage}
                numberOfLines={3}
                accessibilityLabel={`Export error: ${exportError.message}`}
                testID="rep-export-error-message"
              >
                {exportError.message}
              </Text>
              <View style={styles.exportErrorRow}>
                <TouchableOpacity
                  style={styles.exportRetryButton}
                  onPress={handleRetryExport}
                  accessibilityRole="button"
                  accessibilityLabel="Retry export"
                  testID="rep-export-retry-button"
                >
                  <Ionicons name="refresh" size={14} color="#F5F7FF" />
                  <Text style={styles.exportRetryText}>Retry</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.exportDismissButton}
                  onPress={handleDismissExportError}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss export error"
                  testID="rep-export-dismiss-button"
                >
                  <Text style={styles.exportDismissText}>Dismiss</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
          <View style={styles.exportRow}>
            <TouchableOpacity
              style={[styles.exportButton, exporting !== null && styles.exportButtonDisabled]}
              disabled={exporting !== null}
              onPress={() => handleExport('csv')}
              accessibilityRole="button"
              accessibilityLabel="Export as CSV"
            >
              {exporting === 'csv' ? (
                <ActivityIndicator color="#F5F7FF" size="small" />
              ) : (
                <>
                  <Ionicons name="document-text-outline" size={16} color="#F5F7FF" />
                  <Text style={styles.exportButtonText}>CSV</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.exportButtonGhost, exporting !== null && styles.exportButtonDisabled]}
              disabled={exporting !== null}
              onPress={() => handleExport('json')}
              accessibilityRole="button"
              accessibilityLabel="Export as JSON"
            >
              {exporting === 'json' ? (
                <ActivityIndicator color="#DCE5F5" size="small" />
              ) : (
                <>
                  <Ionicons name="code-slash-outline" size={16} color="#DCE5F5" />
                  <Text style={styles.exportButtonGhostText}>JSON</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1626',
  },
  header: {
    paddingTop: 58,
    paddingHorizontal: 16,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(154, 172, 209, 0.18)',
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(76, 140, 255, 0.2)',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 19,
    fontWeight: '700',
    color: '#F5F7FF',
    marginRight: 34,
  },
  headerSpacer: {
    width: 0,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    padding: 16,
    gap: 12,
    paddingBottom: 40,
  },
  centerState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 24,
  },
  stateTitle: {
    color: '#F5F7FF',
    fontSize: 18,
    fontWeight: '700',
  },
  stateText: {
    color: '#9AACD1',
    textAlign: 'center',
    lineHeight: 20,
  },
  inlineNote: {
    backgroundColor: '#12243A',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.16)',
  },
  inlineNoteText: {
    color: '#9AACD1',
    fontSize: 12,
    textAlign: 'center',
  },
  exportCard: {
    backgroundColor: '#12243A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.16)',
    padding: 14,
  },
  exportTitle: {
    color: '#F5F7FF',
    fontSize: 16,
    fontWeight: '700',
  },
  exportSubtitle: {
    color: '#9AACD1',
    marginTop: 4,
    marginBottom: 12,
    fontSize: 12,
  },
  exportRow: {
    flexDirection: 'row',
    gap: 10,
  },
  exportButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#4C8CFF',
    borderRadius: 12,
    paddingVertical: 10,
  },
  exportButtonText: {
    color: '#F5F7FF',
    fontSize: 13,
    fontWeight: '700',
  },
  exportButtonGhost: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#0F2339',
    borderRadius: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.2)',
  },
  exportButtonGhostText: {
    color: '#DCE5F5',
    fontSize: 13,
    fontWeight: '700',
  },
  exportButtonDisabled: {
    opacity: 0.5,
  },
  exportErrorBanner: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  exportErrorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  exportErrorTitle: {
    color: '#F5F7FF',
    fontSize: 13,
    fontWeight: '700',
  },
  exportErrorMessage: {
    color: '#DCE5F5',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  exportErrorRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
  },
  exportRetryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#4C8CFF',
  },
  exportRetryText: {
    color: '#F5F7FF',
    fontSize: 12,
    fontWeight: '700',
  },
  exportDismissButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.3)',
    backgroundColor: 'transparent',
  },
  exportDismissText: {
    color: '#9AACD1',
    fontSize: 12,
    fontWeight: '600',
  },
});
