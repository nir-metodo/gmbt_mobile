import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useRTL } from '../hooks/useRTL';
import { getOpenDocs, useOpenDocs } from '../utils/openDocs';

// Small indicators: "open quote" and "pending payment" for a contact (phone) or a lead (leadId).
// Tap → straight to the quote (or the quotes list when there are several) / the transactions screen.
const fmtMoney = (amount: number, currency?: string) => {
  const n = Number(amount) || 0;
  if (n <= 0) return '';
  try {
    return new Intl.NumberFormat('he-IL', { style: 'currency', currency: currency || 'ILS', maximumFractionDigits: 0 }).format(n);
  } catch {
    return String(Math.round(n));
  }
};

interface Props { organization?: string; phone?: string; leadId?: string }

export default function OpenDocsChips({ organization, phone, leadId }: Props) {
  const router = useRouter();
  const { isRTL } = useRTL();
  const summary = useOpenDocs(organization);
  const { quotes, payments } = getOpenDocs(summary, { phone, leadId });
  if (!quotes.length && !payments.length) return null;

  const quoteTotal = quotes.length === 1 ? fmtMoney(quotes[0].total, quotes[0].currency) : '';
  const payTotal = payments.length === 1 ? fmtMoney(payments[0].amount, 'ILS') : '';

  return (
    <>
      {quotes.length > 0 && (
        <Pressable
          style={[styles.chip, { backgroundColor: '#eff6ff' }]}
          onPress={() => (quotes.length === 1
            ? router.push({ pathname: '/(tabs)/more/quotes/[id]', params: { id: quotes[0].id } } as any)
            : router.push('/(tabs)/more/quotes' as any))}
        >
          <MaterialCommunityIcons name="file-document-outline" size={12} color="#1d4ed8" />
          <Text style={[styles.text, { color: '#1d4ed8' }]}>
            {quotes.length > 1 ? (isRTL ? `${quotes.length} הצעות פתוחות` : `${quotes.length} open quotes`) : (isRTL ? 'הצעה פתוחה' : 'Open quote')}
            {quoteTotal ? ` · ${quoteTotal}` : ''}
          </Text>
        </Pressable>
      )}
      {payments.length > 0 && (
        <Pressable style={[styles.chip, { backgroundColor: '#fffbeb' }]} onPress={() => router.push('/(tabs)/more/transactions' as any)}>
          <MaterialCommunityIcons name="credit-card-clock-outline" size={12} color="#b45309" />
          <Text style={[styles.text, { color: '#b45309' }]}>
            {payments.length > 1 ? (isRTL ? `${payments.length} סליקות ממתינות` : `${payments.length} pending payments`) : (isRTL ? 'סליקה ממתינה' : 'Pending payment')}
            {payTotal ? ` · ${payTotal}` : ''}
          </Text>
        </Pressable>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  text: { fontSize: 10, fontWeight: '700' },
});
