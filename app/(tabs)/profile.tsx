import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, Share, Modal, TextInput, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/AuthContext';
import { HealthTrendsView } from '@/components/dashboard-health/HealthTrendsView';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { syncService } from '@/lib/services/database/sync-service';
import { localDB } from '@/lib/services/database/local-db';
import { fixInvalidUUIDs } from '@/scripts/fix-invalid-uuids';
import { useDebugInfo } from '@/hooks/use-debug-info';
import { styles } from './styles/_profile.styles';

export default function ProfileScreen() {
  const { user, signOut, updateProfile } = useAuth();
  const [isFixing, setIsFixing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isEditProfileVisible, setIsEditProfileVisible] = useState(false);
  const [fullName, setFullName] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const { debugInfo, loading: debugLoading, refresh: refreshDebugInfo } = useDebugInfo();
  const currentName = user?.user_metadata?.full_name || user?.user_metadata?.name || '';
  const memberSinceYear = user?.created_at ? new Date(user.created_at).getFullYear() : new Date().getFullYear();
  const displayName = currentName || user?.email?.split('@')[0] || 'User';
  const displayInitial = (displayName || 'U').charAt(0).toUpperCase();

  const handleSignOut = async () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await signOut();
              router.replace('/(auth)/sign-in');
            } catch (error) {
              console.error('Error signing out:', error);
            }
          },
        },
      ]
    );
  };

  const handleFixSync = async () => {
    Alert.alert(
      'Fix Sync Issues',
      'This will remove corrupted data and resync. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Fix Now',
          onPress: async () => {
            setIsFixing(true);
            try {
              const result = await fixInvalidUUIDs();
              await refreshDebugInfo();
              if (result.success) {
                Alert.alert(
                  '✅ Sync Fixed!',
                  `Removed ${result.workoutsRemoved} invalid workouts\n` +
                  `Removed ${result.foodsRemoved} invalid foods\n` +
                  `Cleared ${result.queueCleared} queue items\n\n` +
                  `All new data will sync properly.`
                );
              } else {
                Alert.alert('Error', result.error || 'Failed to fix sync');
              }
            } catch {
              Alert.alert('Error', 'Failed to fix sync issues');
            } finally {
              setIsFixing(false);
            }
          },
        },
      ]
    );
  };

  const handleForceSync = async () => {
    setIsSyncing(true);
    try {
      await syncService.fullSync();
      await refreshDebugInfo();
      Alert.alert('✅ Sync Complete', 'All data has been synchronized');
    } catch {
      Alert.alert('Error', 'Failed to sync data');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleClearDatabase = async () => {
    Alert.alert(
      '⚠️ Clear All Data',
      'This will delete ALL local data. Data on server will be preserved. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            setIsClearing(true);
            try {
              await localDB.clearAllData();
              await refreshDebugInfo();
              Alert.alert('✅ Cleared', 'All local data has been cleared');
            } catch {
              Alert.alert('Error', 'Failed to clear data');
            } finally {
              setIsClearing(false);
            }
          },
        },
      ]
    );
  };

  const handleViewSyncQueue = async () => {
    try {
      const queue = await localDB.getSyncQueue();
      if (queue.length === 0) {
        Alert.alert('Sync Queue', 'Queue is empty ✅');
        return;
      }
      
      const queueDetails = queue.map((item: any, idx: number) => 
        `${idx + 1}. ${item.table_name} ${item.operation} (retries: ${item.retry_count})`
      ).join('\n');
      
      Alert.alert(
        `Sync Queue (${queue.length} items)`,
        queueDetails,
        [{ text: 'OK' }]
      );
    } catch {
      Alert.alert('Error', 'Failed to fetch queue');
    }
  };

  const handleExportDebugInfo = async () => {
    if (!debugInfo) return;
    
    const debugReport = `
# Form Factor Debug Report
Generated: ${new Date().toISOString()}

## App Info
- Version: ${debugInfo.appVersion} (${debugInfo.buildNumber})
- Platform: ${debugInfo.platform}
- Expo SDK: ${debugInfo.expoVersion}

## Sync Status
- Unsynced Workouts: ${debugInfo.unsyncedWorkouts}
- Unsynced Foods: ${debugInfo.unsyncedFoods}
- Sync Queue Items: ${debugInfo.syncQueueItems}

## Auth Status
- Authenticated: ${debugInfo.isAuthenticated ? 'Yes' : 'No'}
- User ID: ${debugInfo.userId || 'N/A'}
- Email: ${debugInfo.userEmail || 'N/A'}

## Network
- Online: ${debugInfo.isOnline ? 'Yes' : 'No'}

## Database Stats
- Total Workouts: ${debugInfo.totalWorkouts}
- Total Foods: ${debugInfo.totalFoods}
`.trim();

    try {
      await Share.share({
        message: debugReport,
        title: 'Form Factor Debug Report',
      });
    } catch (error) {
      console.error('Failed to share:', error);
    }
  };

  const handleOpenEditProfile = () => {
    setFullName(currentName);
    setIsEditProfileVisible(true);
  };

  const handleOpenNotifications = () => {
    router.push('/(modals)/notifications');
  };

  const handleSaveProfile = async () => {
    const trimmedName = fullName.trim();
    if (!trimmedName) {
      Alert.alert('Name required', 'Please enter your full name.');
      return;
    }

    try {
      setIsSavingName(true);
      const { error } = await updateProfile({ fullName: trimmedName });
      if (error) {
        Alert.alert('Error', error.message || 'Could not update profile.');
        return;
      }
      setIsEditProfileVisible(false);
      Alert.alert('Profile updated', 'Your name has been saved.');
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Could not update profile.');
    } finally {
      setIsSavingName(false);
    }
  };

  const MenuItem = ({ icon, title, onPress, danger = false }: any) => (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      <LinearGradient
        colors={danger ? ['rgba(255, 59, 48, 0.1)', 'rgba(255, 59, 48, 0.05)'] : ['rgba(76, 140, 255, 0.05)', 'rgba(76, 140, 255, 0.02)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.menuItem}
      >
        <View style={styles.menuIconContainer}>
          <Ionicons name={icon} size={20} color={danger ? '#FF3B30' : '#4C8CFF'} />
        </View>
        <Text style={[styles.menuText, danger && styles.menuTextDanger]}>{title}</Text>
        <Ionicons name="chevron-forward" size={20} color="#6781A6" />
      </LinearGradient>
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header Card */}
      <LinearGradient
        colors={['rgba(76, 140, 255, 0.15)', 'rgba(76, 140, 255, 0.05)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerCard}
      >
        <View style={styles.avatarContainer}>
          <Text style={styles.avatarText}>
            {displayInitial}
          </Text>
        </View>
        <Text style={styles.nameText}>{displayName}</Text>
        <Text style={styles.emailText}>{user?.email || 'Not signed in'}</Text>
        <Text style={styles.memberSince}>Member since {memberSinceYear}</Text>
      </LinearGradient>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Health Overview</Text>
        <HealthTrendsView />
      </View>

      {/* Debug Section - Remove before production */}
      {(__DEV__ || (Constants.expoConfig?.extra?.appVariant !== 'staging' && Constants.expoConfig?.extra?.appVariant !== 'production')) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🔧 Debug Tools</Text>
          
          {/* Debug Stats Card */}
          {debugInfo && !debugLoading && (
            <LinearGradient
              colors={['rgba(76, 140, 255, 0.1)', 'rgba(76, 140, 255, 0.05)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.debugStatsCard}
            >
              <View style={styles.debugStatsRow}>
                <View style={styles.debugStat}>
                  <Text style={styles.debugStatValue}>{debugInfo.unsyncedWorkouts + debugInfo.unsyncedFoods}</Text>
                  <Text style={styles.debugStatLabel}>Unsynced</Text>
                </View>
                <View style={styles.debugStatDivider} />
                <View style={styles.debugStat}>
                  <Text style={styles.debugStatValue}>{debugInfo.syncQueueItems}</Text>
                  <Text style={styles.debugStatLabel}>Queue</Text>
                </View>
                <View style={styles.debugStatDivider} />
                <View style={styles.debugStat}>
                  <Text style={[styles.debugStatValue, debugInfo.isOnline ? styles.debugStatOnline : styles.debugStatOffline]}>
                    {debugInfo.isOnline ? '●' : '○'}
                  </Text>
                  <Text style={styles.debugStatLabel}>{debugInfo.isOnline ? 'Online' : 'Offline'}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={refreshDebugInfo} style={styles.refreshButton}>
                <Ionicons name="refresh" size={16} color="#4C8CFF" />
                <Text style={styles.refreshText}>Refresh</Text>
              </TouchableOpacity>
            </LinearGradient>
          )}
          
          {/* Debug Actions */}
          <View style={styles.debugActions}>
            <TouchableOpacity onPress={handleFixSync} disabled={isFixing} activeOpacity={0.7}>
              <LinearGradient
                colors={['rgba(255, 204, 0, 0.2)', 'rgba(255, 204, 0, 0.1)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.debugButton}
              >
                <Ionicons name="build-outline" size={18} color="#FFCC00" />
                <Text style={styles.debugButtonText}>
                  {isFixing ? 'Fixing...' : 'Fix Sync'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleForceSync} disabled={isSyncing} activeOpacity={0.7}>
              <LinearGradient
                colors={['rgba(76, 140, 255, 0.2)', 'rgba(76, 140, 255, 0.1)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.debugButton}
              >
                <Ionicons name="sync-outline" size={18} color="#4C8CFF" />
                <Text style={[styles.debugButtonText, { color: '#4C8CFF' }]}>
                  {isSyncing ? 'Syncing...' : 'Force Sync'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleViewSyncQueue} activeOpacity={0.7}>
              <LinearGradient
                colors={['rgba(76, 140, 255, 0.1)', 'rgba(76, 140, 255, 0.05)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.debugButton}
              >
                <Ionicons name="list-outline" size={18} color="#9AACD1" />
                <Text style={[styles.debugButtonText, { color: '#9AACD1' }]}>
                  View Queue
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleExportDebugInfo} activeOpacity={0.7}>
              <LinearGradient
                colors={['rgba(76, 140, 255, 0.1)', 'rgba(76, 140, 255, 0.05)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.debugButton}
              >
                <Ionicons name="share-outline" size={18} color="#9AACD1" />
                <Text style={[styles.debugButtonText, { color: '#9AACD1' }]}>
                  Export Info
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleClearDatabase} disabled={isClearing} activeOpacity={0.7}>
              <LinearGradient
                colors={['rgba(255, 59, 48, 0.2)', 'rgba(255, 59, 48, 0.1)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.debugButton}
              >
                <Ionicons name="trash-outline" size={18} color="#FF3B30" />
                <Text style={[styles.debugButtonText, { color: '#FF3B30' }]}>
                  {isClearing ? 'Clearing...' : 'Clear DB'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Account Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.menuGroup}>
          <MenuItem icon="person-outline" title="Edit Profile" onPress={handleOpenEditProfile} />
          <MenuItem icon="notifications-outline" title="Notifications" onPress={handleOpenNotifications} />
          <MenuItem icon="lock-closed-outline" title="Privacy & Security" onPress={() => {}} />
        </View>
      </View>

      {/* App Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>App</Text>
        <View style={styles.menuGroup}>
          <MenuItem icon="help-circle-outline" title="Help & Support" onPress={() => {}} />
          <MenuItem icon="information-circle-outline" title="About" onPress={() => {}} />
        </View>
      </View>

      {/* Sign Out */}
      <View style={styles.section}>
        <MenuItem icon="log-out-outline" title="Sign Out" onPress={handleSignOut} danger />
      </View>

      {/* Bottom Padding */}
      <View style={styles.bottomSpacer} />

      <Modal visible={isEditProfileVisible} animationType="slide" transparent onRequestClose={() => setIsEditProfileVisible(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => (!isSavingName ? setIsEditProfileVisible(false) : null)}
          />
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Edit Profile</Text>
            <Text style={styles.modalLabel}>Full Name</Text>
            <TextInput
              value={fullName}
              onChangeText={setFullName}
              placeholder="Enter your name"
              placeholderTextColor="#6781A6"
              style={styles.modalInput}
              autoCapitalize="words"
              autoCorrect={false}
              editable={!isSavingName}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonSecondary]}
                onPress={() => setIsEditProfileVisible(false)}
                disabled={isSavingName}
              >
                <Text style={[styles.modalButtonText, styles.modalButtonTextSecondary]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonPrimary]}
                onPress={handleSaveProfile}
                disabled={isSavingName}
              >
                {isSavingName ? (
                  <ActivityIndicator color="#0F2339" />
                ) : (
                  <Text style={[styles.modalButtonText, styles.modalButtonTextPrimary]}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
