import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FoodEntry, useFood } from '../../contexts/FoodContext';

export default function FoodScreen() {
  const router = useRouter();
  const { foods } = useFood();

  const renderItem = ({ item }: { item: FoodEntry }) => (
    <TouchableOpacity style={styles.item}>
      <Text style={styles.itemName}>{item.name}</Text>
      <Text style={styles.itemCalories}>{item.calories} kcal</Text>
      <Text style={styles.itemDate}>{new Date(item.date).toLocaleDateString()}</Text>
    </TouchableOpacity>
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
        />
      )}
      <TouchableOpacity 
        style={styles.addButton} 
        onPress={() => {
          console.log('Navigating to add-food from food tab');
          router.push('/add-food');
        }}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FF', padding: 16 },
  list: { paddingBottom: 100 },
  item: { 
    padding: 16, 
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  itemName: { fontSize: 16, fontWeight: '500', color: '#1C1C1E' },
  itemCalories: { fontSize: 14, color: '#636366', marginTop: 4 },
  itemDate: { fontSize: 12, color: '#8E8E93', marginTop: 2 },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 18, color: '#636366', marginTop: 16, fontWeight: '600' },
  emptySubtext: { fontSize: 14, color: '#8E8E93', marginTop: 8, textAlign: 'center' },
  addButton: {
    position: 'absolute',
    right: 20,
    bottom: 100, // Position above the tab bar
    backgroundColor: '#007AFF',
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
});
