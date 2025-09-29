import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Swipeable } from 'react-native-gesture-handler';
import React, { useCallback } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { FoodEntry, useFood } from '../../contexts/FoodContext';
import { useToast } from '../../contexts/ToastContext';

export default function FoodScreen() {
  const router = useRouter();
  const { foods, deleteFood, refreshFoods, loading } = useFood();
  const { show: showToast } = useToast();

  const handleDeleteFood = useCallback(
    async (id: string, name: string) => {
      try {
        await deleteFood(id);
        showToast(`Removed ${name}`, { type: 'info' });
      } catch (error) {
        console.error('[Food] delete failed', error);
        showToast('Failed to delete entry', { type: 'error' });
      }
    },
    [deleteFood, showToast]
  );

  const renderRightActions = (id: string) => (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={() => handleDeleteFood(id, foods.find((f) => f.id === id)?.name ?? 'meal')}
      style={styles.swipeDelete}
    >
      <Ionicons name="trash-outline" size={20} color="#fff" />
      <Text style={styles.swipeDeleteText}>Delete</Text>
    </TouchableOpacity>
  );

  const renderItem = ({ item }: { item: FoodEntry }) => (
    <Swipeable renderRightActions={() => renderRightActions(item.id)}>
      <TouchableOpacity activeOpacity={0.9} style={styles.cardWrapper}>
        <LinearGradient
          colors={['#0F2339', '#081526']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.cardGradient}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.name}
            </Text>
            <View style={styles.cardDateContainer}>
              <Ionicons name="time-outline" size={14} color="#8E8E93" />
              <Text style={styles.cardDate}>
                {new Date(item.date).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </Text>
            </View>
          </View>

          <View style={styles.cardDetails}>
            <View style={styles.detailItem}>
              <Text style={styles.detailValue}>{item.calories}</Text>
              <Text style={styles.detailLabel}>kcal</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.detailItem}>
              <Text style={styles.detailValue}>{item.protein ?? '—'}</Text>
              <Text style={styles.detailLabel}>Protein</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.detailItem}>
              <Text style={styles.detailValue}>{item.carbs ?? '—'}</Text>
              <Text style={styles.detailLabel}>Carbs</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.detailItem}>
              <Text style={styles.detailValue}>{item.fat ?? '—'}</Text>
              <Text style={styles.detailLabel}>Fat</Text>
            </View>
          </View>
        </LinearGradient>
      </TouchableOpacity>
    </Swipeable>
  );

  return (
    <View style={styles.container}>
      {foods.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="fast-food-outline" size={64} color="#999" />
          <Text style={styles.emptyText}>No meals logged yet</Text>
          <Text style={styles.emptySubtext}>Tap + to add your first meal</Text>
        </View>
      ) : (
        <FlatList
          data={foods}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={refreshFoods}
              tintColor="#4C8CFF"
              colors={['#4C8CFF']}
            />
          }
        />
      )}
      <TouchableOpacity 
        style={styles.addButton} 
        onPress={() => {
          console.log('Navigating to add-food modal from food tab');
          router.push('/(modals)/add-food');
        }}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050E1F', padding: 16 },
  list: { paddingBottom: 120, gap: 12 },
  cardWrapper: {
    marginBottom: 12,
    borderRadius: 24,
    overflow: 'hidden',
  },
  cardGradient: {
    borderRadius: 24,
    padding: 20,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  swipeDelete: {
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
    width: 88,
    borderRadius: 24,
    marginBottom: 12,
    flexDirection: 'column',
  },
  swipeDeleteText: {
    color: '#fff',
    fontSize: 12,
    marginTop: 4,
    fontWeight: '600',
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#F5F7FF', flex: 1 },
  cardDateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardDate: {
    fontSize: 12,
    color: '#8E8E93',
  },
  cardDetails: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#1B2E4A',
    borderRadius: 12,
    paddingVertical: 10,
  },
  detailValue: {
    fontSize: 18,
    color: '#F5F7FF',
    fontWeight: '700',
  },
  detailLabel: {
    fontSize: 12,
    color: '#8E8E93',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: 32,
    backgroundColor: '#1B2E4A',
    opacity: 0.6,
  },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 18, color: '#9AACD1', marginTop: 16, fontWeight: '600' },
  emptySubtext: { fontSize: 14, color: '#6781A6', marginTop: 8, textAlign: 'center' },
  addButton: {
    position: 'absolute',
    right: 20,
    bottom: 100,
    backgroundColor: '#4C8CFF',
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#4C8CFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
});
