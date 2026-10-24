import React, { memo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VideoView, useVideoPlayer } from 'expo-video';
import { theme } from '@/styles/theme';

type Props = {
  uri: string;
  exercise: string;
  reps: number;
  score: string;
  duration: string;
  primaryLabel: string;
  primaryValue: string;
  secondaryLabel: string;
  secondaryValue: string;
  quality: string;
  size: string;
  error: string | null;
  uploading: boolean;
  saving: boolean;
  onPublish: () => void;
  onSave: () => void;
  onDiscard: () => void;
};

const ReviewVideo = memo(function ReviewVideo({ uri }: { uri: string }) {
  // The hook owns the player lifetime. Start paused so the first frame remains
  // still while the review opens; playback is controlled by the native controls.
  const player = useVideoPlayer(uri, instance => { instance.loop = false; });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls testID="review-video" />;
});

export const RecordingReview = memo(function RecordingReview(props: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const busy = props.uploading || props.saving;
  const details = [
    { label: props.primaryLabel, value: props.primaryValue },
    { label: props.secondaryLabel, value: props.secondaryValue },
  ].filter(metric => metric.label !== '--' && metric.value !== '--');

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>SESSION RECORDING</Text>
          <Text style={styles.title}>Review your set</Text>
        </View>
        <View style={styles.badge}><Text style={styles.badgeText}>{props.exercise}</Text></View>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.video, { height: Math.max(180, Math.min(360, height * 0.36)) }]}>
          <ReviewVideo uri={props.uri} />
        </View>
        <View style={styles.metrics}>
          <Metric label="Reps" value={String(props.reps)} />
          <Metric label="Form / 100" value={props.score} />
          <Metric label="Duration" value={props.duration} />
        </View>
        {details.length > 0 && <View style={styles.details}>
          {details.map(metric => <View key={metric.label} style={styles.detailRow}>
            <Text style={styles.detailLabel}>{metric.label}</Text><Text style={styles.detailValue}>{metric.value}</Text>
          </View>)}
        </View>}
        <Text style={styles.fileInfo}>
          {[props.quality !== '--' ? `${props.quality} video quality` : null, props.size !== '--' ? props.size : null].filter(Boolean).join(' · ')}
        </Text>
        {props.error ? <Text accessibilityRole="alert" style={styles.error}>{props.error}</Text> : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 8 }]}>
        <Text style={styles.privacy}>Private until you choose Publish + Save.</Text>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Save only" accessibilityState={{ disabled: busy }} disabled={busy} onPress={props.onSave} style={({ pressed }) => [styles.button, styles.secondary, (pressed || busy) && styles.dim]}>
            {props.saving && !props.uploading ? <ActivityIndicator color={theme.colors.text} /> : <Text style={styles.secondaryText}>Save only</Text>}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Publish + Save" accessibilityState={{ disabled: busy }} disabled={busy} onPress={props.onPublish} style={({ pressed }) => [styles.button, styles.primary, (pressed || busy) && styles.dim]}>
            {props.uploading ? <ActivityIndicator color={theme.colors.onAccent} /> : <Text style={styles.primaryText}>Publish + Save</Text>}
          </Pressable>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Delete local copy" accessibilityState={{ disabled: busy }} disabled={busy} onPress={props.onDiscard} style={({ pressed }) => [styles.discard, (pressed || busy) && styles.dim]}>
          <Text style={styles.discardText}>Delete local copy</Text>
        </Pressable>
      </View>
    </View>
  );
});

function Metric({ label, value }: { label: string; value: string }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>;
}

const { colors, font } = theme;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 20, paddingVertical: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  eyebrow: { color: colors.secondary, fontFamily: font.medium, fontSize: 10, letterSpacing: 1.6, marginBottom: 6 },
  title: { color: colors.text, fontFamily: font.bold, fontSize: 24, letterSpacing: -0.6 },
  badge: { backgroundColor: colors.elevated, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7, flexShrink: 1 },
  badgeText: { color: colors.accentText, fontFamily: font.medium, fontSize: 12 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 20, gap: 16 },
  video: { width: '100%', alignSelf: 'stretch', backgroundColor: '#000000', overflow: 'hidden', borderRadius: 18 },
  metrics: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 16, paddingVertical: 18 },
  metric: { flex: 1, alignItems: 'center', paddingHorizontal: 4, gap: 6 },
  metricLabel: { color: colors.secondary, fontSize: 11, textAlign: 'center' },
  metricValue: { color: colors.text, fontFamily: font.bold, fontSize: 25 },
  details: { gap: 12 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  detailLabel: { color: colors.secondary, fontSize: 13, flexShrink: 1 },
  detailValue: { color: colors.text, fontSize: 13 },
  fileInfo: { color: colors.secondary, fontSize: 12, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 13, lineHeight: 20 },
  footer: { paddingHorizontal: 20, paddingTop: 14, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  privacy: { color: colors.secondary, textAlign: 'center', fontSize: 12, marginBottom: 14 },
  actions: { flexDirection: 'row', gap: 10 },
  button: { flex: 1, minHeight: 52, paddingVertical: 14, paddingHorizontal: 8, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  primaryText: { color: colors.onAccent, fontFamily: font.bold, fontSize: 13, textAlign: 'center' },
  secondaryText: { color: colors.text, fontFamily: font.medium, fontSize: 13, textAlign: 'center' },
  discard: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  discardText: { color: colors.danger, fontSize: 12 },
  dim: { opacity: 0.5 },
});
