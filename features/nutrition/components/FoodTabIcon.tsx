import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface FoodTabIconProps {
  color: string;
  size: number;
}

// Option 1: Simple combo - leaf with emoji badge
export function FoodTabIcon({ color, size }: FoodTabIconProps) {
  return (
    <View style={styles.container}>
      <Ionicons 
        name="leaf-outline" 
        size={size} 
        color={color}
      />
      <View style={styles.emojiBadge}>
        <Text style={styles.emoji}>🍎</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiBadge: {
    position: 'absolute',
    bottom: -3,
    right: -4,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#050E1F',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#0F2339',
  },
  emoji: {
    fontSize: 8,
    lineHeight: 10,
  },
});
