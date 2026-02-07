import React from 'react';
import { BackHandler, View, Text, StyleSheet, TouchableOpacity, Linking, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
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
    <Ionicons name="open-outline" size={18} color="#6781A6" />
  </TouchableOpacity>
);

export default function AboutModal() {
  const safeBack = useSafeBack(['/(tabs)/profile', '/profile'], { alwaysReplace: true });

  const appVersion = Constants.expoConfig?.version || '1.0.0';
  const buildNumber = Constants.expoConfig?.ios?.buildNumber || '1';

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
    Linking.openURL('https://formfactor.app/changelog');
  };

  const handleWebsite = () => {
    Linking.openURL('https://formfactor.app');
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={safeBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#1A1A2E" />
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
          <LinkItem
            icon="document-text-outline"
            title="What's New / Changelog"
            onPress={handleChangelog}
          />
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
    color: '#1A1A2E',
    marginBottom: 4,
  },
  appTagline: {
    fontSize: 14,
    color: '#6781A6',
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
    color: '#6781A6',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
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
    color: '#1A1A2E',
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginLeft: 64,
  },
  creditsContainer: {
    marginTop: 24,
    paddingHorizontal: 8,
  },
  creditsText: {
    fontSize: 13,
    color: '#6781A6',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 12,
  },
  copyrightText: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  bottomSpacer: {
    height: 40,
  },
});
