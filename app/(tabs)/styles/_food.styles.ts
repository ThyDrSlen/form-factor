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
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: tabColors.background,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: 16,
    color: tabColors.textSecondary,
    fontFamily: getFontFamily('medium'),
  },
  list: {
    padding: spacing.md,
    paddingBottom: 100,
  },
  cardWrapper: {
    marginBottom: spacing.sm + spacing.xs,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  cardGradient: {
    borderRadius: borderRadius.lg,
    padding: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: tabColors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  cardHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  swipeDelete: {
    backgroundColor: tabColors.error,
    justifyContent: 'center',
    alignItems: 'center',
    width: 88,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.sm + spacing.xs,
    flexDirection: 'column',
  },
  swipeDeleteText: {
    color: '#fff',
    fontSize: 12,
    marginTop: spacing.xs,
    fontWeight: '600',
    fontFamily: getFontFamily('medium'),
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: tabColors.textPrimary,
    flex: 1,
    marginRight: spacing.sm + spacing.xs,
    fontFamily: getFontFamily('bold'),
  },
  cardDateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardDate: {
    fontSize: 14,
    color: tabColors.textSecondary,
    marginLeft: spacing.xs,
    fontFamily: getFontFamily('regular'),
  },
  cardDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  detailItem: {
    alignItems: 'center',
    minWidth: 60,
  },
  detailValue: {
    fontSize: 24,
    fontWeight: '700',
    color: tabColors.accent,
    marginBottom: 2,
    fontFamily: getFontFamily('bold'),
  },
  detailLabel: {
    fontSize: 12,
    color: tabColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: getFontFamily('regular'),
  },
  cardFooter: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: tabColors.border,
    paddingTop: 12,
    marginTop: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  shareActionButton: {
    flex: 1.35,
    paddingHorizontal: spacing.sm,
    backgroundColor: 'rgba(76, 140, 255, 0.08)',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: 'rgba(76, 140, 255, 0.25)',
  },
  actionText: {
    color: tabColors.accent,
    fontSize: 14,
    fontWeight: '500',
    marginLeft: spacing.xs + 2,
    fontFamily: getFontFamily('medium'),
  },
  shareActionTitle: {
    marginLeft: 0,
  },
  shareTextWrapper: {
    marginLeft: spacing.xs + 2,
  },
  actionSubtext: {
    color: tabColors.textSecondary,
    fontSize: 11,
    marginTop: 2,
    fontFamily: getFontFamily('regular'),
  },
  divider: {
    width: 1,
    backgroundColor: tabColors.border,
    marginVertical: 4,
  },
  deleteAction: {
    paddingHorizontal: spacing.sm,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    backgroundColor: tabColors.background,
  },
  emptyIllustration: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(76, 140, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: tabColors.textPrimary,
    marginBottom: spacing.sm,
    textAlign: 'center',
    fontFamily: getFontFamily('bold'),
  },
  emptyDescription: {
    fontSize: 16,
    color: tabColors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
    lineHeight: 24,
    fontFamily: getFontFamily('regular'),
  },
  addFirstButton: {
    backgroundColor: tabColors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + spacing.xs,
    borderRadius: borderRadius.md,
    ...Platform.select({
      web: {
        boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
      },
      default: {
        shadowColor: tabColors.accent,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
      },
    }),
  },
  addFirstButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: getFontFamily('medium'),
  },
  addButton: {
    position: 'absolute',
    right: spacing.lg,
    bottom: 100,
    backgroundColor: tabColors.accent,
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      web: {
        boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
      },
      default: {
        shadowColor: tabColors.accent,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
      },
    }),
  },
});

// Default export to satisfy Expo Router (this file is not a route)
export default null;
