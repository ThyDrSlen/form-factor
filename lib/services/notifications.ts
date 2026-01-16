import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import type * as ExpoDevice from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { PermissionStatus } from 'expo-modules-core';
import { errorWithTs, infoWithTs, warnWithTs } from '@/lib/logger';
import { supabase } from '../supabase';

let Device: typeof ExpoDevice | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Device = require('expo-device');
} catch (error) {
  warnWithTs('[notifications] expo-device is unavailable; push registration limited.', error);
}

export type NotificationPreferences = {
  user_id: string;
  comments: boolean;
  likes: boolean;
  reminders: boolean;
  timezone: string | null;
  quiet_hours: string | null;
  created_at?: string;
  updated_at?: string;
};

type RegisterResult = {
  status: PermissionStatus;
  token?: string;
  error?: string;
};

const LAST_PUSH_TOKEN_KEY = 'ff.notifications.last_token';
const DEVICE_ID_KEY = 'ff.notifications.device_id';

// Show foreground notifications by default
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldSetBadge: false,
  }),
});

function getProjectId() {
  const easProjectId = Constants.expoConfig?.extra?.eas?.projectId;
  const configProjectId = (Constants.expoConfig as { projectId?: string } | undefined)?.projectId;

  return process.env.EXPO_PUBLIC_PUSH_PROJECT_ID || easProjectId || configProjectId;
}

async function getDeviceId() {
  const cached = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (cached) return cached;

  const bytes = await Crypto.getRandomBytesAsync(16);
  const generated = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await AsyncStorage.setItem(DEVICE_ID_KEY, generated);
  return generated;
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'General',
    importance: Notifications.AndroidImportance.MAX,
    lightColor: '#4C8CFF',
  });
}

export async function getNotificationPermissions(): Promise<PermissionStatus> {
  const settings = await Notifications.getPermissionsAsync();
  return settings.status;
}

export async function requestNotificationPermissions(): Promise<PermissionStatus> {
  const settings = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
      provideAppNotificationSettings: true,
    },
  });
  return settings.status;
}

export async function registerDevicePushToken(
  userId: string,
  options: { requestPermission?: boolean } = {},
): Promise<RegisterResult> {
  if (!userId) {
    return { status: PermissionStatus.UNDETERMINED, error: 'Missing userId' };
  }

  if (!Device?.isDevice) {
    infoWithTs('[notifications] Skipping push registration on simulator/web');
    return { status: PermissionStatus.UNDETERMINED, error: 'Device push unsupported' };
  }

  let permissions = await Notifications.getPermissionsAsync();
  let permissionStatus: PermissionStatus = permissions.status;

  if (permissions.status !== 'granted' && options.requestPermission !== false) {
    permissions = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
        provideAppNotificationSettings: true,
      },
    });
    permissionStatus = permissions.status;
  }

  if (permissionStatus !== 'granted') {
    return { status: permissionStatus };
  }

  const projectId = getProjectId();
  if (!projectId) {
    return {
      status: permissionStatus,
      error: 'Missing EXPO_PUBLIC_PUSH_PROJECT_ID or expo.extra.eas.projectId',
    };
  }

  await ensureAndroidChannel();

  const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = tokenResponse.data;
  const deviceId = await getDeviceId();

  const { error } = await supabase.from('notification_tokens').upsert({
    token,
    user_id: userId,
    platform: Platform.OS,
    app_version: Application.nativeApplicationVersion || 'dev',
    device_id: deviceId,
    last_seen_at: new Date().toISOString(),
  });

  if (error) {
    errorWithTs('[notifications] Failed to save push token', error);
    return { status: permissionStatus, error: error.message, token };
  }

  await AsyncStorage.setItem(LAST_PUSH_TOKEN_KEY, token);

  return { status: permissionStatus, token };
}

export async function unregisterDevicePushToken(userId?: string) {
  const token = await AsyncStorage.getItem(LAST_PUSH_TOKEN_KEY);
  if (!token || !userId) return;

  const { error } = await supabase
    .from('notification_tokens')
    .delete()
    .match({ token, user_id: userId });

  if (error) {
    warnWithTs('[notifications] Failed to unregister token', error);
  } else {
    await AsyncStorage.removeItem(LAST_PUSH_TOKEN_KEY);
  }
}

export async function loadNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const { data, error, status } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && status !== 406) {
    throw error;
  }

  if (data) {
    return data as NotificationPreferences;
  }

  const { data: created, error: createError } = await supabase
    .from('notification_preferences')
    .upsert({
      user_id: userId,
      comments: true,
      likes: true,
      reminders: true,
    })
    .select()
    .single();

  if (createError) {
    throw createError;
  }

  return created as NotificationPreferences;
}

export async function updateNotificationPreferences(
  userId: string,
  patch: Partial<Omit<NotificationPreferences, 'user_id'>>,
): Promise<NotificationPreferences> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .upsert(
      { user_id: userId, ...patch },
      { onConflict: 'user_id' },
    )
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data as NotificationPreferences;
}
