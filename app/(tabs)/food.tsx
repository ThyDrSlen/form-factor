import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { DeleteAction } from '@/components';
import { Swipeable } from 'react-native-gesture-handler';
import React, { useCallback, useRef } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
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
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());

  const handleAddPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    console.log('Navigating to add-food modal from food tab');
    router.push('/(modals)/add-food');
  };

  const handleDeleteFood = useCallback(
    async (id: string, name: string) => {
      try {
        // Close swipeable before delete
        swipeableRefs.current.get(id)?.close();
        await deleteFood(id);
        showToast(`Removed ${name}`, { type: 'info' });
        // Clean up ref
        swipeableRefs.current.delete(id);
      } catch (error) {
        console.error('[Food] delete failed', error);
        showToast('Failed to delete entry', { type: 'error' });
      }
    },
    [deleteFood, showToast]
  );

  const renderRightActions = (id: string, name: string) => (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={() => handleDeleteFood(id, name)}
      style={styles.swipeDelete}
    >
      <Ionicons name="trash-outline" size={20} color="#fff" />
      <Text style={styles.swipeDeleteText}>Delete</Text>
    </TouchableOpacity>
  );

  const renderItem = ({ item }: { item: FoodEntry }) => (
    <Swipeable 
      ref={(ref) => {
        if (ref) {
          swipeableRefs.current.set(item.id, ref);
        }
      }}
      renderRightActions={() => renderRightActions(item.id, item.name)}
    >
      <TouchableOpacity 
        activeOpacity={0.9}
        onPress={() => {
          Haptics.selectionAsync();
          // Navigate to food detail
        }}
        style={styles.cardWrapper}
      >
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
            
            {item.protein && (
              <View style={styles.detailItem}>
                <Text style={styles.detailValue}>{item.protein}</Text>
                <Text style={styles.detailLabel}>Protein</Text>
              </View>
            )}
            
            {item.carbs && (
              <View style={styles.detailItem}>
                <Text style={styles.detailValue}>{item.carbs}</Text>
                <Text style={styles.detailLabel}>Carbs</Text>
              </View>
            )}
            
            {item.fat && (
              <View style={styles.detailItem}>
                <Text style={styles.detailValue}>{item.fat}</Text>
                <Text style={styles.detailLabel}>Fat</Text>
              </View>
            )}
          </View>
          
          <View style={styles.cardFooter}>
            <TouchableOpacity style={styles.actionButton}>
              <Ionicons name="eye-outline" size={16} color="#007AFF" />
              <Text style={styles.actionText}>View</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.actionButton}>
              <Ionicons name="share-outline" size={16} color="#007AFF" />
              <Text style={styles.actionText}>Share</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <DeleteAction
              id={item.id}
              onDelete={async (foodId) => handleDeleteFood(foodId, item.name)}
              variant="icon"
              confirmTitle="Delete meal?"
              confirmMessage={`This will permanently remove "${item.name}".`}
              style={{ paddingHorizontal: 8 }}
            />
          </View>
        </LinearGradient>
      </TouchableOpacity>
    </Swipeable>
  );

  if (loading && !foods.length) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading your meals</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {foods.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyState}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={refreshFoods}
              tintColor="#007AFF"
              colors={['#007AFF']}
            />
          }
        >
          <View style={styles.emptyIllustration}>
            <Ionicons name="fast-food-outline" size={80} color="#E5E5EA" />
          </View>
          <Text style={styles.emptyTitle}>No Meals Yet</Text>
          <Text style={styles.emptyDescription}>
            Log your first meal to start tracking your nutrition
          </Text>
          <TouchableOpacity
            style={styles.addFirstButton}
            onPress={handleAddPress}
          >
            <Text style={styles.addFirstButtonText}>Add Meal</Text>
          </TouchableOpacity>
        </ScrollView>
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
              tintColor="#007AFF"
              colors={['#007AFF']}
            />
          }
        />
      )}
      <TouchableOpacity 
        style={styles.addButton} 
        onPress={handleAddPress}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#050E1F',
  },
  loadingContainer: { 
    justifyContent: 'center', 
    alignItems: 'center',
    backgroundColor: '#050E1F',
  },
  loadingText: { 
    marginTop: 16, 
    fontSize: 16, 
    color: '#9AACD1',
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif-medium',
  },
  list: { 
    padding: 16,
    paddingBottom: 100,
  },
  cardWrapper: {
    marginBottom: 12,
    borderRadius: 16,
    overflow: 'hidden',
  },
  cardGradient: {
    borderRadius: 16,
    padding: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  swipeDelete: {
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
    width: 88,
    borderRadius: 16,
    marginBottom: 12,
    flexDirection: 'column',
  },
  swipeDeleteText: {
    color: '#fff',
    fontSize: 12,
    marginTop: 4,
    fontWeight: '600',
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F5F7FF',
    flex: 1,
    marginRight: 12,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif-medium',
  },
  cardDateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardDate: {
    fontSize: 14,
    color: '#9AACD1',
    marginLeft: 4,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
  },
  cardDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  detailItem: {
    alignItems: 'center',
    minWidth: 60,
  },
  detailValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#4C8CFF',
    marginBottom: 2,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif-medium',
  },
  detailLabel: {
    fontSize: 12,
    color: '#9AACD1',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
  },
  cardFooter: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#1B2E4A',
    paddingTop: 12,
    marginTop: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
  },
  actionText: {
    color: '#4C8CFF',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 6,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif-medium',
  },
  divider: {
    width: 1,
    backgroundColor: '#1B2E4A',
    marginVertical: 4,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#050E1F',
  },
  emptyIllustration: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(76, 140, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F5F7FF',
    marginBottom: 8,
    textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif-medium',
  },
  emptyDescription: {
    fontSize: 16,
    color: '#9AACD1',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 24,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
  },
  addFirstButton: {
    backgroundColor: '#4C8CFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: '#4C8CFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  addFirstButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif-medium',
  },
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
