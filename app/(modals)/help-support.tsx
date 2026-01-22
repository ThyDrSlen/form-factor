import React, { useState } from 'react';
import { BackHandler, View, Text, StyleSheet, TouchableOpacity, Linking, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeBack } from '@/hooks/use-safe-back';

type FAQItemProps = {
  question: string;
  answer: string;
  isExpanded: boolean;
  onPress: () => void;
};

const FAQItem = ({ question, answer, isExpanded, onPress }: FAQItemProps) => (
  <TouchableOpacity style={styles.faqItem} onPress={onPress} activeOpacity={0.8}>
    <View style={styles.faqHeader}>
      <Text style={styles.faqQuestion}>{question}</Text>
      <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={20} color="#6781A6" />
    </View>
    {isExpanded && <Text style={styles.faqAnswer}>{answer}</Text>}
  </TouchableOpacity>
);

type SupportOptionProps = {
  icon: string;
  title: string;
  subtitle: string;
  onPress: () => void;
};

const SupportOption = ({ icon, title, subtitle, onPress }: SupportOptionProps) => (
  <TouchableOpacity style={styles.supportOption} onPress={onPress} activeOpacity={0.7}>
    <View style={styles.supportIconContainer}>
      <Ionicons name={icon as any} size={24} color="#4C8CFF" />
    </View>
    <View style={styles.supportTextContainer}>
      <Text style={styles.supportTitle}>{title}</Text>
      <Text style={styles.supportSubtitle}>{subtitle}</Text>
    </View>
    <Ionicons name="chevron-forward" size={20} color="#6781A6" />
  </TouchableOpacity>
);

const faqs = [
  {
    question: 'How do I track a workout?',
    answer: 'Navigate to the Scan tab and position your device to capture your exercise. The app will automatically detect and count reps while providing form feedback.',
  },
  {
    question: 'Can I use Form Factor offline?',
    answer: 'Yes! Most features including workout logging and food tracking work offline. Your data will sync when you reconnect to the internet.',
  },
  {
    question: 'How accurate is the rep counter?',
    answer: 'The ARKit-powered rep counter is highly accurate for common exercises like pull-ups, push-ups, and squats. Accuracy may vary for less common movements.',
  },
  {
    question: 'How do I connect my health data?',
    answer: 'Go to Settings > Health Integration to connect Apple Health. We only access the data you explicitly authorize.',
  },
];

export default function HelpSupportModal() {
  const safeBack = useSafeBack(['/(tabs)/profile', '/profile'], { alwaysReplace: true });
  const toast = useToast();
  const [expandedFAQ, setExpandedFAQ] = useState<number | null>(0);

  const handleHardwareBackPress = () => {
    safeBack();
    return true;
  };

  React.useEffect(() => {
    if (BackHandler.addEventListener) {
      const subscription = BackHandler.addEventListener('hardwareBackPress', handleHardwareBackPress);
      return () => subscription.remove();
    }
  }, [handleHardwareBackPress]);

  const handleContactSupport = () => {
    Linking.openURL('mailto:support@formfactor.app?subject=Form Factor Support Request');
  };

  const handleReportBug = () => {
    Linking.openURL('mailto:support@formfactor.app?subject=Bug Report - Form Factor App');
  };

  const handleOpenDocumentation = () => {
    Linking.openURL('https://formfactor.app/docs');
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={safeBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#1A1A2E" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Help & Support</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Support Options */}
        <Text style={styles.sectionTitle}>Get Help</Text>
        <View style={styles.card}>
          <SupportOption
            icon="chatbubble-ellipses-outline"
            title="Contact Support"
            subtitle="Get help from our team"
            onPress={handleContactSupport}
          />
          <View style={styles.divider} />
          <SupportOption
            icon="bug-outline"
            title="Report a Bug"
            subtitle="Help us improve the app"
            onPress={handleReportBug}
          />
          <View style={styles.divider} />
          <SupportOption
            icon="book-outline"
            title="Documentation"
            subtitle="Browse guides and tutorials"
            onPress={handleOpenDocumentation}
          />
        </View>

        {/* FAQ Section */}
        <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
        <View style={styles.faqCard}>
          {faqs.map((faq, index) => (
            <View key={index}>
              {index > 0 && <View style={styles.faqDivider} />}
              <FAQItem
                question={faq.question}
                answer={faq.answer}
                isExpanded={expandedFAQ === index}
                onPress={() => setExpandedFAQ(expandedFAQ === index ? null : index)}
              />
            </View>
          ))}
        </View>

        {/* Community Section */}
        <Text style={styles.sectionTitle}>Community</Text>
        <View style={styles.card}>
          <SupportOption
            logo="logo-twitter"
            title="Follow us on X"
            subtitle="@formfactorapp"
            onPress={() => Linking.openURL('https://twitter.com/formfactorapp')}
          />
          <View style={styles.divider} />
          <SupportOption
            logo="logo-instagram"
            title="Instagram"
            subtitle="@formfactorapp"
            onPress={() => Linking.openURL('https://instagram.com/formfactorapp')}
          />
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
  faqCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  supportOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  supportIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 11,
    backgroundColor: 'rgba(76, 140, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  supportTextContainer: {
    flex: 1,
  },
  supportTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1A1A2E',
  },
  supportSubtitle: {
    fontSize: 13,
    color: '#6781A6',
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginLeft: 72,
  },
  faqItem: {
    padding: 16,
  },
  faqHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  faqQuestion: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1A1A2E',
    flex: 1,
    marginRight: 8,
  },
  faqAnswer: {
    fontSize: 14,
    color: '#6781A6',
    marginTop: 12,
    lineHeight: 20,
  },
  faqDivider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginHorizontal: 16,
  },
  bottomSpacer: {
    height: 40,
  },
});
