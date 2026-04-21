import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { FormMesocycleCard } from '@/components/form-journey/FormMesocycleCard';
import { useFormMesocycle } from '@/hooks/use-form-mesocycle';
import type {
  MesocycleFaultCount,
  MesocycleWeekBucket,
} from '@/lib/services/form-mesocycle-aggregator';
import {
  buildMesocycleAnalystPrompt,
  requestMesocycleAnalysis,
  type MesocycleAnalystResult,
  type SendCoachPromptFn,
} from '@/lib/services/coach-mesocycle-analyst';
import { sendCoachPrompt } from '@/lib/services/coach-service';

/**
 * Adapter between the coach-service positional API
 * (`sendCoachPrompt(messages, context)`) and the analyst's
 * options-object contract (`{ messages, context }`).
 *
 * Kept local to the modal so `coach-mesocycle-analyst.ts` stays adapter-agnostic
 * and unit-testable without pulling the real coach-service.
 */
const sendCoachPromptAdapter: SendCoachPromptFn = async ({ messages, context }) => {
  const result = await sendCoachPrompt(messages, context);
  if (!result) return null;
  return {
    message: { role: result.role, content: result.content },
    provider: result.provider,
  };
};

export default function FormMesocycleModal() {
  const router = useRouter();
  const { loading, error, insights, refresh } = useFormMesocycle();
  const [analystResult, setAnalystResult] = useState<MesocycleAnalystResult | null>(
    null,
  );
  const [analystLoading, setAnalystLoading] = useState(false);
  const [analystError, setAnalystError] = useState<string | null>(null);
  const [analystExpanded, setAnalystExpanded] = useState(true);

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  const handleAnalyze = useCallback(async () => {
    if (!insights || analystLoading) return;
    setAnalystLoading(true);
    setAnalystError(null);
    try {
      const result = await requestMesocycleAnalysis(insights, sendCoachPromptAdapter);
      setAnalystResult(result);
      setAnalystExpanded(true);
      if (!result) {
        setAnalystError('Coach returned no response. Try again in a moment.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAnalystError(msg);
    } finally {
      setAnalystLoading(false);
    }
  }, [insights, analystLoading]);

  const handleContinueInChat = useCallback(() => {
    if (!insights) return;
    const prompt = buildMesocycleAnalystPrompt(insights);
    const url =
      `/(tabs)/coach?prefill=${encodeURIComponent(prompt)}` +
      `&focus=mesocycle-analyst`;
    router.push(url as Parameters<typeof router.push>[0]);
  }, [insights, router]);

  const handleToggleAnalystExpanded = useCallback(() => {
    setAnalystExpanded((prev) => !prev);
  }, []);

  const weekRows = useMemo(() => insights?.weeks ?? [], [insights]);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={loading}
          onRefresh={refresh}
          tintColor="#8FA2B8"
        />
      }
      testID="form-mesocycle-modal"
    >
      <View style={styles.header}>
        <Text style={styles.title}>Form journey</Text>
        <Pressable
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close form journey"
          hitSlop={12}
          testID="form-mesocycle-close"
        >
          <Ionicons name="close" size={24} color="#E1E8EF" />
        </Pressable>
      </View>

      {error ? (
        <View style={styles.errorBox} testID="form-mesocycle-error">
          <Ionicons name="alert-circle" size={20} color="#FF6B6B" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <FormMesocycleCard
        insights={insights}
        loading={loading}
        onAskCoach={insights && !insights.isEmpty ? handleAnalyze : undefined}
      />

      {loading && !insights ? (
        <ActivityIndicator color="#4C8CFF" style={styles.loader} />
      ) : null}

      {insights && !insights.isEmpty ? (
        <AnalystSection
          result={analystResult}
          loading={analystLoading}
          errorMessage={analystError}
          expanded={analystExpanded}
          onToggleExpanded={handleToggleAnalystExpanded}
          onRetry={handleAnalyze}
          onContinueInChat={handleContinueInChat}
        />
      ) : null}

      {insights && !insights.isEmpty ? (
        <>
          <Section title="Weekly breakdown">
            {weekRows.map((week) => (
              <WeekRow key={week.weekStartIso} week={week} />
            ))}
          </Section>

          {insights.topFaults.length > 0 ? (
            <Section title="Recurring faults">
              {insights.topFaults.map((fault) => (
                <FaultRow key={fault.fault} fault={fault} />
              ))}
            </Section>
          ) : null}

          <Section title="Deload read">
            <Text style={styles.bodyText}>
              {insights.deload.reason ??
                'Steady progress. FQI is holding or improving and fault rate is stable.'}
            </Text>
            {insights.deload.fqiDelta != null ? (
              <Text style={styles.metaText} testID="form-mesocycle-fqi-delta">
                FQI last-week vs prior: {formatDelta(insights.deload.fqiDelta)}
              </Text>
            ) : null}
            {insights.deload.faultDelta != null ? (
              <Text style={styles.metaText} testID="form-mesocycle-fault-delta">
                Fault rate change: {formatPct(insights.deload.faultDelta)}
              </Text>
            ) : null}
          </Section>
        </>
      ) : null}
    </ScrollView>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function WeekRow({ week }: { week: MesocycleWeekBucket }) {
  return (
    <View style={styles.weekRow} testID={`form-mesocycle-week-${week.weekIndex}`}>
      <View style={styles.weekLabelCol}>
        <Text style={styles.weekLabel}>{formatWeekLabel(week.weekStartIso)}</Text>
        <Text style={styles.weekMeta}>
          {week.sessionsCount} {week.sessionsCount === 1 ? 'session' : 'sessions'} · {week.repsCount} reps
        </Text>
      </View>
      <View style={styles.weekFqiCol}>
        <Text style={styles.weekFqi}>{week.avgFqi == null ? '—' : week.avgFqi}</Text>
        <Text style={styles.weekMeta}>FQI</Text>
      </View>
    </View>
  );
}

function FaultRow({ fault }: { fault: MesocycleFaultCount }) {
  return (
    <View style={styles.faultRow} testID={`form-mesocycle-fault-${fault.fault}`}>
      <Text style={styles.faultName}>{formatFault(fault.fault)}</Text>
      <Text style={styles.faultCount}>{fault.count}×</Text>
      <Text style={styles.faultShare}>{formatPct(fault.share)}</Text>
    </View>
  );
}

interface AnalystSectionProps {
  result: MesocycleAnalystResult | null;
  loading: boolean;
  errorMessage: string | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  onRetry: () => void;
  onContinueInChat: () => void;
}

function AnalystSection({
  result,
  loading,
  errorMessage,
  expanded,
  onToggleExpanded,
  onRetry,
  onContinueInChat,
}: AnalystSectionProps) {
  const hasBody = loading || errorMessage != null || result != null;
  return (
    <View style={styles.section} testID="form-mesocycle-analyst-section">
      <Pressable
        onPress={onToggleExpanded}
        accessibilityRole="button"
        accessibilityLabel={
          expanded ? 'Collapse analyst review' : 'Expand analyst review'
        }
        style={styles.analystHeader}
        testID="form-mesocycle-analyst-toggle"
      >
        <Text style={styles.sectionTitle}>Analyst review</Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color="#8FA2B8"
        />
      </Pressable>
      {expanded ? (
        <View style={styles.sectionBody}>
          {loading ? (
            <View
              style={styles.analystRow}
              accessible
              accessibilityLabel="Coach is reviewing your mesocycle"
              testID="form-mesocycle-analyst-loading"
            >
              <ActivityIndicator color="#4C8CFF" />
              <Text style={styles.analystBody}>Reviewing your last 4 weeks…</Text>
            </View>
          ) : null}
          {!loading && errorMessage ? (
            <View style={styles.analystRow} testID="form-mesocycle-analyst-error">
              <Ionicons name="alert-circle" size={18} color="#FF6B6B" />
              <View style={styles.analystErrorBody}>
                <Text style={styles.analystErrorText}>{errorMessage}</Text>
                <Pressable
                  onPress={onRetry}
                  accessibilityRole="button"
                  accessibilityLabel="Retry analyst review"
                  style={styles.retryLink}
                  testID="form-mesocycle-analyst-retry"
                >
                  <Text style={styles.retryLinkText}>Retry</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          {!loading && !errorMessage && result ? (
            <View testID="form-mesocycle-analyst-result">
              <Text style={styles.analystBody}>{result.text}</Text>
              <Text style={styles.analystMeta} testID="form-mesocycle-analyst-provider">
                via {result.provider === 'gemma-cloud' ? 'Gemma' : 'coach'}
              </Text>
              <View style={styles.analystActions}>
                <Pressable
                  onPress={onRetry}
                  accessibilityRole="button"
                  accessibilityLabel="Regenerate analyst review"
                  style={styles.analystSecondaryAction}
                  testID="form-mesocycle-analyst-regenerate"
                >
                  <Ionicons name="refresh" size={14} color="#8FA2B8" />
                  <Text style={styles.analystSecondaryActionText}>Regenerate</Text>
                </Pressable>
                <Pressable
                  onPress={onContinueInChat}
                  accessibilityRole="button"
                  accessibilityLabel="Continue this review in the coach chat"
                  style={styles.analystPrimaryAction}
                  testID="form-mesocycle-analyst-continue-chat"
                >
                  <Ionicons name="chatbubble-ellipses" size={14} color="#FFFFFF" />
                  <Text style={styles.analystPrimaryActionText}>
                    Continue in chat
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          {!loading && !errorMessage && !result && !hasBody ? (
            <Text style={styles.analystEmpty} testID="form-mesocycle-analyst-empty">
              Tap &quot;Ask coach&quot; to get a natural-language review of your last
              4 weeks.
            </Text>
          ) : null}
          {!hasBody ? (
            <View style={styles.analystRow}>
              <Pressable
                onPress={onContinueInChat}
                accessibilityRole="button"
                accessibilityLabel="Continue in the coach chat"
                style={styles.analystSecondaryAction}
                testID="form-mesocycle-analyst-continue-chat-empty"
              >
                <Ionicons name="chatbubble-ellipses" size={14} color="#8FA2B8" />
                <Text style={styles.analystSecondaryActionText}>
                  Continue in chat
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function formatFault(code: string): string {
  return code.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function formatWeekLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function formatDelta(n: number): string {
  if (n > 0) return `+${n}`;
  return `${n}`;
}

function formatPct(n: number): string {
  const pct = Math.round(n * 100);
  if (pct > 0) return `+${pct}%`;
  return `${pct}%`;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050E1F',
  },
  content: {
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  title: {
    color: '#FFFFFF',
    fontFamily: 'Lexend_700Bold',
    fontSize: 22,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginVertical: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
  },
  errorText: {
    flex: 1,
    color: '#FF6B6B',
    fontFamily: 'Lexend_400Regular',
    fontSize: 13,
  },
  loader: {
    marginTop: 24,
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    color: '#E1E8EF',
    fontFamily: 'Lexend_500Medium',
    fontSize: 13,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  sectionBody: {
    backgroundColor: '#0F2339',
    borderRadius: 14,
    overflow: 'hidden',
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomColor: '#1F2D40',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  weekLabelCol: {
    flex: 1,
  },
  weekFqiCol: {
    alignItems: 'flex-end',
  },
  weekLabel: {
    color: '#FFFFFF',
    fontFamily: 'Lexend_500Medium',
    fontSize: 15,
  },
  weekMeta: {
    color: '#8FA2B8',
    fontFamily: 'Lexend_400Regular',
    fontSize: 12,
    marginTop: 2,
  },
  weekFqi: {
    color: '#4C8CFF',
    fontFamily: 'Lexend_700Bold',
    fontSize: 20,
  },
  faultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomColor: '#1F2D40',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  faultName: {
    flex: 1,
    color: '#FFFFFF',
    fontFamily: 'Lexend_500Medium',
    fontSize: 15,
  },
  faultCount: {
    color: '#E1E8EF',
    fontFamily: 'Lexend_400Regular',
    fontSize: 13,
    marginRight: 16,
  },
  faultShare: {
    color: '#4C8CFF',
    fontFamily: 'Lexend_500Medium',
    fontSize: 13,
    minWidth: 54,
    textAlign: 'right',
  },
  bodyText: {
    color: '#E1E8EF',
    fontFamily: 'Lexend_400Regular',
    fontSize: 14,
    lineHeight: 20,
    padding: 16,
  },
  metaText: {
    color: '#8FA2B8',
    fontFamily: 'Lexend_400Regular',
    fontSize: 12,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  analystHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  analystRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
  },
  analystBody: {
    color: '#E1E8EF',
    fontFamily: 'Lexend_400Regular',
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  analystMeta: {
    color: '#6F80A0',
    fontFamily: 'Lexend_400Regular',
    fontSize: 11,
    letterSpacing: 0.2,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  analystErrorBody: {
    flex: 1,
    gap: 6,
  },
  analystErrorText: {
    color: '#FF6B6B',
    fontFamily: 'Lexend_400Regular',
    fontSize: 13,
  },
  analystEmpty: {
    color: '#8FA2B8',
    fontFamily: 'Lexend_400Regular',
    fontSize: 13,
    padding: 16,
  },
  retryLink: {
    alignSelf: 'flex-start',
  },
  retryLinkText: {
    color: '#4C8CFF',
    fontFamily: 'Lexend_500Medium',
    fontSize: 13,
    fontWeight: '600',
  },
  analystActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  analystPrimaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#4C8CFF',
  },
  analystPrimaryActionText: {
    color: '#FFFFFF',
    fontFamily: 'Lexend_500Medium',
    fontSize: 13,
    fontWeight: '600',
  },
  analystSecondaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(143, 162, 184, 0.12)',
  },
  analystSecondaryActionText: {
    color: '#8FA2B8',
    fontFamily: 'Lexend_500Medium',
    fontSize: 13,
    fontWeight: '600',
  },
});
