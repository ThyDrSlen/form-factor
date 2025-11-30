import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const colors = {
  background: '#f6f8fb',
  ink: '#0b1a2f',
  muted: '#51607a',
  brand: '#1583ff',
  brandBright: '#29a3ff',
  darkPanel: '#0b1b34',
  card: '#ffffff',
  accentPanel: '#0f2644',
  accentBorder: '#dfe7f5',
};

const valueProps = [
  { title: 'Real-time cues', body: 'ARKit + Vision Camera detects reps and flags swing, depth, ROM, and tempo as you move.' },
  { title: 'Auto logging', body: 'Sets, reps, and weight captured automatically; no fiddling with inputs between sets.' },
  { title: 'Health-aware coach', body: 'AI adapts to sleep, HR, and recent load from HealthKit to nudge form or intensity.' },
  { title: 'Built for lifters', body: 'Offline-first, fast logging, iOS-first experience with feed and video capture baked in.' },
];

const howItWorks = [
  { step: '01', title: 'Point your camera', body: 'Track every rep in real time with a simple setup.' },
  { step: '02', title: 'Get instant cues', body: 'Fix swing, depth, ROM, and tempo mid-set instead of after the fact.' },
  { step: '03', title: 'Auto-log sets', body: 'Capture reps and weight automatically; syncs cleanly when back online.' },
  { step: '04', title: 'Coach adjusts', body: 'AI suggestions shift when sleep dips or load spikes.' },
];

const featureDeepDive = [
  {
    title: 'Rep and form tracking',
    body: 'ARKit body tracking, Vision Camera overlays, and optional speech cues keep you honest on each rep.',
    bullets: ['Push-up and pull-up detection', 'Video capture/upload with metrics JSON', 'Overlay and feed ready on web'],
    tint: ['#0b1b34', '#13345c'] as const,
  },
  {
    title: 'Health and recovery context',
    body: 'HealthKit import for activity, HR, weight, and sleep feeds the coach so cues stay realistic.',
    bullets: ['Trends and bulk sync to Supabase', 'Watch connectivity helpers', 'Coach context tags: sleep dip, high HR'],
    tint: ['#0c2340', '#0f2d51'] as const,
  },
  {
    title: 'Logging and sync built for speed',
    body: 'Offline-first SQLite with retrying sync queue and conflict guards means no lost sets or foods.',
    bullets: ['Fast add/delete for foods and workouts', 'Realtime backfill per user', 'Safe conflict handling for edits'],
    tint: ['#0d2b4c', '#13345c'] as const,
  },
  {
    title: 'Video feed and social proof',
    body: 'Private uploads with signed thumbnails plus comments and likes keep the community accountable.',
    bullets: ['Signed URLs with expiring access', 'Media buckets for videos and thumbnails', 'Playback via VideoView'],
    tint: ['#0b1f3b', '#12355f'] as const,
  },
];

const reliabilityBadges = [
  'Offline-first with retrying sync',
  'Supabase RLS on user data',
  'Private media buckets by default',
  'Notification hygiene and pruning',
];

const roadmapChips = [
  'Periodization planning',
  'Progressive overload tracking',
  'Goal-based templates',
  'Richer social/feed',
  'Android parity',
];

const platformSnapshot = [
  'iOS-first (Expo, Hermes, NativeWind)',
  'Web dashboards (read-first)',
  'Supabase Auth/Postgres + Edge Functions',
];

export default function LandingPage() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <LinearGradient colors={['#f6f9ff', '#e9f2ff'] as const} style={styles.heroSection}>
        <View style={styles.navbar}>
          <View style={styles.brandRow}>
            <Image source={require('../assets/images/ff-logo.png')} style={styles.logo} resizeMode="contain" />
            <Text style={styles.brandName}>Form Factor</Text>
          </View>
          <View style={styles.navLinks}>
            <Text style={styles.navLink}>Product</Text>
            <Text style={styles.navLink}>Features</Text>
            <Text style={styles.navLink}>Coach</Text>
            <Text style={styles.navLink}>Roadmap</Text>
            <Text style={styles.navLink}>Docs</Text>
          </View>
          <Pressable style={styles.navCTA}>
            <Text style={styles.navCTAText}>Get the app</Text>
          </Pressable>
        </View>

        <View style={styles.heroBody}>
          <View style={styles.heroCopy}>
            <View style={styles.eyebrow}>
              <Text style={styles.eyebrowText}>Real-time form coaching</Text>
            </View>
            <Text style={styles.heroTitle}>Real-time form coaching from your phone camera.</Text>
            <Text style={styles.heroSubtitle}>
              Form Factor counts reps, flags faults, and logs sets automatically - think Strava for lifting with instant
              cues.
            </Text>
            <View style={styles.ctaRow}>
              <Pressable style={[styles.ctaButton, styles.ctaPrimary]}>
                <Text style={styles.ctaPrimaryText}>Get the iOS app</Text>
              </Pressable>
              <Pressable style={[styles.ctaButton, styles.ctaSecondary]}>
                <Text style={styles.ctaSecondaryText}>See how it works</Text>
              </Pressable>
            </View>
            <View style={styles.trustRow}>
              <Text style={styles.trustText}>Offline-first logging</Text>
              <View style={styles.dividerDot} />
              <Text style={styles.trustText}>HealthKit-aware coach</Text>
              <View style={styles.dividerDot} />
              <Text style={styles.trustText}>ARKit rep detection</Text>
            </View>
          </View>

          <View style={styles.heroMock}>
            <LinearGradient colors={['#0b1b34', '#10335c'] as const} style={styles.heroMockCard}>
              <View style={styles.heroMockHeader}>
                <Text style={styles.heroMockTitle}>Live rep scan</Text>
                <Text style={styles.heroMockMeta}>ARKit + Vision Camera</Text>
              </View>
              <View style={styles.mockVideo}>
                <Text style={styles.mockVideoText}>Camera overlay with cues</Text>
                <View style={styles.mockCuePill}>
                  <Text style={styles.mockCueText}>Pull-up: reduce swing</Text>
                </View>
                <View style={[styles.mockCuePill, styles.mockCueSecondary]}>
                  <Text style={styles.mockCueSecondaryText}>Depth good • Reps: 8</Text>
                </View>
              </View>
              <View style={styles.heroMockFooter}>
                <Text style={styles.heroMockFooterText}>Auto-logging enabled</Text>
                <Text style={styles.heroMockFooterValue}>Set saved</Text>
              </View>
            </LinearGradient>
          </View>
        </View>
      </LinearGradient>

      <SectionHeader title="Built for lifters" subtitle="Precise cues, fast logging, HealthKit-aware coaching." />
      <View style={styles.cardGrid}>
        {valueProps.map((item) => (
          <View key={item.title} style={styles.card}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardBody}>{item.body}</Text>
          </View>
        ))}
      </View>

      <SectionHeader title="How it works" subtitle="Simple flow from camera to cues to auto-logged sets." />
      <View style={styles.stepsRow}>
        {howItWorks.map((item) => (
          <View key={item.step} style={styles.stepCard}>
            <Text style={styles.stepNumber}>{item.step}</Text>
            <Text style={styles.stepTitle}>{item.title}</Text>
            <Text style={styles.stepBody}>{item.body}</Text>
          </View>
        ))}
      </View>

      <SectionHeader title="Feature deep dive" subtitle="From ARKit capture to HealthKit-aware coaching and feed." />
      <View style={styles.featureList}>
        {featureDeepDive.map((item, index) => (
          <View key={item.title} style={[styles.featureRow, index % 2 === 1 && styles.featureRowReversed]}>
            <View style={styles.featureCopy}>
              <Text style={styles.featureTitle}>{item.title}</Text>
              <Text style={styles.featureBody}>{item.body}</Text>
              <View style={styles.bulletList}>
                {item.bullets.map((bullet) => (
                  <View key={bullet} style={styles.bulletRow}>
                    <View style={styles.bulletDot} />
                    <Text style={styles.bulletText}>{bullet}</Text>
                  </View>
                ))}
              </View>
            </View>
            <LinearGradient colors={item.tint} style={styles.featureVisual}>
              <Text style={styles.visualLabel}>Preview</Text>
              <View style={styles.visualCard}>
                <Text style={styles.visualTitle}>{item.title}</Text>
                <Text style={styles.visualSubtitle}>{item.body}</Text>
              </View>
            </LinearGradient>
          </View>
        ))}
      </View>

      <SectionHeader title="AI coach with context" subtitle="Adaptive cues that react to recovery, load, and trends." />
      <LinearGradient colors={['#0b1b34', '#0f2746'] as const} style={styles.coachPanel}>
        <View style={styles.coachTextBlock}>
          <Text style={styles.coachTitle}>Sleep-aware, load-aware, ready to nudge.</Text>
          <Text style={styles.coachBody}>
            Edge Function powered coach that adapts when your sleep dips or volume spikes. Keeps form first when recovery
            is low; pushes intensity when green.
          </Text>
          <View style={styles.coachTags}>
            {['Sleep dip', 'HR elevated', 'Recent load high', 'Deload candidate'].map((tag) => (
              <View key={tag} style={styles.tagPill}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
          <View style={styles.ctaRow}>
            <Pressable style={[styles.ctaButton, styles.ctaPrimary]}>
              <Text style={styles.ctaPrimaryText}>Talk to the coach</Text>
            </Pressable>
            <Pressable style={[styles.ctaButton, styles.ctaSecondaryDark]}>
              <Text style={styles.ctaSecondaryText}>See prompts</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.coachMock}>
          <View style={styles.chatBubble}>
            <Text style={styles.chatSpeaker}>Coach</Text>
            <Text style={styles.chatText}>Form looks solid. Reduce swing on reps 5-6; aim for slower negatives.</Text>
          </View>
          <View style={[styles.chatBubble, styles.chatBubbleUser]}>
            <Text style={styles.chatSpeaker}>You</Text>
            <Text style={styles.chatText}>Energy is low today - slept 6h.</Text>
          </View>
          <View style={styles.chatBubble}>
            <Text style={styles.chatSpeaker}>Coach</Text>
            <Text style={styles.chatText}>Noted. Keep form focus; drop load 10% and hit controlled triples.</Text>
          </View>
        </View>
      </LinearGradient>

      <SectionHeader title="Reliability and privacy" subtitle="Built-in protections and sync reliability from day one." />
      <View style={styles.badgeRow}>
        {reliabilityBadges.map((item) => (
          <View key={item} style={styles.badgeCard}>
            <Text style={styles.badgeText}>{item}</Text>
          </View>
        ))}
      </View>

      <SectionHeader title="Platform snapshot" subtitle="What ships today and what is on deck." />
      <View style={styles.snapshotRow}>
        {platformSnapshot.map((item) => (
          <View key={item} style={styles.snapshotCard}>
            <Text style={styles.snapshotText}>{item}</Text>
          </View>
        ))}
      </View>

      <SectionHeader title="Roadmap" subtitle="What is coming next." />
      <View style={styles.roadmapRow}>
        {roadmapChips.map((item) => (
          <View key={item} style={styles.roadmapChip}>
            <Text style={styles.roadmapText}>{item}</Text>
          </View>
        ))}
      </View>

      <LinearGradient colors={['#0f2746', '#13355f'] as const} style={styles.ctaStrip}>
        <View style={styles.ctaStripContent}>
          <Text style={styles.ctaStripTitle}>Ready for real-time form coaching?</Text>
          <Text style={styles.ctaStripBody}>Join the iOS-first experience, built for lifters with HealthKit-aware AI.</Text>
          <View style={styles.ctaRow}>
            <Pressable style={[styles.ctaButton, styles.ctaPrimary]}>
              <Text style={styles.ctaPrimaryText}>Get the iOS app</Text>
            </Pressable>
            <Pressable style={[styles.ctaButton, styles.ctaSecondaryDark]}>
              <Text style={styles.ctaSecondaryText}>See the feed</Text>
            </Pressable>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.footer}>
        <View style={styles.footerBrand}>
          <Image source={require('../assets/images/ff-logo.png')} style={styles.footerLogo} resizeMode="contain" />
          <Text style={styles.footerName}>Form Factor</Text>
        </View>
        <View style={styles.footerLinks}>
          <Text style={styles.footerLink}>Docs</Text>
          <Text style={styles.footerLink}>Support</Text>
          <Text style={styles.footerLink}>Privacy</Text>
          <Text style={styles.footerLink}>Terms</Text>
          <Text style={styles.footerLink}>Built on Expo + Supabase</Text>
        </View>
      </View>
    </ScrollView>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionSubtitle}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: 64,
  },
  heroSection: {
    paddingTop: 32,
    paddingBottom: 48,
    paddingHorizontal: 24,
  },
  navbar: {
    maxWidth: 1180,
    alignSelf: 'center',
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logo: {
    height: 42,
    width: 42,
  },
  brandName: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.ink,
  },
  navLinks: {
    flexDirection: 'row',
    gap: 18,
    alignItems: 'center',
  },
  navLink: {
    fontSize: 14,
    color: colors.muted,
    fontWeight: '600',
  },
  navCTA: {
    backgroundColor: colors.ink,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 990,
  },
  navCTAText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  heroBody: {
    maxWidth: 1180,
    alignSelf: 'center',
    width: '100%',
    flexDirection: 'row',
    gap: 28,
  },
  heroCopy: {
    flex: 1,
    gap: 14,
  },
  eyebrow: {
    alignSelf: 'flex-start',
    backgroundColor: '#e5efff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 990,
  },
  eyebrowText: {
    color: colors.brand,
    fontWeight: '700',
    fontSize: 13,
  },
  heroTitle: {
    fontSize: 42,
    fontWeight: '800',
    color: colors.ink,
    lineHeight: 48,
  },
  heroSubtitle: {
    fontSize: 18,
    color: colors.muted,
    lineHeight: 26,
  },
  ctaRow: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
  },
  ctaButton: {
    borderRadius: 990,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  ctaPrimary: {
    backgroundColor: colors.brand,
    shadowColor: '#003a73',
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 20,
    elevation: 2,
  },
  ctaPrimaryText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
  },
  ctaSecondary: {
    borderWidth: 1,
    borderColor: colors.ink,
    backgroundColor: '#ffffff',
  },
  ctaSecondaryDark: {
    borderWidth: 1,
    borderColor: '#ffffff',
    backgroundColor: 'transparent',
  },
  ctaSecondaryText: {
    color: colors.ink,
    fontWeight: '700',
    fontSize: 15,
  },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  trustText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '600',
  },
  dividerDot: {
    height: 5,
    width: 5,
    borderRadius: 990,
    backgroundColor: '#c4cfe5',
  },
  heroMock: {
    flex: 1,
  },
  heroMockCard: {
    borderRadius: 22,
    padding: 18,
    shadowColor: '#001026',
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 16 },
    shadowRadius: 30,
    elevation: 4,
  },
  heroMockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  heroMockTitle: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 16,
  },
  heroMockMeta: {
    color: '#a7c3ff',
    fontSize: 13,
    fontWeight: '600',
  },
  mockVideo: {
    backgroundColor: '#0a233f',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1c3b62',
    padding: 18,
    minHeight: 200,
    justifyContent: 'space-between',
  },
  mockVideoText: {
    color: '#c6dbff',
    fontWeight: '600',
    fontSize: 14,
  },
  mockCuePill: {
    backgroundColor: '#1f65d6',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  mockCueText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  mockCueSecondary: {
    backgroundColor: '#0f3058',
    borderWidth: 1,
    borderColor: '#285c9c',
  },
  mockCueSecondaryText: {
    color: '#b7d3ff',
    fontWeight: '600',
  },
  heroMockFooter: {
    marginTop: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroMockFooterText: {
    color: '#a7c3ff',
    fontWeight: '600',
  },
  heroMockFooterValue: {
    color: '#ffffff',
    fontWeight: '700',
  },
  sectionHeader: {
    maxWidth: 1180,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: 24,
    marginTop: 56,
    marginBottom: 18,
  },
  sectionTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.ink,
    marginBottom: 6,
  },
  sectionSubtitle: {
    fontSize: 16,
    color: colors.muted,
    lineHeight: 22,
  },
  cardGrid: {
    maxWidth: 1180,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: 24,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 18,
    flexBasis: '48%',
    borderWidth: 1,
    borderColor: colors.accentBorder,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 8,
  },
  cardBody: {
    fontSize: 15,
    color: colors.muted,
    lineHeight: 22,
  },
  stepsRow: {
    maxWidth: 1180,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: 24,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  stepCard: {
    backgroundColor: '#0f2746',
    borderRadius: 14,
    padding: 16,
    flexBasis: '48%',
    borderWidth: 1,
    borderColor: '#1b3c67',
  },
  stepNumber: {
    color: colors.brandBright,
    fontWeight: '800',
    fontSize: 14,
  },
  stepTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
    marginTop: 6,
    marginBottom: 6,
  },
  stepBody: {
    color: '#c4d6f1',
    lineHeight: 20,
    fontSize: 14,
  },
  featureList: {
    maxWidth: 1180,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: 24,
    gap: 18,
  },
  featureRow: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    flexDirection: 'row',
    gap: 18,
    padding: 18,
  },
  featureRowReversed: {
    flexDirection: 'row-reverse',
  },
  featureCopy: {
    flex: 1,
    gap: 10,
  },
  featureTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.ink,
  },
  featureBody: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  bulletList: {
    gap: 8,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  bulletDot: {
    height: 8,
    width: 8,
    borderRadius: 990,
    backgroundColor: colors.brand,
    marginTop: 6,
  },
  bulletText: {
    color: colors.muted,
    flex: 1,
    lineHeight: 20,
    fontSize: 14,
  },
  featureVisual: {
    flex: 1,
    borderRadius: 14,
    padding: 16,
    justifyContent: 'space-between',
  },
  visualLabel: {
    color: '#8cb8ff',
    fontWeight: '700',
    fontSize: 13,
  },
  visualCard: {
    backgroundColor: '#0b1b34',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1a3a64',
  },
  visualTitle: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 16,
    marginBottom: 4,
  },
  visualSubtitle: {
    color: '#c0d3f3',
    fontSize: 14,
    lineHeight: 20,
  },
  coachPanel: {
    maxWidth: 1180,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: 24,
    borderRadius: 18,
    padding: 20,
    flexDirection: 'row',
    gap: 18,
    marginTop: 12,
  },
  coachTextBlock: {
    flex: 1,
    gap: 12,
  },
  coachTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
  },
  coachBody: {
    color: '#c4d6f1',
    lineHeight: 22,
    fontSize: 15,
  },
  coachTags: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  tagPill: {
    backgroundColor: '#12355f',
    borderRadius: 990,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#265c9b',
  },
  tagText: {
    color: '#d9e8ff',
    fontWeight: '700',
    fontSize: 13,
  },
  coachMock: {
    flex: 1,
    gap: 10,
  },
  chatBubble: {
    backgroundColor: '#0b1f3b',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1a3a64',
  },
  chatBubbleUser: {
    backgroundColor: '#0f3058',
  },
  chatSpeaker: {
    color: '#8cb8ff',
    fontWeight: '700',
    marginBottom: 6,
    fontSize: 13,
  },
  chatText: {
    color: '#dbe8ff',
    fontSize: 14,
    lineHeight: 20,
  },
  badgeRow: {
    maxWidth: 1180,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: 24,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  badgeCard: {
    backgroundColor: '#ffffff',
    borderRadius: 990,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.accentBorder,
  },
  badgeText: {
    color: colors.ink,
    fontWeight: '700',
    fontSize: 14,
  },
  snapshotRow: {
    maxWidth: 1180,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: 24,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  snapshotCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    flexGrow: 1,
  },
  snapshotText: {
    color: colors.muted,
    fontWeight: '700',
  },
  roadmapRow: {
    maxWidth: 1180,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: 24,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  roadmapChip: {
    backgroundColor: '#0f2746',
    borderRadius: 990,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#1a3a64',
  },
  roadmapText: {
    color: '#dbe8ff',
    fontWeight: '700',
    fontSize: 14,
  },
  ctaStrip: {
    maxWidth: 1180,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: 24,
    borderRadius: 18,
    paddingVertical: 26,
  },
  ctaStripContent: {
    gap: 10,
  },
  ctaStripTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
  },
  ctaStripBody: {
    color: '#c4d6f1',
    fontSize: 15,
    lineHeight: 22,
  },
  footer: {
    maxWidth: 1180,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: 24,
    marginTop: 32,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  footerBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  footerLogo: {
    width: 32,
    height: 32,
  },
  footerName: {
    color: colors.ink,
    fontWeight: '800',
  },
  footerLinks: {
    flexDirection: 'row',
    gap: 14,
    flexWrap: 'wrap',
  },
  footerLink: {
    color: colors.muted,
    fontWeight: '700',
    fontSize: 13,
  },
});
