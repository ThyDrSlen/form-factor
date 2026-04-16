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
const TOKEN_UPSERT_MAX_RETRIES = 2;
const TOKEN_UPSERT_RETRY_DELAY_MS = 1000;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldSetBadge: false,
  }),
});

async function registerNotificationCategories() {
  if (Platform.OS !== 'ios') return;
  try {
    await Notifications.setNotificationCategoryAsync('social', [
      { identifier: 'view', buttonTitle: 'View', options: { opensAppToForeground: true } },
    ]);
    await Notifications.setNotificationCategoryAsync('coach', [
      { identifier: 'reply', buttonTitle: 'Reply', options: { opensAppToForeground: true } },
    ]);
  } catch (err) {
    warnWithTs('[notifications] Failed to register notification categories', err);
  }
}

registerNotificationCategories();

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

  const tokenPayload = {
    token,
    user_id: userId,
    platform: Platform.OS,
    app_version: Application.nativeApplicationVersion || 'dev',
    device_id: deviceId,
    last_seen_at: new Date().toISOString(),
  };

  let lastUpsertError: { message: string } | null = null;
  for (let attempt = 0; attempt <= TOKEN_UPSERT_MAX_RETRIES; attempt++) {
    const { error: upsertErr } = await supabase.from('notification_tokens').upsert(tokenPayload);
    if (!upsertErr) {
      lastUpsertError = null;
      break;
    }
    lastUpsertError = upsertErr;
    if (attempt < TOKEN_UPSERT_MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, TOKEN_UPSERT_RETRY_DELAY_MS * (attempt + 1)));
    }
  }

  if (lastUpsertError) {
    errorWithTs('[notifications] Failed to save push token after retries', lastUpsertError);
    return { status: permissionStatus, error: lastUpsertError.message, token };
  }

  await AsyncStorage.setItem(LAST_PUSH_TOKEN_KEY, token);

  return { status: permissionStatus, token };
}

let pushTokenSubscription: Notifications.Subscription | null = null;

export function startPushTokenRefreshListener(userId: string) {
  stopPushTokenRefreshListener();
  pushTokenSubscription = Notifications.addPushTokenListener(async (tokenData) => {
    const newToken = tokenData.data;
    infoWithTs('[notifications] Push token refreshed, re-registering', { userId });
    const deviceId = await getDeviceId();
    const { error } = await supabase.from('notification_tokens').upsert({
      token: newToken,
      user_id: userId,
      platform: Platform.OS,
      app_version: Application.nativeApplicationVersion || 'dev',
      device_id: deviceId,
      last_seen_at: new Date().toISOString(),
    });
    if (error) {
      errorWithTs('[notifications] Failed to save refreshed token', error);
    } else {
      await AsyncStorage.setItem(LAST_PUSH_TOKEN_KEY, newToken);
    }
  });
}

export function stopPushTokenRefreshListener() {
  if (pushTokenSubscription) {
    pushTokenSubscription.remove();
    pushTokenSubscription = null;
  }
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

const DEFAULT_PREFERENCES: Omit<NotificationPreferences, 'user_id'> = {
  comments: true,
  likes: true,
  reminders: true,
  timezone: null,
  quiet_hours: null,
};

export async function loadNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const { data, error, status } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) {
    if (status !== 406) {
      warnWithTs('[notifications] Failed to load preferences, using defaults', { status, error: error.message });
      return { user_id: userId, ...DEFAULT_PREFERENCES };
    }
  } else if (data) {
    return data as NotificationPreferences;
  }

  const { data: created, error: createError } = await supabase
    .from('notification_preferences')
    .upsert({
      user_id: userId,
      ...DEFAULT_PREFERENCES,
    })
    .select()
    .single();

  if (createError) {
    warnWithTs('[notifications] Failed to create default preferences, using in-memory defaults', createError);
    return { user_id: userId, ...DEFAULT_PREFERENCES };
  }

  return created as NotificationPreferences;
}

/**
 * Schedule a local reminder notification bound to a workout template.
 * Deep-link payload opens the scan tab with the templateId pre-selected.
 *
 * Stub in this commit — full implementation lands in the follow-up
 * commit that extends notifications with trigger + category wiring
 * (issue #447 W3-C item #4).
 */
export async function scheduleTemplatedReminder(
  templateId: string,
  scheduledAt: Date,
): Promise<void> {
  // Guard in case callers bypass the scheduler's input validation.
  if (!templateId) return;
  if (!(scheduledAt instanceof Date) || Number.isNaN(scheduledAt.getTime())) return;
  // TODO: fully implement in the next commit — trigger + category below.
  infoWithTs('[notifications] (stub) scheduleTemplatedReminder', {
    templateId,
    scheduledAt: scheduledAt.toISOString(),
  });
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
