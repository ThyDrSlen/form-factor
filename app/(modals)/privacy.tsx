import React, { useEffect, useState } from 'react';
import { BackHandler, View, Text, StyleSheet, TouchableOpacity, Switch, Linking, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useSafeBack } from '@/hooks/use-safe-back';
import { warnWithTs } from '@/lib/logger';
import { getConsent, updateConsent } from '@/lib/services/consent-service';

type SettingItemProps = {
  icon: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  rightElement?: React.ReactNode;
};

const SettingItem = ({ icon, title, subtitle, onPress, rightElement }: SettingItemProps) => (
  <TouchableOpacity style={styles.settingItem} onPress={onPress} activeOpacity={onPress ? 0.7 : 1}>
    <View style={styles.settingIconContainer}>
      <Ionicons name={icon as any} size={22} color="#4C8CFF" />
    </View>
    <View style={styles.settingTextContainer}>
      <Text style={styles.settingTitle}>{title}</Text>
      {subtitle && <Text style={styles.settingSubtitle}>{subtitle}</Text>}
    </View>
    {rightElement}
    {onPress && <Ionicons name="chevron-forward" size={20} color="#6781A6" />}
  </TouchableOpacity>
);

export default function PrivacySecurityModal() {
  const { user } = useAuth();
  const toast = useToast();
  const safeBack = useSafeBack(['/(tabs)/profile', '/profile'], { alwaysReplace: true });
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);
  const [videoResearchEnabled, setVideoResearchEnabled] = useState(false);
  const [loadingExport, setLoadingExport] = useState(false);
  const [savingVideoConsent, setSavingVideoConsent] = useState(false);

  useEffect(() => {
    let active = true;

    getConsent()
      .then((consent) => {
        if (!active) return;
        setAnalyticsEnabled(consent.allowAnonymousTelemetry);
        setVideoResearchEnabled(consent.allowVideoUpload);
      })
      .catch((error) => {
        warnWithTs('[privacy] Failed to load consent', error);
      });

    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    if (BackHandler.addEventListener) {
      const handleHardwareBackPress = () => {
        safeBack();
        return true;
      };
      const subscription = BackHandler.addEventListener('hardwareBackPress', handleHardwareBackPress);
      return () => subscription.remove();
    }
  }, [safeBack]);

  const handleExportData = async () => {
    if (!user?.id) {
      toast.show('Please sign in to export your data', { type: 'error' });
      return;
    }

    setLoadingExport(true);
    try {
      // Simulate data export - in production this would call an API endpoint
      await new Promise((resolve) => setTimeout(resolve, 1500));
      toast.show('Data export requested. Check your email shortly.', { type: 'success' });
    } catch (err) {
      warnWithTs('[privacy] Data export failed', err);
      toast.show('Failed to initiate data export', { type: 'error' });
    } finally {
      setLoadingExport(false);
    }
  };

  const handleConnectedAccounts = () => {
    // TODO: Implement connected accounts management
    toast.show('Connected accounts management coming soon', { type: 'info' });
  };

  const handlePrivacyPolicy = () => {
    Linking.openURL('https://formfactor.app/privacy');
  };

  const handleToggleAnalytics = () => {
    setAnalyticsEnabled(!analyticsEnabled);
    toast.show(analyticsEnabled ? 'Analytics disabled' : 'Analytics enabled', { type: 'success' });
  };

  const handleToggleVideoResearch = async (enabled: boolean) => {
    try {
      setSavingVideoConsent(true);
      await updateConsent({ allowVideoUpload: enabled });
      setVideoResearchEnabled(enabled);
      toast.show(enabled ? 'Video research upload enabled' : 'Video research upload disabled', { type: 'success' });
    } catch (error) {
      warnWithTs('[privacy] Failed to update video upload consent', error);
      toast.show('Could not update video upload preference', { type: 'error' });
    } finally {
      setSavingVideoConsent(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={safeBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#1A1A2E" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy & Security</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.content}>
        {/* Data & Privacy Section */}
        <Text style={styles.sectionTitle}>Data & Privacy</Text>
        <View style={styles.card}>
          <SettingItem
            icon="download-outline"
            title="Export My Data"
            subtitle="Download a copy of your data"
            onPress={handleExportData}
            rightElement={loadingExport && <ActivityIndicator size="small" color="#4C8CFF" />}
          />
          <View style={styles.divider} />
          <SettingItem
            icon="link-outline"
            title="Connected Accounts"
            subtitle="Manage linked services"
            onPress={handleConnectedAccounts}
          />
          <View style={styles.divider} />
          <SettingItem
            icon="document-text-outline"
            title="Privacy Policy"
            subtitle="Read our privacy practices"
            onPress={handlePrivacyPolicy}
          />
        </View>

        {/* Analytics Section */}
        <Text style={styles.sectionTitle}>Analytics</Text>
        <View style={styles.card}>
          <SettingItem
            icon="stats-chart-outline"
            title="Analytics"
            subtitle="Help us improve with anonymous usage data"
            rightElement={<Switch value={analyticsEnabled} onValueChange={handleToggleAnalytics} trackColor={{ false: '#E0E0E0', true: '#4C8CFF' }} />}
          />
          <View style={styles.divider} />
          <SettingItem
            icon="videocam-outline"
            title="Video Upload for Research"
            subtitle="Automatically upload completed recordings for model improvement when enabled"
            rightElement={
              <Switch
                value={videoResearchEnabled}
                onValueChange={handleToggleVideoResearch}
                disabled={savingVideoConsent}
                trackColor={{ false: '#E0E0E0', true: '#4C8CFF' }}
              />
            }
          />
        </View>

        {/* Security Section */}
        <Text style={styles.sectionTitle}>Security</Text>
        <View style={styles.card}>
          <SettingItem
            icon="shield-checkmark-outline"
            title="Two-Factor Authentication"
            subtitle="Add extra security to your account"
          />
          <View style={styles.divider} />
          <SettingItem
            icon="key-outline"
            title="Change Password"
            subtitle="Update your account password"
          />
          <View style={styles.divider} />
          <SettingItem
            icon="time-outline"
            title="Active Sessions"
            subtitle="Manage devices logged into your account"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '600',
    color: '#1A1A2E',
    textAlign: 'center',
    marginRight: 40,
  },
  headerSpacer: {
    width: 32,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6781A6',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  settingIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(76, 140, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  settingTextContainer: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1A1A2E',
  },
  settingSubtitle: {
    fontSize: 13,
    color: '#6781A6',
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginLeft: 64,
  },
});
