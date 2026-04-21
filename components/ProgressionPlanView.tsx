import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

type InlineToken = { kind: 'text' | 'bold'; value: string };

type Block =
  | { kind: 'heading'; level: number; tokens: InlineToken[] }
  | { kind: 'bullet'; depth: number; tokens: InlineToken[] }
  | { kind: 'paragraph'; tokens: InlineToken[] }
  | { kind: 'spacer' };

function tokenizeInline(line: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    if (match.index > lastIdx) {
      tokens.push({ kind: 'text', value: line.slice(lastIdx, match.index) });
    }
    tokens.push({ kind: 'bold', value: match[1] });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < line.length) {
    tokens.push({ kind: 'text', value: line.slice(lastIdx) });
  }
  return tokens;
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  for (const raw of lines) {
    if (!raw.trim()) {
      blocks.push({ kind: 'spacer' });
      continue;
    }
    const headingMatch = raw.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        kind: 'heading',
        level: headingMatch[1].length,
        tokens: tokenizeInline(headingMatch[2]),
      });
      continue;
    }
    const bulletMatch = raw.match(/^(\s*)[-*]\s+(.*)$/);
    if (bulletMatch) {
      const depth = Math.floor(bulletMatch[1].length / 2);
      blocks.push({
        kind: 'bullet',
        depth,
        tokens: tokenizeInline(bulletMatch[2]),
      });
      continue;
    }
    blocks.push({ kind: 'paragraph', tokens: tokenizeInline(raw.trim()) });
  }
  return blocks;
}

function renderTokens(tokens: InlineToken[], boldColor: string) {
  return tokens.map((t, i) =>
    t.kind === 'bold' ? (
      <Text key={i} style={[styles.bold, { color: boldColor }]}>
        {t.value}
      </Text>
    ) : (
      <Text key={i}>{t.value}</Text>
    ),
  );
}

export interface ProgressionPlanViewProps {
  source: string;
  textColor?: string;
  mutedColor?: string;
  accentColor?: string;
}

export function ProgressionPlanView({
  source,
  textColor = '#F8F9FF',
  mutedColor = '#8E9BAD',
  accentColor = '#4C8CFF',
}: ProgressionPlanViewProps) {
  const blocks = useMemo(() => parseBlocks(source), [source]);

  return (
    <View style={styles.container}>
      {blocks.map((block, i) => {
        if (block.kind === 'spacer') return <View key={i} style={styles.spacer} />;

        if (block.kind === 'heading') {
          const sizeStyle =
            block.level <= 1 ? styles.h1 : block.level === 2 ? styles.h2 : styles.h3;
          return (
            <Text
              key={i}
              style={[styles.heading, sizeStyle, { color: textColor }]}
              accessibilityRole="header"
            >
              {renderTokens(block.tokens, accentColor)}
            </Text>
          );
        }

        if (block.kind === 'bullet') {
          return (
            <View key={i} style={[styles.bulletRow, { marginLeft: block.depth * 14 }]}>
              <Text style={[styles.bulletDot, { color: mutedColor }]}>•</Text>
              <Text style={[styles.bulletText, { color: textColor }]}>
                {renderTokens(block.tokens, accentColor)}
              </Text>
            </View>
          );
        }

        return (
          <Text key={i} style={[styles.paragraph, { color: textColor }]}>
            {renderTokens(block.tokens, accentColor)}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 2 },
  heading: { fontWeight: '700', marginTop: 8, marginBottom: 4 },
  h1: { fontSize: 18 },
  h2: { fontSize: 16 },
  h3: { fontSize: 15 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 1 },
  bulletDot: { width: 14, fontSize: 14, lineHeight: 20 },
  bulletText: { flex: 1, fontSize: 14, lineHeight: 20 },
  paragraph: { fontSize: 14, lineHeight: 20, marginVertical: 2 },
  spacer: { height: 6 },
  bold: { fontWeight: '700' },
});

export default ProgressionPlanView;
