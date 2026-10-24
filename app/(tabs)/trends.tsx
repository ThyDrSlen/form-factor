import React, { useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { HealthTrendsView } from '@/features/health/components/HealthTrendsView';
import { HealthInsightsExtras } from '@/features/health/components/HealthInsightsExtras';
import { theme } from '@/styles/theme';

export default function TrendsScreen() {
  const [section, setSection] = useState<'Overview' | 'Insights'>('Overview');
  return (
    <View style={styles.screen}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>Trends</Text>
        <Text style={styles.subtitle}>Your progress, in perspective.</Text>
        <View style={styles.tabs} accessibilityRole="tablist" accessibilityLabel="Trends sections">
          {(['Overview', 'Insights'] as const).map(label => (
            <Pressable
              key={label}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: section === label }}
              onPress={() => { Keyboard.dismiss(); setSection(label); }}
              style={({ pressed }) => [styles.tab, section === label && styles.selectedTab, pressed && styles.pressed]}
            >
              <Text style={[styles.tabLabel, section === label && styles.selectedLabel]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {(['Overview', 'Insights'] as const).map(panel => <ScrollView
        key={panel}
        style={[styles.screen, section !== panel && styles.hidden]}
        accessibilityElementsHidden={section !== panel}
        importantForAccessibility={section !== panel ? 'no-hide-descendants' : 'auto'}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="never"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {panel === 'Overview' ? <HealthTrendsView /> : <HealthInsightsExtras />}
      </ScrollView>)}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  hidden: { display: 'none' },
  content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },
  heading: { gap: 6, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12 },
  title: { color: theme.colors.text, fontFamily: theme.font.bold, fontSize: 28, lineHeight: 36 },
  subtitle: { color: theme.colors.secondary, fontFamily: theme.font.regular, fontSize: 14, lineHeight: 22 },
  tabs: { flexDirection: 'row', padding: 4, marginTop: 12, gap: 4, backgroundColor: theme.colors.surface, borderRadius: 16 },
  tab: { flex: 1, minHeight: 44, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  selectedTab: { backgroundColor: theme.colors.elevated },
  tabLabel: { color: theme.colors.secondary, fontFamily: theme.font.medium, fontSize: 14 },
  selectedLabel: { color: theme.colors.text },
  pressed: { opacity: 0.72 },
});
