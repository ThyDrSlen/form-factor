import { StyleSheet, Dimensions } from 'react-native';
import { tabColors } from './tabs/_tab-theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export const colors = {
  ...tabColors,
  warmup: '#FFB800',
  dropset: '#FF8C00',
  amrap: '#FF4C8C',
  cardSurface: 'rgba(15, 35, 57, 0.85)',
  cardBorder: 'rgba(27, 46, 74, 0.6)',
  restActive: '#3CC8A9',
  completedBg: 'rgba(60, 200, 169, 0.1)',
  completedBorder: 'rgba(60, 200, 169, 0.3)',
};

export const sessionStyles = StyleSheet.create({
  // Screen
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingBottom: 120,
    paddingHorizontal: 16,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  finishButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Lexend_700Bold',
    color: colors.textPrimary,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accentSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Timer Pill
  timerPill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(60, 200, 169, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(60, 200, 169, 0.3)',
    marginTop: 8,
    marginBottom: 4,
  },
  timerPillText: {
    fontSize: 16,
    fontFamily: 'Lexend_700Bold',
    color: colors.restActive,
  },
  timerPillInactive: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.accentSurfaceBorder,
  },
  timerPillTextInactive: {
    color: colors.accent,
  },

  // Session Meta Card
  metaCard: {
    backgroundColor: colors.cardSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginTop: 12,
    marginBottom: 16,
    padding: 16,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  metaRowLast: {
    borderBottomWidth: 0,
  },
  metaLabel: {
    fontSize: 14,
    fontFamily: 'Lexend_400Regular',
    color: colors.textSecondary,
  },
  metaValue: {
    fontSize: 14,
    fontFamily: 'Lexend_500Medium',
    color: colors.textPrimary,
  },
  metaInput: {
    fontSize: 14,
    fontFamily: 'Lexend_500Medium',
    color: colors.accent,
    textAlign: 'right',
    minWidth: 80,
    padding: 0,
  },

  // Exercise Card
  exerciseCard: {
    backgroundColor: colors.cardSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginBottom: 16,
    overflow: 'hidden',
  },
  exerciseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  exerciseName: {
    fontSize: 16,
    fontFamily: 'Lexend_700Bold',
    color: colors.textPrimary,
    flex: 1,
  },
  exerciseMenuBtn: {
    padding: 4,
  },

  // Set Row
  setRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  setRowHeaderLabel: {
    fontSize: 11,
    fontFamily: 'Lexend_500Medium',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  setRowCompleted: {
    backgroundColor: colors.completedBg,
  },
  setNumberCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  setNumberText: {
    fontSize: 12,
    fontFamily: 'Lexend_700Bold',
    color: '#fff',
  },
  setColumn: {
    flex: 1,
    alignItems: 'center',
  },
  setColumnLabel: {
    fontSize: 10,
    fontFamily: 'Lexend_400Regular',
    color: colors.textSecondary,
    marginBottom: 2,
  },
  setInput: {
    fontSize: 16,
    fontFamily: 'Lexend_700Bold',
    color: colors.textPrimary,
    textAlign: 'center',
    minWidth: 50,
    padding: 0,
  },
  setNotesColumn: {
    flex: 1,
    alignItems: 'center',
  },
  setNotesText: {
    fontSize: 12,
    fontFamily: 'Lexend_400Regular',
    color: colors.textSecondary,
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  checkboxChecked: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },

  // Add Set / Exercise Buttons
  addSetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  addSetText: {
    fontSize: 14,
    fontFamily: 'Lexend_500Medium',
    color: colors.accent,
  },
  addExerciseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    marginTop: 8,
    marginBottom: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accentSurfaceBorder,
    borderStyle: 'dashed',
  },
  addExerciseText: {
    fontSize: 15,
    fontFamily: 'Lexend_500Medium',
    color: colors.accent,
  },

  // Bottom Sheets
  sheetContainer: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  sheetHandle: {
    backgroundColor: colors.textSecondary,
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 14,
    fontFamily: 'Lexend_500Medium',
    color: colors.textSecondary,
    marginBottom: 12,
  },
  sheetSection: {
    marginBottom: 20,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: 'rgba(15, 35, 57, 0.8)',
    borderRadius: 10,
    padding: 3,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  segmentButtonActive: {
    backgroundColor: colors.accent,
  },
  segmentText: {
    fontSize: 13,
    fontFamily: 'Lexend_500Medium',
    color: colors.textSecondary,
  },
  segmentTextActive: {
    color: '#fff',
  },
  copyRow: {
    flexDirection: 'row',
    gap: 12,
  },
  copyButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(15, 35, 57, 0.8)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  copyButtonText: {
    fontSize: 13,
    fontFamily: 'Lexend_500Medium',
    color: colors.textPrimary,
  },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  deleteText: {
    fontSize: 15,
    fontFamily: 'Lexend_500Medium',
    color: colors.error,
  },

  // Rest Timer Sheet
  restTimerContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  restTimerDisplay: {
    fontSize: 56,
    fontFamily: 'Lexend_700Bold',
    color: colors.restActive,
    marginBottom: 8,
  },
  restTimerLabel: {
    fontSize: 14,
    fontFamily: 'Lexend_400Regular',
    color: colors.textSecondary,
    marginBottom: 24,
  },
  restTimerButtons: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  restTimerBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(15, 35, 57, 0.8)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  restTimerBtnText: {
    fontSize: 14,
    fontFamily: 'Lexend_500Medium',
    color: colors.textPrimary,
  },
  restTimerSkipBtn: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  restTimerSkipText: {
    fontSize: 15,
    fontFamily: 'Lexend_700Bold',
    color: '#fff',
  },
  nextUpContainer: {
    marginTop: 16,
    alignItems: 'center',
  },
  nextUpLabel: {
    fontSize: 12,
    fontFamily: 'Lexend_400Regular',
    color: colors.textSecondary,
    marginBottom: 4,
  },
  nextUpText: {
    fontSize: 14,
    fontFamily: 'Lexend_500Medium',
    color: colors.textPrimary,
  },

  // Exercise Picker
  pickerContainer: {
    flex: 1,
  },
  pickerSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 35, 57, 0.8)',
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickerSearchInput: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    fontSize: 14,
    fontFamily: 'Lexend_400Regular',
    color: colors.textPrimary,
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pickerItemName: {
    fontSize: 15,
    fontFamily: 'Lexend_500Medium',
    color: colors.textPrimary,
  },
  pickerItemCategory: {
    fontSize: 12,
    fontFamily: 'Lexend_400Regular',
    color: colors.textSecondary,
  },
  pickerCustomBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pickerCustomText: {
    fontSize: 14,
    fontFamily: 'Lexend_500Medium',
    color: colors.accent,
  },
});
