import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { readBodyFatHistory, type BodyFatReading } from '@/lib/services/healthkit/body-composition';
import { theme } from '@/styles/theme';

export function BodyCompositionCard({ ownerId }: { ownerId?: string }) {
  return ownerId ? <OwnedBodyCompositionCard key={ownerId} /> : null;
}

function OwnedBodyCompositionCard() {
  const [readings, setReadings] = useState<BodyFatReading[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const read = async () => {
    if (busy) return;
    setBusy(true); setError(false);
    try {
      const next = await readBodyFatHistory();
      if (mounted.current) setReadings(next);
    } catch { if (mounted.current) setError(true); }
    finally { if (mounted.current) setBusy(false); }
  };
  const latest = readings?.[readings.length - 1];
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>Body composition</Text>
    {latest ? <>
      <Text style={styles.value}>{latest.value.toFixed(1)}%</Text>
      <Text style={styles.detail}>Body fat · measured {new Date(latest.date).toLocaleDateString()}</Text>
      <Text style={styles.detail}>{readings!.length} recorded samples in the past 180 days. No filled-in readings.</Text>
    </> : <Text style={styles.detail}>{readings ? 'No body-fat readings returned. Check Apple Health data and read access.' : 'Optional: read body-fat measurements saved by a compatible scale or another source in Apple Health.'}</Text>}
    <Text style={styles.detail}>Estimates vary with hydration and measurement method. We do not infer muscle growth from body fat or weight alone. Source-level comparisons are not yet available.</Text>
    {error ? <Text accessibilityRole="alert" style={styles.detail}>Could not read body-fat history. You may need the updated device build. Try again.</Text> : null}
    <Pressable accessibilityRole="button" accessibilityState={{disabled:busy}} disabled={busy} onPress={() => { void read(); }} style={styles.button}>
      <Text style={styles.buttonText}>{busy ? 'Reading…' : 'Read body-fat history'}</Text>
    </Pressable>
  </View>;
}
const styles = StyleSheet.create({
  card: { padding: 18, gap: 10, borderRadius: 16, backgroundColor: theme.colors.surface },
  title: { fontSize: 18, fontWeight:'600', color:theme.colors.text },
  value: { fontSize: 32, fontWeight:'700', color:theme.colors.text },
  detail: { fontSize: 13, lineHeight: 19, color:theme.colors.secondary },
  button: { minHeight:44, justifyContent:'center' },
  buttonText: { color:theme.colors.accentText, fontWeight:'600' },
});
