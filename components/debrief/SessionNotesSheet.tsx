/**
 * SessionNotesSheet (wave-30 A18).
 *
 * Floating sheet attached to the form-tracking debrief that lets the user:
 *   - jot free-text notes on the session
 *   - star up to two top faults so the coach remembers what they cared about
 *   - opt-in "Save cues for next time" which tells the personalized-cue
 *     engine to keep today's cues hot
 *
 * State is persisted locally via `localDB.saveDebriefNotes` so the debrief
 * can be re-opened without losing context.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { localDB } from '@/lib/services/database/local-db';
import { warnWithTs } from '@/lib/logger';

export interface SessionNotesSheetTopFault {
  id: string;
  label: string;
}

export interface SessionNotesSheetProps {
  sessionId: string;
  /** Top-2 worst faults the user can star. Extras are ignored. */
  topFaults?: SessionNotesSheetTopFault[];
  /** Optional testID override. */
  testID?: string;
}

export function SessionNotesSheet({
  sessionId,
  topFaults = [],
  testID = 'session-notes-sheet',
}: SessionNotesSheetProps) {
  const [notes, setNotes] = useState('');
  const [starredIds, setStarredIds] = useState<string[]>([]);
  const [saveCues, setSaveCues] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Limit to the first two top faults per spec.
  const faults = topFaults.slice(0, 2);

  // Hydrate once on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const existing = await localDB.getDebriefNotes(sessionId);
        if (cancelled) return;
        if (existing) {
          setNotes(existing.notes);
          setStarredIds(existing.starredFaultIds);
          setSaveCues(existing.savedCues);
        }
      } catch (err) {
        warnWithTs('[SessionNotesSheet] hydrate failed', err);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [sessionId]);

  const persist = useCallback(
    (nextNotes: string, nextStarred: string[], nextSaveCues: boolean) => {
      if (!hydrated) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void localDB
          .saveDebriefNotes(sessionId, nextNotes, nextStarred, nextSaveCues)
          .catch((err) => {
            warnWithTs('[SessionNotesSheet] saveDebriefNotes failed', err);
          });
      }, 350);
    },
    [hydrated, sessionId],
  );

  const handleNotesChange = useCallback(
    (text: string) => {
      setNotes(text);
      persist(text, starredIds, saveCues);
    },
    [persist, starredIds, saveCues],
  );

  const toggleStar = useCallback(
    (faultId: string) => {
      setStarredIds((prev) => {
        const next = prev.includes(faultId)
          ? prev.filter((id) => id !== faultId)
          : [...prev, faultId];
        persist(notes, next, saveCues);
        return next;
      });
    },
    [notes, persist, saveCues],
  );

  const handleSaveCuesToggle = useCallback(
    (next: boolean) => {
      setSaveCues(next);
      persist(notes, starredIds, next);
    },
    [notes, starredIds, persist],
  );

  const handleSubmit = useCallback(() => {
    Keyboard.dismiss();
    persist(notes, starredIds, saveCues);
  }, [notes, starredIds, saveCues, persist]);

  return (
    <View style={styles.sheet} testID={testID}>
      <Text style={styles.heading}>Quick notes</Text>

      <TextInput
        value={notes}
        onChangeText={handleNotesChange}
        placeholder="What felt strong? What needs work?"
        placeholderTextColor="#6781A6"
        style={styles.input}
        multiline
        returnKeyType={Platform.OS === 'ios' ? 'default' : 'done'}
        onSubmitEditing={handleSubmit}
        blurOnSubmit={false}
        testID={`${testID}-notes-input`}
      />

      {faults.length > 0 ? (
        <View style={styles.faultsRow}>
          <Text style={styles.faultsLabel}>Star faults you care about</Text>
          <View style={styles.faultsButtons}>
            {faults.map((fault) => {
              const starred = starredIds.includes(fault.id);
              return (
                <Pressable
                  key={fault.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: starred }}
                  accessibilityLabel={
                    starred ? `Unstar ${fault.label}` : `Star ${fault.label}`
                  }
                  onPress={() => toggleStar(fault.id)}
                  style={({ pressed }) => [
                    styles.faultChip,
                    starred ? styles.faultChipStarred : null,
                    pressed ? styles.faultChipPressed : null,
                  ]}
                  testID={`${testID}-fault-${fault.id}`}
                >
                  <Ionicons
                    name={starred ? 'star' : 'star-outline'}
                    size={14}
                    color={starred ? '#FFB84C' : '#9AACD1'}
                  />
                  <Text
                    style={[
                      styles.faultChipText,
                      starred ? styles.faultChipTextStarred : null,
                    ]}
                  >
                    {fault.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={styles.cueRow}>
        <View style={styles.cueRowLabel}>
          <Text style={styles.cueLabel}>Save cues for next time</Text>
          <Text style={styles.cueSublabel}>
            Keep today&apos;s top cues personalized in your next session.
          </Text>
        </View>
        <Switch
          value={saveCues}
          onValueChange={handleSaveCuesToggle}
          trackColor={{ false: '#2A3A54', true: '#4C8CFF' }}
          testID={`${testID}-save-cues-toggle`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: '#0F2339',
    borderRadius: 18,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  heading: {
    color: '#F5F7FF',
    fontSize: 15,
    fontWeight: '700',
  },
  input: {
    backgroundColor: '#050E1F',
    borderRadius: 12,
    padding: 12,
    color: '#F5F7FF',
    fontSize: 14,
    minHeight: 84,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  faultsRow: {
    gap: 8,
  },
  faultsLabel: {
    color: '#9AACD1',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  faultsButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  faultChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(154, 172, 209, 0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(154, 172, 209, 0.3)',
  },
  faultChipStarred: {
    backgroundColor: 'rgba(255, 184, 76, 0.1)',
    borderColor: 'rgba(255, 184, 76, 0.45)',
  },
  faultChipPressed: {
    opacity: 0.7,
  },
  faultChipText: {
    color: '#C9D7F4',
    fontSize: 12,
    fontWeight: '600',
  },
  faultChipTextStarred: {
    color: '#FFB84C',
  },
  cueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cueRowLabel: {
    flex: 1,
  },
  cueLabel: {
    color: '#F5F7FF',
    fontSize: 13,
    fontWeight: '600',
  },
  cueSublabel: {
    color: '#9AACD1',
    fontSize: 11,
    marginTop: 2,
  },
});

export default SessionNotesSheet;
