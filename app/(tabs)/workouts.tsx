import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { DeleteAction } from '@/components';
import { errorWithTs, logWithTs, warnWithTs } from '@/lib/logger';
import React, { useCallback, useRef } from 'react';
import {
    ActivityIndicator,
    FlatList,
    RefreshControl,
    ScrollView,
    Share,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useWorkouts, type Workout } from '../../contexts/WorkoutsContext';
import { useToast } from '../../contexts/ToastContext';
import { styles } from '../../styles/tabs/_workouts.styles';

const buildWorkoutShareMessage = (workout: Workout): string => {
  const workoutDate = workout.date ? new Date(workout.date) : null;
  const lines: string[] = [
    `Workout: ${workout.exercise}`,
    workoutDate
      ? `Date: ${workoutDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : null,
    `Sets: ${workout.sets}`,
    typeof workout.reps === 'number' && workout.reps > 0 ? `Reps: ${workout.reps}` : null,
    typeof workout.weight === 'number' && workout.weight > 0 ? `Weight: ${workout.weight} lbs` : null,
    typeof workout.duration === 'number' && workout.duration > 0 ? `Duration: ${workout.duration} min` : null,
  ].filter((line): line is string => Boolean(line));

  return [...lines, '', 'Shared from Form Factor'].join('\n');
};

export default function WorkoutsScreen() {
  const router = useRouter();
  const { workouts, loading, refreshWorkouts, deleteWorkout } = useWorkouts();
  const { show: showToast } = useToast();
  const refreshing = useRef(false);
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());

  const onRefresh = useCallback(async () => {
    refreshing.current = true;
    await refreshWorkouts();
    refreshing.current = false;
  }, [refreshWorkouts]);

  const handleAddPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    logWithTs('Navigating to add-workout modal from workouts tab');
    router.push('/(modals)/add-workout');
  };

  const handleDeleteWorkout = useCallback(
    async (id: string, title: string) => {
      try {
        // Close swipeable before delete
        swipeableRefs.current.get(id)?.close();
        await deleteWorkout(id);
        showToast(`Removed ${title}`, { type: 'info' });
        // Clean up ref
        swipeableRefs.current.delete(id);
      } catch (error) {
        errorWithTs('[Workouts] delete failed', error);
        showToast('Failed to delete workout', { type: 'error' });
      }
    },
    [deleteWorkout, showToast]
  );

  const renderRightActions = (id: string, title: string) => (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={() => handleDeleteWorkout(id, title)}
      style={styles.swipeDelete}
    >
      <Ionicons name="trash-outline" size={20} color="#fff" />
      <Text style={styles.swipeDeleteText}>Delete</Text>
    </TouchableOpacity>
  );

  const handleShareWorkout = useCallback(
    async (workout: Workout) => {
      try {
        const message = buildWorkoutShareMessage(workout);
        await Share.share({ message });
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      } catch (error) {
        warnWithTs('[Workouts] share failed', error);
        showToast('Unable to share this workout right now.', { type: 'error' });
      }
    },
    [showToast]
  );

  const renderItem = (info: { item: Workout }) => {
    const { item } = info;
    return (
      <Swipeable 
        ref={(ref) => {
          if (ref) {
            swipeableRefs.current.set(item.id, ref);
          }
        }}
        renderRightActions={() => renderRightActions(item.id, item.exercise)}
      >
        <View style={styles.card}>
          <TouchableOpacity 
            activeOpacity={0.9}
            onPress={() => {
              Haptics.selectionAsync();
              // Navigate to workout detail
            }}
          >
          <LinearGradient
            colors={['#0F2339', '#081526']}
            style={styles.cardGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.exercise}
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
                <Text style={styles.detailValue}>{item.sets || '0'}</Text>
                <Text style={styles.detailLabel}>Sets</Text>
              </View>
              
              {item.reps && (
                <View style={styles.detailItem}>
                  <Text style={styles.detailValue}>{item.reps}</Text>
                  <Text style={styles.detailLabel}>Reps</Text>
                </View>
              )}
              
              {item.weight && (
                <View style={styles.detailItem}>
                  <Text style={styles.detailValue}>{item.weight}</Text>
                  <Text style={styles.detailLabel}>lbs</Text>
                </View>
              )}
              
              {item.duration && (
                <View style={styles.detailItem}>
                  <Text style={styles.detailValue}>{item.duration}</Text>
                  <Text style={styles.detailLabel}>min</Text>
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
                onPress={() => handleShareWorkout(item)}
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
                onDelete={async (workoutId) => handleDeleteWorkout(workoutId, item.exercise)}
                variant="icon"
                confirmTitle="Delete workout?"
                confirmMessage={`This will permanently remove \"${item.exercise}\".`}
                style={styles.deleteAction}
              />
            </View>
          </LinearGradient>
          </TouchableOpacity>
        </View>
      </Swipeable>
    );
  };

  if (loading && !workouts.length) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading your workouts</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {workouts.length === 0 ? (
        <ScrollView 
          contentContainerStyle={styles.emptyState}
          refreshControl={
            <RefreshControl
              refreshing={refreshing.current}
              onRefresh={onRefresh}
              tintColor="#007AFF"
              colors={['#007AFF']}
            />
          }
        >
          <View style={styles.emptyIllustration}>
            <Ionicons name="barbell-outline" size={80} color="#E5E5EA" />
          </View>
          <Text style={styles.emptyTitle}>No Workouts Yet</Text>
          <Text style={styles.emptyDescription}>
            Track your first workout to see your progress over time
          </Text>
          <TouchableOpacity 
            style={styles.addFirstButton}
            onPress={handleAddPress}
          >
            <Text style={styles.addFirstButtonText}>Add Workout</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <FlatList
          data={workouts}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing.current}
              onRefresh={onRefresh}
              tintColor="#007AFF"
              colors={['#007AFF']}
            />
          }
        />
      )}
      <TouchableOpacity 
        style={styles.addButton} 
        onPress={handleAddPress}
        activeOpacity={0.9}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}
