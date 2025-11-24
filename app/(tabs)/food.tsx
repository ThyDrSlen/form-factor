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
  RefreshControl,
  ScrollView,
  Share,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { FoodEntry, useFood } from '../../contexts/FoodContext';
import { useToast } from '../../contexts/ToastContext';
import { styles } from './styles/_food.styles';

const buildFoodShareMessage = (food: FoodEntry): string => {
  const dateLabel = new Date(food.date).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const macros = [
    typeof food.protein === 'number' ? `${food.protein}g protein` : null,
    typeof food.carbs === 'number' ? `${food.carbs}g carbs` : null,
    typeof food.fat === 'number' ? `${food.fat}g fat` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' • ');

  return [
    `${food.name} (${dateLabel})`,
    typeof food.calories === 'number' ? `${food.calories} kcal` : null,
    macros || null,
    '',
    'Shared from Form Factor',
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n');
};

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

  const handleShareFood = useCallback(
    async (food: FoodEntry) => {
      try {
        const message = buildFoodShareMessage(food);
        await Share.share({ message });
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      } catch (error) {
        console.warn('[Food] Share failed', error);
        showToast('Unable to share meal right now', { type: 'error' });
      }
    },
    [showToast]
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
            <View style={styles.cardHeaderActions}>
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
            <TouchableOpacity
              style={[styles.actionButton, styles.shareActionButton]}
              onPress={() => handleShareFood(item)}
              activeOpacity={0.85}
            >
              <Ionicons name="share-outline" size={18} color="#4C8CFF" />
              <View style={styles.shareTextWrapper}>
                <Text style={[styles.actionText, styles.shareActionTitle]}>Share</Text>
                <Text style={styles.actionSubtext}>Send stats</Text>
              </View>
            </TouchableOpacity>
            <View style={styles.divider} />
            <DeleteAction
              id={item.id}
              onDelete={async (foodId) => handleDeleteFood(foodId, item.name)}
              variant="icon"
              confirmTitle="Delete meal?"
              confirmMessage={`This will permanently remove "${item.name}".`}
              style={styles.deleteAction}
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
            <Ionicons name="nutrition-outline" size={80} color="#E5E5EA" />
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
