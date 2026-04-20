import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  resolveCloudProvider,
  setCloudProviderPreference,
  type CoachCloudProvider,
} from '@/lib/services/coach-cloud-provider';
import { warnWithTs } from '@/lib/logger';

interface ProviderOption {
  value: CoachCloudProvider;
  label: string;
  description: string;
  disabledMessage?: string;
}

interface CoachCloudProviderPickerProps {
  /**
   * Whether the Gemma provider is available (e.g. GEMINI_API_KEY is set on
   * the server). When false, the Gemma option renders disabled with a hint.
   * Defaults to true — callers wire a real probe in when ready.
   */
  available?: boolean;
  /**
   * Optional external value; if provided the component is controlled. When
   * omitted, the picker reads the persisted preference on mount.
   */
  value?: CoachCloudProvider;
  onChange?: (provider: CoachCloudProvider) => void;
  testID?: string;
}

const OPTIONS: ProviderOption[] = [
  {
    value: 'openai',
    label: 'OpenAI (default)',
    description: 'gpt-5.4-mini via your existing key. Highest accuracy for nuanced prompts.',
  },
  {
    value: 'gemma',
    label: 'Google Gemma 3',
    description: 'gemma-3-4b-it via Gemini. Fast, cheap ($0.04/M in), 1,500 req/day free tier.',
    disabledMessage: 'Gemma unavailable — set GEMINI_API_KEY',
  },
];

export function CoachCloudProviderPicker({
  available = true,
  value,
  onChange,
  testID = 'coach-cloud-provider-picker',
}: CoachCloudProviderPickerProps) {
  const [selected, setSelected] = useState<CoachCloudProvider | null>(value ?? null);
  const [loading, setLoading] = useState<boolean>(value === undefined);
  const [persisting, setPersisting] = useState<boolean>(false);
  const isControlled = value !== undefined;

  useEffect(() => {
    if (isControlled) {
      setSelected(value ?? null);
      return;
    }

    let active = true;
    setLoading(true);
    resolveCloudProvider()
      .then((resolved) => {
        if (!active) return;
        setSelected(resolved);
      })
      .catch((err) => {
        warnWithTs('[coach-cloud-provider-picker] load failed', err);
        if (active) setSelected('openai');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isControlled, value]);

  const handleSelect = useCallback(
    async (provider: CoachCloudProvider, disabled: boolean) => {
      if (disabled) return;
      if (selected === provider) return;

      setSelected(provider);

      if (isControlled) {
        onChange?.(provider);
        return;
      }

      setPersisting(true);
      try {
        await setCloudProviderPreference(provider);
        onChange?.(provider);
      } catch (err) {
        warnWithTs('[coach-cloud-provider-picker] persist failed', err);
      } finally {
        setPersisting(false);
      }
    },
    [isControlled, onChange, selected],
  );

  return (
    <View style={styles.container} testID={testID}>
      <Text style={styles.heading}>Cloud coach provider</Text>
      <Text style={styles.subheading}>
        Choose which model powers AI Coach responses. You can switch back any time.
      </Text>

      {loading ? (
        <View style={styles.loadingRow} testID={`${testID}-loading`}>
          <ActivityIndicator color="#4C8CFF" />
          <Text style={styles.loadingLabel}>Loading preference…</Text>
        </View>
      ) : (
        OPTIONS.map((option) => {
          const disabled = option.value === 'gemma' && !available;
          const isSelected = selected === option.value;
          return (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.optionRow,
                isSelected && styles.optionRowSelected,
                disabled && styles.optionRowDisabled,
              ]}
              activeOpacity={disabled ? 1 : 0.7}
              onPress={() => handleSelect(option.value, disabled)}
              disabled={disabled || persisting}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected, disabled }}
              testID={`${testID}-option-${option.value}`}
            >
              <View style={styles.radioOuter}>
                {isSelected && !disabled && <View style={styles.radioInner} />}
              </View>
              <View style={styles.optionText}>
                <Text style={[styles.optionLabel, disabled && styles.optionLabelDisabled]}>
                  {option.label}
                </Text>
                <Text style={[styles.optionDescription, disabled && styles.optionDescriptionDisabled]}>
                  {disabled && option.disabledMessage
                    ? option.disabledMessage
                    : option.description}
                </Text>
              </View>
              {disabled && (
                <Ionicons
                  name="lock-closed"
                  size={16}
                  color="#9AACD1"
                  accessibilityLabel="Unavailable"
                />
              )}
            </TouchableOpacity>
          );
        })
      )}
    </View>
  );
}

export default CoachCloudProviderPicker;

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  heading: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0B1A3B',
  },
  subheading: {
    fontSize: 13,
    color: '#5A6C8F',
    marginBottom: 4,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  loadingLabel: {
    fontSize: 14,
    color: '#5A6C8F',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#F2F5FB',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  optionRowSelected: {
    borderColor: '#4C8CFF',
    backgroundColor: '#EAF1FF',
  },
  optionRowDisabled: {
    opacity: 0.55,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#4C8CFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#4C8CFF',
  },
  optionText: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#0B1A3B',
  },
  optionLabelDisabled: {
    color: '#5A6C8F',
  },
  optionDescription: {
    fontSize: 13,
    color: '#5A6C8F',
    lineHeight: 18,
  },
  optionDescriptionDisabled: {
    color: '#9AACD1',
  },
});
