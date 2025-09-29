import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../../contexts/AuthContext';
import { DashboardHealth } from '@/components';

export default function HomeScreen() {
  const { user } = useAuth();
  const router = useRouter();

  // Get display name from user metadata or fallback to email
  const getDisplayName = () => {
    if (user?.user_metadata?.full_name) {
      return user.user_metadata.full_name;
    }
    if (user?.user_metadata?.name) {
      return user.user_metadata.name;
    }
    return user?.email?.split('@')[0] || 'User';
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome back, {getDisplayName()}!</Text>
      <Text style={styles.subtitle}>Ready to crush your fitness goals today?</Text>
      
      <View style={styles.content}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        
        <View style={styles.actionGrid}>
          <TouchableOpacity 
            style={styles.actionCardWrapper}
            onPress={() => {
              console.log('Navigating to add-workout');
              router.push('/add-workout');
            }}
          >
            <LinearGradient
              colors={['#0F2339', '#081526']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.actionCard}
            >
              <View style={styles.actionIcon}>
                <Text style={styles.actionIconText}>💪</Text>
              </View>
              <Text style={styles.actionTitle}>Log Workout</Text>
              <Text style={styles.actionSubtitle}>Track your exercise</Text>
            </LinearGradient>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.actionCardWrapper}
            onPress={() => {
              console.log('Navigating to add-food');
              router.push('/add-food');
            }}
          >
            <LinearGradient
              colors={['#0F2339', '#081526']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.actionCard}
            >
              <View style={styles.actionIcon}>
                <Text style={styles.actionIconText}>🍎</Text>
              </View>
              <Text style={styles.actionTitle}>Log Meal</Text>
              <Text style={styles.actionSubtitle}>Track your nutrition</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
        
        <View style={styles.statsSection}>
          <Text style={styles.sectionTitle}>This Week</Text>
          <View style={styles.statsGrid}>
            <LinearGradient
              colors={['#0F2339', '#081526']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.statCard}
            >
              <Text style={styles.statNumber}>0</Text>
              <Text style={styles.statLabel}>Workouts</Text>
            </LinearGradient>
            <LinearGradient
              colors={['#0F2339', '#081526']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.statCard}
            >
              <Text style={styles.statNumber}>0</Text>
              <Text style={styles.statLabel}>Meals Logged</Text>
            </LinearGradient>
          </View>
        </View>

        {/* Health metrics from Apple Health */}
        <DashboardHealth />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050E1F',
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#F5F7FF',
    marginTop: 16,
  },
  subtitle: {
    fontSize: 16,
    color: '#9AACD1',
    marginTop: 8,
  },
  content: {
    flex: 1,
    marginTop: 32,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#F5F7FF',
    marginBottom: 16,
  },
  actionGrid: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 32,
  },
  actionCardWrapper: {
    flex: 1,
  },
  actionCard: {
    borderRadius: 24,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  actionIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(76, 140, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  actionIconText: {
    fontSize: 24,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F5F7FF',
    marginBottom: 4,
  },
  actionSubtitle: {
    fontSize: 14,
    color: '#9AACD1',
    textAlign: 'center',
  },
  statsSection: {
    marginTop: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 16,
  },
  statCard: {
    flex: 1,
    borderRadius: 24,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  statNumber: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#4C8CFF',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    color: '#9AACD1',
    textAlign: 'center',
  },
});