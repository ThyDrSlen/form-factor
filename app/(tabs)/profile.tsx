import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState(
    user?.user_metadata?.full_name || user?.user_metadata?.name || ''
  );
  const [isUpdating, setIsUpdating] = useState(false);

  const getDisplayName = () => {
    if (user?.user_metadata?.full_name) {
      return user.user_metadata.full_name;
    }
    if (user?.user_metadata?.name) {
      return user.user_metadata.name;
    }
    return user?.email?.split('@')[0] || 'User';
  };

  const handleUpdateProfile = async () => {
    if (!displayName.trim()) {
      Alert.alert('Error', 'Please enter a display name');
      return;
    }

    setIsUpdating(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: displayName.trim() }
      });

      if (error) {
        Alert.alert('Error', 'Failed to update profile: ' + error.message);
      } else {
        Alert.alert('Success', 'Profile updated successfully!');
        setIsEditing(false);
      }
    } catch (error) {
      Alert.alert('Error', 'An unexpected error occurred');
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.avatarContainer}>
        <Ionicons name="person-circle-outline" size={100} color="#007AFF" />
      </View>

      <View style={styles.profileInfo}>
        {isEditing ? (
          <View style={styles.editContainer}>
            <TextInput
              style={styles.nameInput}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Enter your display name"
              autoFocus
            />
            <View style={styles.editButtons}>
              <TouchableOpacity 
                style={[styles.editButton, styles.cancelButton]} 
                onPress={() => {
                  setIsEditing(false);
                  setDisplayName(user?.user_metadata?.full_name || user?.user_metadata?.name || '');
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.editButton, styles.saveButton]} 
                onPress={handleUpdateProfile}
                disabled={isUpdating}
              >
                <Text style={styles.saveButtonText}>
                  {isUpdating ? 'Saving...' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.displayContainer}>
            <View style={styles.nameRow}>
              <Text style={styles.nameText}>{getDisplayName()}</Text>
              <TouchableOpacity 
                style={styles.editIcon}
                onPress={() => setIsEditing(true)}
              >
                <Ionicons name="pencil" size={20} color="#007AFF" />
              </TouchableOpacity>
            </View>
            <Text style={styles.emailText}>{user?.email}</Text>
          </View>
        )}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.signOutButton}
          onPress={async () => {
            console.time('[Profile] Sign-out duration');
            console.log('[Profile] Sign-out button pressed');
            const { error } = await signOut();
            console.timeEnd('[Profile] Sign-out duration');
            if (error) {
              console.error('[Profile] Sign-out error:', error);
              Alert.alert('Error', 'Failed to sign out');
            } else {
              console.log('[Profile] Sign-out successful');
              Alert.alert('Signed out', 'You have been signed out.');
            }
          }}
        >
          <Ionicons name="log-out-outline" size={20} color="#fff" />
          <Text style={styles.signOutButtonText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#F8F9FF',
    padding: 24,
  },
  avatarContainer: {
    alignItems: 'center',
    marginTop: 40,
    marginBottom: 32,
  },
  profileInfo: {
    flex: 1,
    alignItems: 'center',
  },
  displayContainer: {
    alignItems: 'center',
    width: '100%',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  nameText: { 
    fontSize: 28, 
    fontWeight: '700', 
    color: '#1C1C1E',
    marginRight: 12,
  },
  editIcon: {
    padding: 8,
  },
  emailText: { 
    fontSize: 16, 
    color: '#636366',
  },
  editContainer: {
    width: '100%',
    alignItems: 'center',
  },
  nameInput: {
    width: '100%',
    fontSize: 24,
    fontWeight: '600',
    color: '#1C1C1E',
    textAlign: 'center',
    borderBottomWidth: 2,
    borderBottomColor: '#007AFF',
    paddingVertical: 8,
    marginBottom: 24,
  },
  editButtons: {
    flexDirection: 'row',
    gap: 16,
  },
  editButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#F2F2F7',
  },
  saveButton: {
    backgroundColor: '#007AFF',
  },
  cancelButtonText: {
    color: '#1C1C1E',
    fontSize: 16,
    fontWeight: '500',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
  },
  actions: {
    alignItems: 'center',
    paddingBottom: 40,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FF3B30',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  signOutButtonText: { 
    color: '#fff', 
    fontSize: 16, 
    fontWeight: '500', 
    marginLeft: 8,
  },
});
