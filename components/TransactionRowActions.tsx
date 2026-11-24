import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { sendDocAndAlert } from '../utils/sendDocAlert';
import type { Transaction } from '../services/api/payments';

interface Props {
  tx: Transaction;
  user: any;
}

/** Quick action on a transaction row: send the payment link on WhatsApp (confirm first). Only for unpaid transactions that have a link and a phone. */
export function TransactionRowActions({ tx, user }: Props) {
  const [sending, setSending] = useState(false);
  const link = tx.gambotPaymentUrl || tx.paymentUrl || '';
  const phone = tx.customerPhone || '';
  const amount = (parseFloat(String(tx.amount)) || 0).toFixed(2);

  const send = useCallback(() => {
    Alert.alert(
      'שליחה בוואטסאפ',
      `לשלוח את קישור התשלום על סך ₪${amount} ל${tx.customerName || phone}?\nבהודעה רגילה, או בתבנית כשהשיחה סגורה.`,
      [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'שלח',
          onPress: async () => {
            setSending(true);
            try {
              await sendDocAndAlert({
                organization: user.organization,
                phone,
                role: 'sendPaymentLink',
                user,
                customerName: tx.customerName || '',
                docLabel: `תשלום על סך ₪${amount}`,
                url: link,
                liveText: `שלום ${tx.customerName || ''},\nקישור לתשלום על סך ₪${amount}:`,
              });
            } finally {
              setSending(false);
            }
          },
        },
      ],
    );
  }, [amount, tx, phone, link, user]);

  if (tx.status === 'paid' || !link || !phone || !user?.organization) return null;

  return (
    <Pressable onPress={send} disabled={sending} hitSlop={8} style={[styles.btn, { backgroundColor: '#25D36622' }]}>
      {sending
        ? <ActivityIndicator size="small" color="#16a34a" />
        : <MaterialCommunityIcons name="whatsapp" size={20} color="#16a34a" />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});

export default TransactionRowActions;
