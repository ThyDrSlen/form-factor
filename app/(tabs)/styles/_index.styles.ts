import { Platform, StyleSheet } from 'react-native';
import { spacing, borderRadius } from './_theme-constants';
import { tabColors } from './_tab-theme';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tabColors.background,
    padding: spacing.lg,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: tabColors.textPrimary,
    marginTop: spacing.md,
  },
  subtitle: {
    fontSize: 16,
    color: tabColors.textSecondary,
    marginTop: spacing.sm,
  },
  content: {
    flex: 1,
    marginTop: spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerTextContainer: {
    flex: 1,
  },
  tabSwitcher: {
    flexDirection: 'row',
    backgroundColor: '#0A172A',
    borderRadius: 14,
    padding: spacing.xs,
    marginTop: spacing.md,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  tabButtonActive: {
    backgroundColor: 'rgba(76, 140, 255, 0.15)',
  },
  tabText: {
    color: tabColors.textSecondary,
    fontWeight: '600',
  },
  tabTextActive: {
    color: tabColors.textPrimary,
  },
  coachContainer: {
    flex: 1,
    marginTop: spacing.xl,
  },
  quickPrompts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  quickPrompt: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.xl,
    backgroundColor: tabColors.accentSurface,
    borderWidth: 1,
    borderColor: tabColors.accentSurfaceBorder,
  },
  quickPromptText: {
    color: tabColors.textPrimary,
    fontWeight: '600',
  },
  coachError: {
    borderWidth: 1,
    borderColor: tabColors.errorDark,
    backgroundColor: '#2A0C0C',
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.md,
  },
  coachErrorTitle: {
    color: tabColors.textPrimary,
    marginBottom: spacing.xs,
    fontWeight: '600',
  },
  coachErrorText: {
    color: tabColors.textSecondary,
  },
  coachList: {
    flex: 1,
  },
  coachListContent: {
    paddingBottom: spacing.xl,
  },
  coachBubbleRow: {
    marginBottom: spacing.md,
  },
  coachBubble: {
    maxWidth: '85%',
    padding: spacing.md,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
  },
  coachBubbleAssistant: {
    backgroundColor: tabColors.overlay,
    borderColor: tabColors.accentBorder,
  },
  coachBubbleUser: {
    backgroundColor: '#0C2A4A',
    borderColor: tabColors.accent,
    marginLeft: 'auto',
  },
  coachBubbleText: {
    color: tabColors.textPrimary,
    lineHeight: 20,
  },
  coachBubbleMeta: {
    color: tabColors.textSecondary,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  coachComposer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#0A172A',
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: tabColors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
  },
  coachInput: {
    flex: 1,
    color: tabColors.textPrimary,
    paddingVertical: spacing.sm,
  },
  coachSend: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tabColors.accent,
  },
  coachSendDisabled: {
    backgroundColor: tabColors.accentSurfaceBorder,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: tabColors.textPrimary,
    marginBottom: spacing.md,
  },
  actionGrid: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  actionCardWrapper: {
    flex: 1,
  },
  actionCard: {
    borderRadius: borderRadius.xxl,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: tabColors.border,
  },
  actionIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(76, 140, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm + spacing.xs,
  },
  actionIconText: {
    fontSize: 24,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: tabColors.textPrimary,
    marginBottom: 4,
  },
  actionSubtitle: {
    fontSize: 14,
    color: tabColors.textSecondary,
    textAlign: 'center',
  },
  statsSection: {
    marginTop: spacing.sm,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  statCard: {
    flex: 1,
    borderRadius: borderRadius.xxl,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: tabColors.border,
  },
  statNumber: {
    fontSize: 32,
    fontWeight: 'bold',
    color: tabColors.accent,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    color: tabColors.textSecondary,
    textAlign: 'center',
  },
  feedContainer: {
    flex: 1,
    marginTop: spacing.md,
  },
  feedListContent: {
    paddingBottom: 120,
    gap: spacing.md,
  },
  feedCard: {
    backgroundColor: '#0A172A',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: tabColors.border,
    padding: spacing.sm,
  },
  feedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: 10,
  },
  feedHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  feedHeaderContent: {
    flex: 1,
  },
  feedAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(76, 140, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  feedAvatarInitial: {
    color: tabColors.accent,
    fontWeight: '700',
  },
  feedTitle: {
    color: tabColors.textPrimary,
    fontWeight: '700',
    fontSize: 16,
  },
  feedMeta: {
    color: tabColors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  iconButton: {
    padding: 6,
  },
  videoWrapper: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: tabColors.border,
  },
  video: {
    width: '100%',
    height: 320,
    backgroundColor: tabColors.background,
    position: 'relative',
  },
  videoSurface: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  videoPoster: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  videoPlaceholder: {
    height: 320,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(76, 140, 255, 0.05)',
  },
  videoPlaceholderText: {
    color: tabColors.textSecondary,
    fontSize: 14,
  },
  metricChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: 10,
    paddingHorizontal: spacing.xs,
  },
  metricChip: {
    backgroundColor: 'rgba(76, 140, 255, 0.12)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: spacing.xs + 2,
  },
  metricChipText: {
    color: tabColors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  feedActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs + spacing.sm,
  },
  feedActionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  feedActionLabel: {
    color: tabColors.textSecondary,
    fontSize: 13,
  },
  feedLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg + spacing.sm,
  },
  feedEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  errorText: {
    color: tabColors.accentAlt,
    marginBottom: spacing.sm,
  },
  uploadButton: {
    marginTop: spacing.md,
    backgroundColor: tabColors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.lg,
  },
  uploadButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
});

// Default export to satisfy Expo Router (this file is not a route)
export default null;
