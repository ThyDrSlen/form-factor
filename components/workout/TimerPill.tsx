/**
 * TimerPill Component
 *
 * Shows the active rest timer countdown below the header.
 * Taps to open the rest timer sheet.
 */

import React, { useEffect, useState } from 'react';
import { TouchableOpacity, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { sessionStyles as styles, colors } from '@/styles/workout-session.styles';
import { useSessionRunner } from '@/lib/stores/session-runner';
import { computeRemainingSeconds, formatRestTime } from '@/lib/services/rest-timer';

interface TimerPillProps {
  onPress: () => void;
}

export default function TimerPill({ onPress }: TimerPillProps) {
  const restTimer = useSessionRunner((s) => s.restTimer);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!restTimer) {
      setRemaining(0);
      return;
    }

    const update = () => {
      const r = computeRemainingSeconds(restTimer.startedAt, restTimer.targetSeconds);
      setRemaining(r);
      if (r <= 0) {
        // Rest is done naturally
        setRemaining(0);
      }
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [restTimer]);

  const isActive = restTimer && remaining > 0;

  return (
    <TouchableOpacity
      style={[styles.timerPill, !isActive && styles.timerPillInactive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Ionicons
        name={isActive ? 'timer-outline' : 'time-outline'}
        size={18}
        color={isActive ? colors.restActive : colors.accent}
      />
      <Text style={[styles.timerPillText, !isActive && styles.timerPillTextInactive]}>
        {isActive ? formatRestTime(remaining) : '0:00'}
      </Text>
    </TouchableOpacity>
  );
}
