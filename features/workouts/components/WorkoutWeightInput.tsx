import React, { useEffect, useRef, useState } from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { formatWorkoutWeight, workoutWeightToPounds, type WorkoutWeightUnit } from '@/lib/workouts/weight';

interface Props extends Omit<TextInputProps, 'value' | 'onChange' | 'onChangeText'> {
  /** Canonical pounds; null means not specified, zero is an explicit load. */
  value: number | null;
  unit: WorkoutWeightUnit;
  onChange: (pounds: number | null) => void;
}

export function WorkoutWeightInput({ value, unit, onChange, ...props }: Props) {
  const [text, setText] = useState(() => value == null ? '' : formatWorkoutWeight(value, unit));
  const focused = useRef(false);
  const previousUnit = useRef(unit);
  useEffect(() => {
    if (!focused.current || previousUnit.current !== unit) {
      setText(value == null ? '' : formatWorkoutWeight(value, unit));
    }
    previousUnit.current = unit;
  }, [value, unit]);

  return <TextInput {...props} accessibilityLabel={`Weight (${unit})`} keyboardType="decimal-pad"
    value={text}
    onFocus={() => { focused.current = true; }}
    onBlur={() => { focused.current = false; }}
    onChangeText={(raw) => {
      const normalized = raw.replace(',', '.');
      if (!/^\d*\.?\d*$/.test(normalized)) return;
      const isUnspecified = normalized === '' || normalized === '.';
      const parsed = isUnspecified ? null : Number(normalized);
      if (parsed !== null && !Number.isFinite(parsed)) return;
      setText(raw);
      onChange(parsed === null ? null : workoutWeightToPounds(parsed, unit));
    }} />;
}
