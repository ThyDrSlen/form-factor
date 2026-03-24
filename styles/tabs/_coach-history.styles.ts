import { StyleSheet } from 'react-native';
import { spacing, borderRadius } from './_theme-constants';
import { tabColors } from './_tab-theme';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tabColors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: tabColors.border,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Lexend_500Medium',
    color: tabColors.textPrimary,
  },
  headerButton: {
    padding: spacing.sm,
  },
  card: {
    backgroundColor: tabColors.overlay,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: tabColors.border,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  cardDate: {
    fontSize: 13,
    fontFamily: 'Lexend_500Medium',
    color: tabColors.textPrimary,
  },
  cardTurnBadge: {
    backgroundColor: tabColors.accentSurface,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  cardTurnText: {
    fontSize: 11,
    color: tabColors.accent,
  },
  cardPreview: {
    fontSize: 14,
    color: tabColors.textSecondary,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  cardTime: {
    fontSize: 12,
    color: tabColors.textSecondary,
    marginTop: spacing.xs,
  },
  loadMoreButton: {
    margin: spacing.md,
    padding: spacing.md,
    backgroundColor: tabColors.overlay,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: tabColors.border,
    alignItems: 'center',
  },
  loadMoreText: {
    fontSize: 14,
    color: tabColors.accent,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: 'Lexend_500Medium',
    color: tabColors.textPrimary,
    marginTop: spacing.md,
  },
  emptySubtitle: {
    fontSize: 14,
    color: tabColors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
});
