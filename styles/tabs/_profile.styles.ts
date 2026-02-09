import { Platform, StyleSheet } from 'react-native';
import { spacing, borderRadius } from './_theme-constants';
import { tabColors } from './_tab-theme';

// Helper to get the correct font family based on platform and weight
const getFontFamily = (weight: 'regular' | 'medium' | 'bold' = 'regular') => {
  if (Platform.OS === 'ios') {
    return 'System';
  }
  if (Platform.OS === 'web') {
    return weight === 'bold' ? 'Lexend_700Bold' : weight === 'medium' ? 'Lexend_500Medium' : 'Lexend_400Regular';
  }
  return weight === 'medium' ? 'sans-serif-medium' : 'sans-serif';
};

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tabColors.background,
  },
  content: {
    padding: spacing.lg,
  },
  headerCard: {
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: tabColors.border,
    marginBottom: spacing.lg,
  },
  avatarContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(76, 140, 255, 0.2)',
    borderWidth: 2,
    borderColor: tabColors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 40,
  },
  avatarText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: tabColors.accent,
    fontFamily: getFontFamily('bold'),
  },
  nameText: {
    fontSize: 22,
    fontWeight: '700',
    color: tabColors.textPrimary,
    marginBottom: 6,
    fontFamily: getFontFamily('bold'),
  },
  usernameText: {
    fontSize: 14,
    color: tabColors.textSecondary,
    marginBottom: spacing.xs,
    fontFamily: getFontFamily('regular'),
  },
  emailText: {
    fontSize: 18,
    fontWeight: '600',
    color: tabColors.textPrimary,
    marginBottom: spacing.xs,
    fontFamily: getFontFamily('medium'),
  },
  memberSince: {
    fontSize: 14,
    color: tabColors.textSecondary,
    fontFamily: getFontFamily('regular'),
  },
  socialCountsRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    width: '100%',
    gap: spacing.sm,
  },
  socialCountPill: {
    flex: 1,
    alignItems: 'center',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: tabColors.border,
    backgroundColor: 'rgba(76, 140, 255, 0.08)',
    paddingVertical: spacing.sm,
  },
  socialCountValue: {
    color: tabColors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    fontFamily: getFontFamily('bold'),
  },
  socialCountLabel: {
    color: tabColors.textSecondary,
    fontSize: 12,
    marginTop: 2,
    fontFamily: getFontFamily('regular'),
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: tabColors.textSecondary,
    marginBottom: spacing.sm + spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: getFontFamily('medium'),
  },
  profileFeedContainer: {
    marginHorizontal: 0,
  },
  profileFeedListContent: {
    paddingHorizontal: 0,
  },
  menuGroup: {
    gap: spacing.sm,
  },
  bottomSpacer: {
    height: 100,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: tabColors.border,
  },
  menuIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(76, 140, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  menuText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: tabColors.textPrimary,
    fontFamily: getFontFamily('medium'),
  },
  menuTextDanger: {
    color: tabColors.error,
  },
  debugButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 204, 0, 0.3)',
    gap: spacing.xs + 4,
  },
  debugButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFCC00',
    fontFamily: getFontFamily('medium'),
  },
  debugHint: {
    fontSize: 12,
    color: '#6781A6',
    marginTop: spacing.sm,
    marginLeft: spacing.xs,
    fontFamily: getFontFamily('regular'),
  },
  debugStatsCard: {
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: tabColors.border,
    marginBottom: spacing.sm + spacing.xs,
  },
  debugStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginBottom: spacing.sm + spacing.xs,
  },
  debugStat: {
    alignItems: 'center',
    flex: 1,
  },
  debugStatValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: tabColors.textPrimary,
    marginBottom: spacing.xs,
    fontFamily: getFontFamily('bold'),
  },
  debugStatLabel: {
    fontSize: 12,
    color: tabColors.textSecondary,
    fontFamily: getFontFamily('regular'),
  },
  debugStatDivider: {
    width: 1,
    height: 40,
    backgroundColor: tabColors.border,
  },
  debugStatOnline: {
    color: '#34C759',
  },
  debugStatOffline: {
    color: tabColors.textSecondary,
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    paddingVertical: spacing.sm,
  },
  refreshText: {
    fontSize: 14,
    color: tabColors.accent,
    fontWeight: '500',
    fontFamily: getFontFamily('medium'),
  },
  debugActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  periodSelector: {
    flexDirection: 'row',
    backgroundColor: '#0F2339',
    borderRadius: borderRadius.lg,
    padding: spacing.xs,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    alignSelf: 'center',
  },
  periodButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
  },
  periodButtonActive: {
    backgroundColor: tabColors.accent,
  },
  periodButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: tabColors.textSecondary,
    fontFamily: getFontFamily('medium'),
  },
  periodButtonTextActive: {
    color: '#FFFFFF',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    flex: 1,
  },
  modalContent: {
    backgroundColor: '#0F2339',
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    padding: 20,
    borderWidth: 1,
    borderColor: tabColors.border,
  },
  modalHandle: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: tabColors.border,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: tabColors.textPrimary,
    marginBottom: spacing.sm + spacing.xs,
  },
  modalLabel: {
    fontSize: 14,
    color: tabColors.textSecondary,
    marginBottom: spacing.xs,
  },
  modalInput: {
    backgroundColor: tabColors.background,
    borderWidth: 1,
    borderColor: tabColors.border,
    borderRadius: borderRadius.md,
    padding: spacing.sm + spacing.xs,
    color: tabColors.textPrimary,
    marginBottom: 20,
    fontSize: 16,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm + spacing.xs,
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  privacyRowTextWrap: {
    flex: 1,
  },
  privacyRowTitle: {
    color: tabColors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
    fontFamily: getFontFamily('medium'),
  },
  privacyRowSubtitle: {
    marginTop: 3,
    color: tabColors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: getFontFamily('regular'),
  },
  modalButton: {
    paddingVertical: spacing.sm + spacing.xs,
    paddingHorizontal: 18,
    borderRadius: borderRadius.md,
    borderWidth: 1,
  },
  modalButtonSecondary: {
    borderColor: tabColors.border,
  },
  modalButtonPrimary: {
    backgroundColor: tabColors.accent,
    borderColor: tabColors.accent,
  },
  modalButtonText: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: getFontFamily('medium'),
  },
  modalButtonTextSecondary: {
    color: tabColors.textSecondary,
  },
  modalButtonTextPrimary: {
    color: '#0F2339',
  },
  inputContainer: {
    marginBottom: 20,
  },
  modalRow: {
    flexDirection: 'row',
    gap: 12,
  },
  modalThirdWidth: {
    flex: 1,
  },
});
