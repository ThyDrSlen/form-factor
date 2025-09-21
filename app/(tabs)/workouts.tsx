import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useCallback, useRef } from 'react';
import {
    ActivityIndicator,
    Animated,
    FlatList,
    Platform,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    useWindowDimensions,
    View
} from 'react-native';
import { useWorkouts, type Workout } from '../../contexts/WorkoutsContext';

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList) as unknown as React.ComponentType<React.ComponentProps<typeof Animated.FlatList<Workout>>>;

const CARD_HEIGHT = 140;
const CARD_MARGIN = 12;

export default function WorkoutsScreen() {
  const router = useRouter();
  const { workouts, loading, refreshWorkouts } = useWorkouts();
  const { width } = useWindowDimensions();
  const scrollY = useRef(new Animated.Value(0)).current;
  const refreshing = useRef(false);

  const onRefresh = useCallback(async () => {
    refreshing.current = true;
    await refreshWorkouts();
    refreshing.current = false;
  }, [refreshWorkouts]);

  const handleAddPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    console.log('Navigating to add-workout from workouts tab');
    router.push('/add-workout');
  };

  const renderItem = (info: { item: Workout; index: number }) => {
    const { item, index } = info;
    const inputRange = [
      -1,
      0,
      CARD_HEIGHT * index,
      CARD_HEIGHT * (index + 2),
    ];

    const opacity = scrollY.interpolate({
      inputRange,
      outputRange: [1, 1, 1, 0],
    });

    const scale = scrollY.interpolate({
      inputRange,
      outputRange: [1, 1, 1, 0.9],
    });

    return (
      <Animated.View style={[styles.card, { opacity, transform: [{ scale }] }]}>
        <TouchableOpacity 
          activeOpacity={0.9}
          onPress={() => {
            Haptics.selectionAsync();
            // Navigate to workout detail
          }}
        >
          <LinearGradient
            colors={['#FFFFFF', '#F8F9FF']}
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
              <TouchableOpacity style={styles.actionButton}>
                <Ionicons name="share-outline" size={16} color="#007AFF" />
                <Text style={styles.actionText}>Share</Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>
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
        <AnimatedFlatList
          data={workouts}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: true }
          )}
          scrollEventThrottle={16}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FF',
  },
  loadingContainer: { 
    justifyContent: 'center', 
    alignItems: 'center',
    backgroundColor: '#F8F9FF',
  },
  loadingText: { 
    marginTop: 16, 
    fontSize: 16, 
    color: '#636366',
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif-medium',
  },
  list: { 
    padding: 16,
    paddingBottom: 100,
  },
  card: {
    marginBottom: CARD_MARGIN,
    borderRadius: 16,
    boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
    elevation: 2,
    backgroundColor: 'transparent',
  },
  cardGradient: {
    borderRadius: 16,
    padding: 20,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1C1C1E',
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
    color: '#8E8E93',
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
    color: '#007AFF',
    marginBottom: 2,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif-medium',
  },
  detailLabel: {
    fontSize: 12,
    color: '#8E8E93',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
  },
  cardFooter: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: 'rgba(142, 142, 147, 0.1)',
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
    color: '#007AFF',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 6,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif-medium',
  },
  divider: {
    width: 1,
    backgroundColor: 'rgba(142, 142, 147, 0.1)',
    marginVertical: 4,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#F8F9FF',
  },
  emptyIllustration: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(0, 122, 255, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1C1C1E',
    marginBottom: 8,
    textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif-medium',
  },
  emptyDescription: {
    fontSize: 16,
    color: '#636366',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 24,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
  },
  addFirstButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    boxShadow: '0 4px 10px rgba(0,122,255,0.2)',
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
    bottom: 100, // Position above the tab bar
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
});
