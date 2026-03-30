import React, { useEffect, useState } from 'react';
import { BackHandler, Modal, View, Text, StyleSheet, TouchableOpacity, Linking, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeBack } from '@/hooks/use-safe-back';

type LinkItemProps = {
  icon?: string;
  logo?: string;
  title: string;
  onPress: () => void;
};

const LinkItem = ({ icon, title, onPress }: LinkItemProps) => (
  <TouchableOpacity style={styles.linkItem} onPress={onPress} activeOpacity={0.7}>
    <View style={styles.linkIconContainer}>
      <Ionicons name={icon as any} size={20} color="#4C8CFF" />
    </View>
    <Text style={styles.linkText}>{title}</Text>
    <Ionicons name="open-outline" size={18} color="#9AACD1" />
  </TouchableOpacity>
);

const LAST_SEEN_VERSION_KEY = 'last_seen_changelog_version';

const changelog = [
  {
    version: '1.0.0',
    date: '2026-03-13',
    changes: [
      'Real-time form coaching with ARKit body tracking',
      'Auto workout and food logging with offline sync',
      'AI coach powered by HealthKit recovery data',
      'Social video feed with comments and likes',
      'Privacy controls for analytics and data',
      'Account deletion for GDPR compliance',
    ],
  },
];

export default function AboutModal() {
  const safeBack = useSafeBack(['/(tabs)/profile', '/profile'], { alwaysReplace: true });

  const appVersion = Constants.expoConfig?.version || '1.0.0';
  const buildNumber = Constants.expoConfig?.ios?.buildNumber || '1';
  const [showChangelog, setShowChangelog] = useState(false);
  const [isNewVersion, setIsNewVersion] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(LAST_SEEN_VERSION_KEY).then((lastSeen) => {
      if (lastSeen !== appVersion) {
        setIsNewVersion(true);
      }
    });
  }, [appVersion]);

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

  const handleTermsOfService = () => {
    Linking.openURL('https://formfactor.app/terms');
  };

  const handlePrivacyPolicy = () => {
    Linking.openURL('https://formfactor.app/privacy');
  };

  const handleLicenses = () => {
    Linking.openURL('https://formfactor.app/licenses');
  };

  const handleChangelog = () => {
    setShowChangelog(true);
    AsyncStorage.setItem(LAST_SEEN_VERSION_KEY, appVersion);
    setIsNewVersion(false);
  };

  const handleWebsite = () => {
    Linking.openURL('https://formfactor.app');
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={safeBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#E8EDF5" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>About</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* App Info Card */}
        <View style={styles.appInfoCard}>
          <View style={styles.logoContainer}>
            <Ionicons name="fitness-outline" size={48} color="#4C8CFF" />
          </View>
          <Text style={styles.appName}>Form Factor</Text>
          <Text style={styles.appTagline}>Your AI-Powered Fitness Coach</Text>
          <View style={styles.versionInfo}>
            <Text style={styles.versionText}>Version {appVersion} ({buildNumber})</Text>
          </View>
        </View>

        {/* Links Section */}
        <Text style={styles.sectionTitle}>Information</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.linkItem} onPress={handleChangelog} activeOpacity={0.7}>
            <View style={styles.linkIconContainer}>
              <Ionicons name="document-text-outline" size={20} color="#4C8CFF" />
            </View>
            <Text style={styles.linkText}>What&apos;s New</Text>
            {isNewVersion && (
              <View style={styles.newBadge}>
                <Text style={styles.newBadgeText}>NEW</Text>
              </View>
            )}
            <Ionicons name="chevron-forward" size={18} color="#9AACD1" />
          </TouchableOpacity>
          <View style={styles.divider} />
          <LinkItem
            icon="document-outline"
            title="Terms of Service"
            onPress={handleTermsOfService}
          />
          <View style={styles.divider} />
          <LinkItem
            icon="shield-checkmark-outline"
            title="Privacy Policy"
            onPress={handlePrivacyPolicy}
          />
          <View style={styles.divider} />
          <LinkItem
            icon="code-slash-outline"
            title="Open Source Licenses"
            onPress={handleLicenses}
          />
        </View>

        {/* Connect Section */}
        <Text style={styles.sectionTitle}>Connect</Text>
        <View style={styles.card}>
          <LinkItem
            icon="globe-outline"
            title="Visit Our Website"
            onPress={handleWebsite}
          />
          <View style={styles.divider} />
          <LinkItem
            logo="logo-twitter"
            title="Follow us on X"
            onPress={() => Linking.openURL('https://twitter.com/formfactorapp')}
          />
          <View style={styles.divider} />
          <LinkItem
            logo="logo-instagram"
            title="Follow us on Instagram"
            onPress={() => Linking.openURL('https://instagram.com/formfactorapp')}
          />
        </View>

        {/* Credits Section */}
        <View style={styles.creditsContainer}>
          <Text style={styles.creditsText}>
            Form Factor uses ARKit for body tracking, Apple HealthKit for health data integration, and Supabase for cloud sync.
          </Text>
          <Text style={styles.copyrightText}>
            © 2024 Form Factor. All rights reserved.
          </Text>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      <Modal visible={showChangelog} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>What&apos;s New</Text>
              <TouchableOpacity onPress={() => setShowChangelog(false)} style={styles.modalClose}>
                <Ionicons name="close" size={24} color="#E8EDF5" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {changelog.map((release) => (
                <View key={release.version} style={styles.releaseBlock}>
                  <View style={styles.releaseHeader}>
                    <Text style={styles.releaseVersion}>v{release.version}</Text>
                    <Text style={styles.releaseDate}>{release.date}</Text>
                  </View>
                  {release.changes.map((change) => (
                    <View key={change} style={styles.changeRow}>
                      <Ionicons name="checkmark-circle" size={16} color="#4C8CFF" />
                      <Text style={styles.changeText}>{change}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050E1F',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: '#050E1F',
    borderBottomWidth: 1,
    borderBottomColor: '#1B2E4A',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '600',
    color: '#E8EDF5',
    textAlign: 'center',
    marginRight: 40,
  },
  headerSpacer: {
    width: 32,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  appInfoCard: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  logoContainer: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: 'rgba(76, 140, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  appName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#E8EDF5',
    marginBottom: 4,
  },
  appTagline: {
    fontSize: 14,
    color: '#9AACD1',
    marginBottom: 16,
  },
  versionInfo: {
    backgroundColor: 'rgba(76, 140, 255, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  versionText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#4C8CFF',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9AACD1',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 20,
  },
  card: {
    backgroundColor: '#0B1A2F',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1B2E4A',
    overflow: 'hidden',
  },
  linkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  linkIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 9,
    backgroundColor: 'rgba(76, 140, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  linkText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: '#E8EDF5',
  },
  divider: {
    height: 1,
    backgroundColor: '#1B2E4A',
    marginLeft: 64,
  },
  creditsContainer: {
    marginTop: 24,
    paddingHorizontal: 8,
  },
  creditsText: {
    fontSize: 13,
    color: '#9AACD1',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 12,
  },
  copyrightText: {
    fontSize: 12,
    color: '#9AACD1',
    textAlign: 'center',
  },
  bottomSpacer: {
    height: 40,
  },
  newBadge: {
    backgroundColor: '#4C8CFF',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginRight: 8,
  },
  newBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#0B1A2F',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '75%',
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#1B2E4A',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#E8EDF5',
  },
  modalClose: {
    padding: 4,
  },
  modalBody: {
    padding: 20,
  },
  releaseBlock: {
    marginBottom: 24,
  },
  releaseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  releaseVersion: {
    fontSize: 18,
    fontWeight: '700',
    color: '#E8EDF5',
  },
  releaseDate: {
    fontSize: 13,
    color: '#9AACD1',
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 8,
  },
  changeText: {
    flex: 1,
    fontSize: 15,
    color: '#E8EDF5',
    lineHeight: 20,
  },
});
