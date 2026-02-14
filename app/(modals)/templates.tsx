/**
 * TemplatesScreen
 *
 * Browse saved workout templates and start sessions from them.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { localDB } from '@/lib/services/database/local-db';
import { tabColors } from '@/styles/tabs/_tab-theme';
import type { WorkoutTemplate } from '@/lib/types/workout-session';

interface TemplateSummary extends WorkoutTemplate {
  exercise_count: number;
}

export default function TemplatesScreen() {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    const db = localDB.db;
    if (!db) {
      setLoading(false);
      return;
    }

    try {
      const rows = await db.getAllAsync<TemplateSummary>(`
        SELECT
          wt.*,
          (SELECT COUNT(*) FROM workout_template_exercises wte
           WHERE wte.template_id = wt.id AND wte.deleted = 0) as exercise_count
        FROM workout_templates wt
        WHERE wt.deleted = 0
        ORDER BY wt.updated_at DESC
      `);
      setTemplates(rows);
    } catch (error) {
      console.error('[Templates] Failed to load templates:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStartSession = useCallback(
    (templateId: string, goalProfile: string) => {
      router.push(
        `/(modals)/workout-session?templateId=${templateId}&goalProfile=${goalProfile}` as any,
      );
    },
    [router],
  );

  const handleEditTemplate = useCallback(
    (templateId: string) => {
      router.push(
        `/(modals)/template-builder?templateId=${templateId}` as any,
      );
    },
    [router],
  );

  const handleNewTemplate = useCallback(() => {
    router.push('/(modals)/template-builder');
  }, [router]);

  const renderItem = useCallback(
    ({ item }: { item: TemplateSummary }) => (
      <View style={templateStyles.card}>
        <TouchableOpacity
          style={templateStyles.cardContent}
          onPress={() => handleStartSession(item.id, item.goal_profile)}
        >
          <Text style={templateStyles.cardName}>{item.name}</Text>
          {item.description && (
            <Text style={templateStyles.cardDesc} numberOfLines={1}>
              {item.description}
            </Text>
          )}
          <View style={templateStyles.cardStats}>
            <Text style={templateStyles.cardStat}>
              {item.exercise_count} exercise{item.exercise_count !== 1 ? 's' : ''}
            </Text>
            <Text style={templateStyles.cardStatSep}>&middot;</Text>
            <Text style={[templateStyles.cardStat, { color: tabColors.accent }]}>
              {item.goal_profile}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={templateStyles.editBtn}
          onPress={() => handleEditTemplate(item.id)}
        >
          <Ionicons name="create-outline" size={18} color={tabColors.textSecondary} />
        </TouchableOpacity>
      </View>
    ),
    [handleStartSession, handleEditTemplate],
  );

  return (
    <SafeAreaView style={templateStyles.container} edges={['top']}>
      {/* Header */}
      <View style={templateStyles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={24} color={tabColors.textPrimary} />
        </TouchableOpacity>
        <Text style={templateStyles.headerTitle}>Templates</Text>
        <TouchableOpacity onPress={handleNewTemplate} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="add" size={26} color={tabColors.accent} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={tabColors.accent} />
        </View>
      ) : templates.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Ionicons name="clipboard-outline" size={48} color={tabColors.textSecondary} />
          <Text style={templateStyles.emptyText}>No templates yet</Text>
          <Text style={templateStyles.emptySubtext}>
            Create a template to quickly start sessions with your favorite routines
          </Text>
          <TouchableOpacity style={templateStyles.createBtn} onPress={handleNewTemplate}>
            <Text style={templateStyles.createBtnText}>Create Template</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={templates}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const templateStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tabColors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tabColors.border,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Lexend_700Bold',
    color: tabColors.textPrimary,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: 'rgba(15, 35, 57, 0.85)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(27, 46, 74, 0.6)',
    marginBottom: 12,
    overflow: 'hidden',
  },
  cardContent: {
    flex: 1,
    padding: 16,
  },
  cardName: {
    fontSize: 16,
    fontFamily: 'Lexend_700Bold',
    color: tabColors.textPrimary,
  },
  cardDesc: {
    fontSize: 13,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textSecondary,
    marginTop: 4,
  },
  cardStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 6,
  },
  cardStat: {
    fontSize: 12,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textSecondary,
  },
  cardStatSep: {
    fontSize: 12,
    color: tabColors.textSecondary,
  },
  editBtn: {
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: tabColors.border,
  },
  emptyText: {
    fontSize: 16,
    fontFamily: 'Lexend_500Medium',
    color: tabColors.textPrimary,
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },
  createBtn: {
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: tabColors.accent,
  },
  createBtnText: {
    fontSize: 15,
    fontFamily: 'Lexend_700Bold',
    color: '#fff',
  },
});
