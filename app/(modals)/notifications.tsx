import React, { useEffect, useMemo, useState } from 'react';
import { BackHandler, View, Text, StyleSheet, TouchableOpacity, Switch, ActivityIndicator, Linking, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
// import * as Notifications from 'expo-notifications';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useSafeBack } from '@/hooks/use-safe-back';
import {
  loadNotificationPreferences,
  registerDevicePushToken,
  requestNotificationPermissions,
  updateNotificationPreferences,
  getNotificationPermissions, // Added
} from '@/lib/services/notifications';

// type PermissionState = Notifications.PermissionStatus;
type PermissionState = 'granted' | 'undetermined' | 'denied';
type ToggleKey = 'comments' | 'likes' | 'reminders';

export default function NotificationSettingsModal() {
  const { user } = useAuth();
  const toast = useToast();
  const safeBack = useSafeBack(['/(tabs)/profile', '/profile'], { alwaysReplace: true });
  const [permission, setPermission] = useState<PermissionState>('undetermined');
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [savingKey, setSavingKey] = useState<ToggleKey | null>(null);
  const [prefs, setPrefs] = useState<{ [key in ToggleKey]: boolean } | null>(null);

  const statusLabel = useMemo(() => {
    if (permission === 'granted') return 'Enabled';
    if (permission === 'denied') return 'Denied';
    return 'Not requested';
  }, [permission]);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        // const settings = await Notifications.getPermissionsAsync();
        const status = await getNotificationPermissions();
        setPermission(status);

        if (user?.id) {
          const existing = await loadNotificationPreferences(user.id);
          setPrefs({
            comments: existing.comments,
            likes: existing.likes,
            reminders: existing.reminders,
          });
        }
      } catch (err) {
        console.warn('[notifications] Failed to load settings', err);
        toast.show('Unable to load notification settings', { type: 'error' });
      } finally {
        setLoading(false);
      }
    };

    bootstrap();
  }, [toast, user?.id]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      safeBack();
      return true;
    });
    return () => subscription.remove();
  }, [safeBack]);

  const handleEnable = async () => {
    if (!user?.id) return;
    setRegistering(true);

    try {
      const status = await requestNotificationPermissions();
      setPermission(status);

      if (status !== 'granted') {
        toast.show('Enable notifications in system settings to receive alerts', { type: 'error' });
        return;
      }

      const result = await registerDevicePushToken(user.id, { requestPermission: false });
      if (result.error) {
        toast.show('Push token saved with warnings; check logs', { type: 'error' });
      } else {
        toast.show('Notifications enabled for this device', { type: 'success' });
      }
    } catch (err) {
      console.warn('[notifications] Enable failed', err);
      toast.show('Unable to enable notifications', { type: 'error' });
    } finally {
      setRegistering(false);
    }
  };

  const handleToggle = async (key: ToggleKey) => {
    if (!user?.id || !prefs) return;

    const nextPrefs = { ...prefs, [key]: !prefs[key] };
    setPrefs(nextPrefs);
    setSavingKey(key);

    try {
      const updated = await updateNotificationPreferences(user.id, { [key]: nextPrefs[key] });
      setPrefs({
        comments: updated.comments,
        likes: updated.likes,
        reminders: updated.reminders,
      });
    } catch (err) {
      console.warn('[notifications] Failed to update preferences', err);
      setPrefs(prefs);
      toast.show('Could not save preference', { type: 'error' });
    } finally {
      setSavingKey(null);
    }
  };

  const openSystemSettings = () => {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={safeBack}>
          <Ionicons name="close" size={22} color="#9AACD1" />
        </TouchableOpacity>
        <Text style={styles.title}>Notifications</Text>
        <View style={styles.iconButton} />
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <View>
            <Text style={styles.cardTitle}>Push status</Text>
            <Text style={styles.cardSubtitle}>Control alerts for comments and likes</Text>
          </View>
          <View style={[
            styles.statusPill,
            permission === 'granted' ? styles.statusSuccess : styles.statusMuted,
          ]}>
            <Text style={permission === 'granted' ? styles.statusTextOn : styles.statusTextOff}>
              {statusLabel}
            </Text>
          </View>
        </View>

        {permission !== 'granted' ? (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.ctaButton, registering && styles.ctaDisabled]}
              onPress={handleEnable}
              disabled={registering}
            >
              {registering ? (
                <ActivityIndicator color="#0F2339" />
              ) : (
                <Text style={styles.ctaText}>Enable notifications</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryButton} onPress={openSystemSettings}>
              <Text style={styles.secondaryText}>Open system settings</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Preferences</Text>
        {loading ? (
          <ActivityIndicator color="#4C8CFF" style={{ marginTop: 12 }} />
        ) : prefs ? (
          <>
            <SettingRow
              label="Comments on my videos"
              value={prefs.comments}
              onValueChange={() => handleToggle('comments')}
              disabled={savingKey === 'comments'}
            />
            <SettingRow
              label="Likes on my videos"
              value={prefs.likes}
              onValueChange={() => handleToggle('likes')}
              disabled={savingKey === 'likes'}
            />
            <SettingRow
              label="Daily workout reminder"
              value={prefs.reminders}
              onValueChange={() => handleToggle('reminders')}
              disabled={savingKey === 'reminders'}
            />
          </>
        ) : (
          <Text style={styles.cardSubtitle}>Sign in to adjust your notification settings.</Text>
        )}
      </View>
    </View>
  );
}

function SettingRow({
  label,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onValueChange: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        thumbColor={value ? '#fff' : '#CBD7F5'}
        trackColor={{ false: '#223859', true: '#4C8CFF' }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050E1F',
    padding: 20,
    paddingTop: 48,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: 'rgba(154, 172, 209, 0.1)',
  },
  title: {
    color: '#E9EFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#0B1A2F',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#152642',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  cardTitle: {
    color: '#E9EFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  cardSubtitle: {
    color: '#9AACD1',
    fontSize: 13,
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusSuccess: {
    backgroundColor: 'rgba(76, 140, 255, 0.15)',
    borderColor: '#4C8CFF',
  },
  statusMuted: {
    backgroundColor: 'rgba(154, 172, 209, 0.12)',
    borderColor: '#1E3355',
  },
  statusTextOn: {
    color: '#E9EFFF',
    fontWeight: '600',
  },
  statusTextOff: {
    color: '#9AACD1',
    fontWeight: '600',
  },
  actions: {
    marginTop: 16,
    gap: 10,
  },
  ctaButton: {
    backgroundColor: '#4C8CFF',
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
  },
  ctaText: {
    color: '#0F2339',
    fontWeight: '700',
    fontSize: 15,
  },
  ctaDisabled: {
    opacity: 0.7,
  },
  secondaryButton: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  secondaryText: {
    color: '#9AACD1',
    fontWeight: '600',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  settingLabel: {
    color: '#E9EFFF',
    fontSize: 15,
    flex: 1,
    paddingRight: 12,
  },
});
