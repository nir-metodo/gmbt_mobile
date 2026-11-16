import React, { useEffect, useState } from 'react';
import { View, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Portal, Modal, Text, Button, ActivityIndicator, RadioButton, TextInput } from 'react-native-paper';
import { useAppTheme } from '../hooks/useAppTheme';
import { useRTL } from '../hooks/useRTL';
import { leadsApi } from '../services/api/leads';
import { registerWonDealHost, type WonDealRequest } from '../utils/wonDeal';

const CURRENCY_SYMBOL: Record<string, string> = { ILS: '₪', '₪': '₪', USD: '$', EUR: '€' };
const fmt = (n: number, cur?: string) => `${CURRENCY_SYMBOL[cur || 'ILS'] || cur || '₪'}${Number(n || 0).toLocaleString('he-IL')}`;

// Global host (mounted once in app/_layout.tsx): confirms the deal amount whenever a lead is moved to a won stage.
// Amount can come from a linked quote (its total), from the lead's own value, or be typed manually.
export function WonDealDialogHost() {
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const tr = (he: string, en: string) => (isRTL ? he : en);
  const [req, setReq] = useState<WonDealRequest | null>(null);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [choice, setChoice] = useState('manual'); // 'quote:<id>' | 'lead' | 'manual'
  const [manual, setManual] = useState('');

  useEffect(() => {
    registerWonDealHost((r) => setReq(r));
    return () => registerWonDealHost(null);
  }, []);

  const leadValue = parseFloat(String(req?.lead?.value ?? '')) || 0;
  const leadCurrency = req?.lead?.currency || 'ILS';

  useEffect(() => {
    if (!req) return undefined;
    let cancelled = false;
    setQuotes([]);
    setManual('');
    setLoading(true);
    (async () => {
      let found: any[] = [];
      try {
        if (req.lead?.id && req.organization) {
          const all = await leadsApi.getLeadQuotes(req.organization, req.lead.id);
          found = all.filter((q) => q.total > 0 && q.status !== 'rejected' && q.status !== 'expired');
        }
      } catch { /* fall back to lead amount / manual */ }
      if (cancelled) return;
      setQuotes(found);
      const paid = found.find((q) => q.status === 'paid' || q.paymentStatus === 'paid');
      if (paid) setChoice(`quote:${paid.id}`);
      else if (found.length > 0) setChoice(`quote:${found[0].id}`);
      else if (leadValue > 0) setChoice('lead');
      else setChoice('manual');
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);

  const close = (result: Parameters<WonDealRequest['resolve']>[0]) => {
    req?.resolve(result);
    setReq(null);
  };

  const manualNum = parseFloat(String(manual).replace(/,/g, ''));
  const manualValid = Number.isFinite(manualNum) && manualNum >= 0;
  const canConfirm = !loading && (choice !== 'manual' || manualValid);

  const confirm = () => {
    if (choice.startsWith('quote:')) {
      const q = quotes.find((x) => `quote:${x.id}` === choice);
      if (q) { close({ dealValue: q.total, dealSource: 'quote', dealQuoteId: q.id }); return; }
    }
    if (choice === 'lead') { close({ dealValue: leadValue, dealSource: 'lead' }); return; }
    if (!manualValid) return;
    close({ dealValue: manualNum, dealSource: 'manual' });
  };

  const row = (key: string, label: string, right: React.ReactNode, sub?: string) => {
    const active = choice === key;
    return (
      <TouchableOpacity
        key={key}
        activeOpacity={0.7}
        onPress={() => setChoice(key)}
        style={[styles.row, { flexDirection, borderColor: active ? theme.colors.primary : theme.colors.outlineVariant, backgroundColor: active ? theme.colors.primaryContainer : 'transparent' }]}
      >
        <RadioButton value={key} status={active ? 'checked' : 'unchecked'} onPress={() => setChoice(key)} color={theme.colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.onSurface, textAlign }}>{label}</Text>
          {sub ? <Text variant="bodySmall" style={{ color: '#15803d', fontWeight: '700', textAlign }}>{sub}</Text> : null}
        </View>
        {right}
      </TouchableOpacity>
    );
  };

  // Mount the Portal only while a request is open so it stacks above any modal that is already showing.
  if (!req) return null;

  return (
    <Portal>
      <Modal visible={true} onDismiss={() => close(null)} contentContainerStyle={[styles.container, { backgroundColor: theme.colors.surface }]}>
        <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', textAlign }}>
          🏆 {tr('אישור סכום העסקה', 'Confirm deal amount')}
        </Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2, marginBottom: 12, textAlign }}>
          {req?.lead?.title ? `${req.lead.title} — ` : ''}
          {tr('מה סכום העסקה שנסגרה?', 'What is the value of the closed deal?')}
        </Text>

        {loading ? (
          <ActivityIndicator style={{ marginVertical: 16 }} />
        ) : (
          <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
            {quotes.map((q) => {
              const paid = q.status === 'paid' || q.paymentStatus === 'paid';
              return row(
                `quote:${q.id}`,
                `${tr('מהצעת מחיר', 'From quote')} ${q.quoteNumber ? `#${q.quoteNumber}` : ''}`,
                <Text style={{ fontWeight: '700', color: theme.colors.onSurface }}>{fmt(q.total, q.currency)}</Text>,
                paid ? tr('✓ שולמה', '✓ paid') : undefined,
              );
            })}
            {leadValue > 0 && row('lead', tr('סכום הליד', 'Lead amount'), <Text style={{ fontWeight: '700', color: theme.colors.onSurface }}>{fmt(leadValue, leadCurrency)}</Text>)}
            {row(
              'manual',
              tr('הזנה ידנית', 'Enter manually'),
              <TextInput
                mode="outlined"
                dense
                keyboardType="numeric"
                value={manual}
                onFocus={() => setChoice('manual')}
                onChangeText={(v) => { setManual(v); setChoice('manual'); }}
                placeholder="0"
                style={{ width: 110, height: 40, textAlign: 'center' }}
              />,
            )}
          </ScrollView>
        )}

        <View style={{ flexDirection, gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button mode="contained" onPress={confirm} disabled={!canConfirm}>
            {tr('אשר והעבר ל"הצטרף"', 'Confirm & mark as won')}
          </Button>
          <Button mode="outlined" onPress={() => close(null)}>{tr('ביטול', 'Cancel')}</Button>
        </View>
        <Button compact onPress={() => close({})} style={{ marginTop: 6, alignSelf: 'center' }} textColor={theme.colors.onSurfaceVariant}>
          {tr('העבר בלי לשנות סכום', 'Move without changing amount')}
        </Button>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  container: { margin: 20, padding: 20, borderRadius: 16 },
  row: { alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 10, borderWidth: 1, marginBottom: 8 },
});

export default WonDealDialogHost;
