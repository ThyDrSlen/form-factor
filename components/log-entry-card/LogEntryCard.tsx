import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

export interface LogEntryMetadataItem {
  label: string;
  value: string | number | null | undefined;
}

interface LogEntryCardProps {
  title: string;
  subtitle?: string;
  metadata?: LogEntryMetadataItem[];
  footer?: React.ReactNode;
  onPress?: () => void;
  leadingAccessory?: React.ReactNode;
  trailingAccessory?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function LogEntryCard({
  title,
  subtitle,
  metadata,
  footer,
  onPress,
  leadingAccessory,
  trailingAccessory,
  style,
  testID,
}: LogEntryCardProps) {
  const Container = onPress ? Pressable : View;

  return (
    <View style={[styles.shadowContainer, style]} testID={testID}>
      <Container style={({ pressed }) => [styles.card, pressed && onPress ? styles.cardPressed : null]} onPress={onPress}>
        <View style={styles.headerRow}>
          <View style={styles.headerMain}>
            {leadingAccessory ? <View style={styles.accessory}>{leadingAccessory}</View> : null}
            <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
              {title}
            </Text>
          </View>
          <View style={styles.trailingContainer}>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            {trailingAccessory ? <View style={styles.trailingAccessory}>{trailingAccessory}</View> : null}
          </View>
        </View>

        {metadata && metadata.length > 0 ? (
          <View style={styles.metadataRow}>
            {metadata.map((item, index) => (
              <View style={styles.metadataItem} key={`${item.label}-${index}`}>
                <Text style={styles.metadataValue}>{item.value ?? '—'}</Text>
                <Text style={styles.metadataLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </Container>
    </View>
  );
}

const styles = StyleSheet.create({
  shadowContainer: {
    backgroundColor: '#0F2339',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1B2E4A',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 3,
    overflow: 'hidden',
  },
  card: {
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  cardPressed: {
    opacity: 0.9,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginRight: 12,
  },
  accessory: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F5F7FF',
    flexShrink: 1,
  },
  trailingContainer: {
    alignItems: 'flex-end',
    gap: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#9AACD1',
  },
  trailingAccessory: {
    alignItems: 'flex-end',
  },
  metadataRow: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 16,
    flexWrap: 'wrap',
  },
  metadataItem: {
    minWidth: 72,
  },
  metadataValue: {
    fontSize: 20,
    fontWeight: '600',
    color: '#4C8CFF',
  },
  metadataLabel: {
    fontSize: 12,
    color: '#9AACD1',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  footer: {
    marginTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1B2E4A',
    paddingTop: 12,
  },
});
