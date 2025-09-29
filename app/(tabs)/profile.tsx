import React, { useMemo, useState } from 'react';
import {
  Alert,
  Image,
  ImageBackground,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, usePathname } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  useFonts,
  Lexend_400Regular,
  Lexend_500Medium,
  Lexend_700Bold,
  Lexend_900Black,
} from '@expo-google-fonts/lexend';
import {
  NotoSans_400Regular,
  NotoSans_500Medium,
  NotoSans_700Bold,
  NotoSans_900Black,
} from '@expo-google-fonts/noto-sans';

import { useAuth } from '../../contexts/AuthContext';
import { useWorkouts } from '../../contexts/WorkoutsContext';
import { supabase } from '../../lib/supabase';
import { ProfileHealth } from '@/components/profile-health/ProfileHealth';
import { useHealthKit } from '@/contexts/HealthKitContext';
import { useUnits } from '@/contexts/UnitsContext';


function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ minWidth: 158, flex: 1, gap: 8, borderRadius: 16, borderWidth: 1, borderColor: '#1B2E4A', backgroundColor: '#0D2036', padding: 24 }}>
      <Text style={{ fontSize: 16, color: '#FFFFFF', fontFamily: 'Lexend_500Medium' }}>
        {label}
      </Text>
      <Text style={{ fontSize: 30, color: '#FFFFFF', fontFamily: 'Lexend_700Bold' }}>
        {value}
      </Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const { workouts } = useWorkouts();
  const { bodyMassKg } = useHealthKit();
  const { weightUnit, toggleWeightUnit, convertWeight, getWeightLabel } = useUnits();
  const router = useRouter();
  const pathname = usePathname();
  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState(
    user?.user_metadata?.full_name || user?.user_metadata?.name || ''
  );
  const [isUpdating, setIsUpdating] = useState(false);

  const [fontsLoaded] = useFonts({
    Lexend_400Regular,
    Lexend_500Medium,
    Lexend_700Bold,
    Lexend_900Black,
    NotoSans_400Regular,
    NotoSans_500Medium,
    NotoSans_700Bold,
    NotoSans_900Black,
  });

  const displayNameFallback = useMemo(() => {
    if (user?.user_metadata?.full_name) return user.user_metadata.full_name;
    if (user?.user_metadata?.name) return user.user_metadata.name;
    return user?.email?.split('@')[0] || 'User';
  }, [user?.email, user?.user_metadata]);

  const totalWorkouts = workouts.length;
  const daysTrained = useMemo(() => {
    if (!workouts.length) return 0;
    const uniqueDays = new Set(
      workouts.map((workout) => {
        const date = new Date(workout.date);
        return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      })
    );
    return uniqueDays.size;
  }, [workouts]);

  const level = Math.max(1, Math.floor(totalWorkouts / 5) + 1);

const avatarUrl = (() => {
  const meta = user?.user_metadata as Record<string, unknown> | undefined;
  if (!meta) return null;
  if (typeof meta['avatar_url'] === 'string') return meta['avatar_url'] as string;
  if (typeof meta['picture'] === 'string') return meta['picture'] as string;
  return null;
})();

  const handleUpdateProfile = async () => {
    if (!displayName.trim()) {
      Alert.alert('Error', 'Please enter a display name');
      return;
    }

    setIsUpdating(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: displayName.trim() },
      });

      if (error) {
        Alert.alert('Error', 'Failed to update profile: ' + error.message);
      } else {
        setIsEditing(false);
      }
    } catch (error) {
      Alert.alert('Error', 'An unexpected error occurred');
    } finally {
      setIsUpdating(false);
    }
  };

  if (!fontsLoaded) return null;

  const resolvedName = isEditing ? displayName : displayNameFallback;
  const headerWeight = bodyMassKg?.kg != null && Number.isFinite(bodyMassKg.kg)
    ? `${Math.round(convertWeight(bodyMassKg.kg))} ${getWeightLabel()}`
    : '—';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#050E1F' }} edges={['left', 'right', 'bottom']}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#050E1F', paddingHorizontal: 16, paddingBottom: 8, paddingTop: 8 }}>
          <View style={{ width: 48 }} />
          <Text style={{ flex: 1, textAlign: 'center', fontSize: 18, color: '#F5F7FF', fontFamily: 'Lexend_700Bold' }}>
            Profile
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity 
              style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, backgroundColor: '#13263C', borderWidth: 1, borderColor: '#1B2E4A' }} 
              onPress={toggleWeightUnit}
              accessibilityRole="button"
              accessibilityLabel={`Switch to ${weightUnit === 'kg' ? 'lbs' : 'kg'}`}
            >
              <Text style={{ fontSize: 12, color: '#4C8CFF', fontFamily: 'Lexend_700Bold' }}>{weightUnit.toUpperCase()}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ height: 40, width: 40, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="button">
              <Ionicons name="settings-outline" size={22} color="#9AACD1" />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 100 }} style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            <LinearGradient
              colors={["#0F2339", "#081526"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ borderRadius: 24, padding: 20 }}
            >
              <View style={{ borderRadius: 24, borderWidth: 1, borderColor: '#1B2E4A', padding: 20 }}>
                <View style={{ flexDirection: 'column', gap: 24 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                    {avatarUrl ? (
                      <Image source={{ uri: avatarUrl }} style={{ height: 96, width: 96, borderRadius: 48 }} />
                    ) : (
                      <View style={{ height: 96, width: 96, alignItems: 'center', justifyContent: 'center', borderRadius: 48, backgroundColor: '#4C8CFF' }}>
                        <Ionicons name="person" size={48} color="#F5F7FF" />
                      </View>
                    )}
                    <View style={{ gap: 4 }}>
                      <Text style={{ fontSize: 20, color: '#F5F7FF', fontFamily: 'Lexend_700Bold' }}>
                        {resolvedName}
                      </Text>
                      <Text style={{ fontSize: 14, color: '#6781A6', fontFamily: 'NotoSans_500Medium' }}>
                        Level {level}
                      </Text>
                      <Text style={{ fontSize: 14, color: '#6781A6', fontFamily: 'NotoSans_500Medium' }}>
                        Weight: {headerWeight}
                      </Text>
                    </View>
                  </View>

                  {isEditing ? (
                    <View style={{ width: '100%', gap: 12 }}>
                      <TextInput
                        style={{ borderRadius: 16, borderWidth: 1, borderColor: '#1B2E4A', backgroundColor: '#0D2036', paddingHorizontal: 16, paddingVertical: 12, color: '#F5F7FF', fontFamily: 'NotoSans_500Medium' }}
                        value={displayName}
                        onChangeText={setDisplayName}
                        placeholder="Display name"
                        placeholderTextColor="#5F789A"
                        autoFocus
                      />
                      <View style={{ flexDirection: 'row', gap: 12 }}>
                        <TouchableOpacity
                          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 24, borderWidth: 1, borderColor: '#1B2E4A', backgroundColor: '#13263C', paddingVertical: 12 }}
                          onPress={() => {
                            setIsEditing(false);
                            setDisplayName(displayNameFallback);
                          }}
                        >
                          <Text style={{ fontSize: 14, color: '#F5F7FF', fontFamily: 'NotoSans_500Medium' }}>
                            Cancel
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: '#4C8CFF', paddingVertical: 12 }}
                          onPress={handleUpdateProfile}
                          disabled={isUpdating}
                        >
                          <Text style={{ fontSize: 14, color: '#FFFFFF', fontFamily: 'NotoSans_700Bold' }}>
                            {isUpdating ? 'Saving…' : 'Save'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        style={{ alignItems: 'center', justifyContent: 'center', borderRadius: 24, borderWidth: 1, borderColor: '#1B2E4A', backgroundColor: '#13263C', paddingHorizontal: 16, paddingVertical: 8 }}
                        onPress={() => setIsEditing(true)}
                      >
                        <Text style={{ fontSize: 14, color: '#F5F7FF', fontFamily: 'NotoSans_500Medium' }}>
                          Edit Profile
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
            </LinearGradient>
          </View>

          <Text style={{ paddingHorizontal: 16, paddingBottom: 12, paddingTop: 24, fontSize: 22, color: '#FFFFFF', fontFamily: 'Lexend_700Bold' }}>
            Your Week
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingHorizontal: 16 }}>
            <StatTile label="Days Trained" value={daysTrained} />
            <StatTile label="Total Workouts" value={totalWorkouts} />
          </View>

          <View style={{ paddingHorizontal: 16 }}>
            <ProfileHealth />
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingHorizontal: 16, paddingVertical: 20, marginTop: 16 }}>
            <Pressable
              style={{ flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: '#4C8CFF', paddingVertical: 12 }}
              onPress={() => router.push('/add-workout')}
            >
              <Text style={{ fontSize: 14, color: '#FFFFFF', fontFamily: 'Lexend_700Bold' }}>
                Start Workout
              </Text>
            </Pressable>
            <Pressable
              style={{ flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: '#13263C', paddingVertical: 12 }}
              onPress={() => router.push('/add-food')}
            >
              <Text style={{ fontSize: 14, color: '#FFFFFF', fontFamily: 'Lexend_700Bold' }}>
                Log Food
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
