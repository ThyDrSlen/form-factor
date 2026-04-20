import React, { useCallback, useMemo } from 'react';
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
import { buildMesocycleAnalystPrompt } from '@/lib/services/coach-mesocycle-analyst';

export default function FormMesocycleModal() {
  const router = useRouter();
  const { loading, error, insights, refresh } = useFormMesocycle();

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  const handleAskCoach = useCallback(() => {
    if (!insights) return;
    const prompt = buildMesocycleAnalystPrompt(insights);
    const url =
      `/(tabs)/coach?prefill=${encodeURIComponent(prompt)}` +
      `&focus=mesocycle-analyst`;
    router.push(url as Parameters<typeof router.push>[0]);
  }, [insights, router]);

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
        onAskCoach={insights && !insights.isEmpty ? handleAskCoach : undefined}
      />

      {loading && !insights ? (
        <ActivityIndicator color="#4C8CFF" style={styles.loader} />
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
});
