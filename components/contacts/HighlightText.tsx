import React from 'react';
import { Text as RNText } from 'react-native';
import { Text } from 'react-native-paper';
import type { TextProps } from 'react-native-paper';

// Renders `text` with every search match highlighted. Pure/cheap: used on the visible list rows only
// while a search is active; with no query it degrades to a plain <Text>.

type Range = [number, number];

function mergeRanges(ranges: Range[]): Range[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Range[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i][0] <= last[1]) last[1] = Math.max(last[1], sorted[i][1]);
    else out.push(sorted[i]);
  }
  return out;
}

export function textMatchRanges(text: string, tokens: string[]): Range[] {
  if (!text || tokens.length === 0) return [];
  const lower = text.toLowerCase();
  const ranges: Range[] = [];
  for (const tok of tokens) {
    const t = tok.toLowerCase();
    if (!t) continue;
    let from = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const i = lower.indexOf(t, from);
      if (i < 0) break;
      ranges.push([i, i + t.length]);
      from = i + t.length;
    }
  }
  return mergeRanges(ranges);
}

// Highlights a typed phone fragment inside a formatted number ("+972-50-123-4567"): the match is
// found on the digits only and mapped back onto the formatted string, so "0501234567", "50123",
// "972501" all light up the right characters regardless of dashes.
export function phoneMatchRanges(formatted: string, nationalDigits: string): Range[] {
  if (!formatted || !nationalDigits) return [];
  const positions: number[] = [];
  let digits = '';
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i])) {
      positions.push(i);
      digits += formatted[i];
    }
  }
  const idx = digits.indexOf(nationalDigits);
  if (idx < 0) return [];
  return [[positions[idx], positions[idx + nationalDigits.length - 1] + 1]];
}

interface Props extends Omit<TextProps<never>, 'children'> {
  text: string;
  ranges?: Range[];
  tokens?: string[];
  highlightColor: string;
  highlightTextColor?: string;
}

export default function HighlightText({
  text,
  ranges,
  tokens,
  highlightColor,
  highlightTextColor,
  ...rest
}: Props) {
  const rs = ranges ?? (tokens ? textMatchRanges(text, tokens) : []);
  if (rs.length === 0) return <Text {...(rest as any)}>{text}</Text>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  rs.forEach(([s, e], i) => {
    if (s > cursor) parts.push(text.slice(cursor, s));
    parts.push(
      // Plain RN Text so the span inherits the parent's size/weight/family.
      <RNText
        key={i}
        style={{
          backgroundColor: highlightColor,
          ...(highlightTextColor ? { color: highlightTextColor } : null),
        }}
      >
        {text.slice(s, e)}
      </RNText>,
    );
    cursor = e;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <Text {...(rest as any)}>{parts}</Text>;
}
