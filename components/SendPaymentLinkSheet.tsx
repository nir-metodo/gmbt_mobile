import React, { useEffect, useState } from 'react';
import { Modal, View, Alert } from 'react-native';
import { useRTL } from '../hooks/useRTL';
import { paymentsApi } from '../services/api/payments';
import { sendDocAndAlert } from '../utils/sendDocAlert';
import {
  TaskFormFrame,
  TaskFormHeader,
  TaskFormBody,
  TaskFormSubmitBar,
  FormTextField,
  FormSectionLabel,
  ChoiceChips,
  MoreDetailsToggle,
} from './tasks/TaskFormParts';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  /** Called after the payment link was created (and a send was attempted). */
  onDone?: () => void;
  user: any;
  customerName?: string;
  customerPhone: string;
  /** Optional record the payment belongs to (e.g. the contact's open lead). */
  entityType?: string;
  entityId?: string;
}

/**
 * "Request payment" in one step: amount (+ optional description) → creates the clearing link and sends it to the
 * customer through the org's Gambot WhatsApp number (free text when the 24h window is open, the default payment-link
 * template when closed). Email and installments are rarely needed, so they sit under "More details".
 */
export default function SendPaymentLinkSheet({ visible, onDismiss, onDone, user, customerName, customerPhone, entityType, entityId }: Props) {
  const { isRTL } = useRTL();
  const tr = (he: string, en: string) => (isRTL ? he : en);
  const organization: string = user?.organization || '';

  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [installments, setInstallments] = useState('1');
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setAmount('');
    setDescription('');
    setEmail('');
    setInstallments('1');
    setMoreOpen(false);
    setBusy(false);
  }, [visible]);

  const submit = async () => {
    const value = parseFloat(amount.replace(',', '.'));
    if (!value || value <= 0) {
      Alert.alert(tr('שגיאה', 'Error'), tr('נא להזין סכום תקין', 'Please enter a valid amount'));
      return;
    }
    setBusy(true);
    try {
      const result = await paymentsApi.createPaymentLink(organization, {
        amount: value,
        description: description.trim(),
        customerName: customerName || '',
        customerPhone,
        customerEmail: email.trim(),
        payments: parseInt(installments, 10) || 1,
        ...(entityType && entityId ? { entityType, entityId } : {}),
      });
      const url = result?.gambotPaymentUrl || result?.paymentUrl;
      if (!result?.success || !url) {
        Alert.alert(tr('שגיאה', 'Error'), result?.error || tr('יצירת קישור התשלום נכשלה', 'Could not create the payment link'));
        return;
      }
      onDismiss();
      const amountTxt = value.toFixed(2);
      await sendDocAndAlert({
        organization,
        phone: customerPhone,
        role: 'sendPaymentLink',
        user,
        customerName: customerName || '',
        docLabel: description.trim() ? `${description.trim()} - ₪${amountTxt}` : `תשלום על סך ₪${amountTxt}`,
        url,
        liveText: `שלום ${customerName || ''},\nקישור לתשלום על סך ₪${amountTxt}${description.trim() ? ` (${description.trim()})` : ''}:`,
      });
      onDone?.();
    } catch {
      Alert.alert(tr('שגיאה', 'Error'), tr('יצירת קישור התשלום נכשלה', 'Could not create the payment link'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss} statusBarTranslucent>
      <TaskFormFrame dim onBackdropPress={onDismiss}>
        <TaskFormHeader title={tr('בקשת תשלום', 'Request payment')} onClose={onDismiss} />
        <TaskFormBody>
          <FormTextField
            label={`${tr('סכום', 'Amount')} (₪)`}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            autoFocus
          />
          <FormTextField
            label={tr('עבור (אופציונלי)', 'For (optional)')}
            value={description}
            onChangeText={setDescription}
          />

          <MoreDetailsToggle
            expanded={moreOpen}
            onToggle={() => setMoreOpen((v) => !v)}
            summary={tr('אימייל, תשלומים', 'Email, installments')}
          />
          {moreOpen && (
            <View style={{ paddingTop: 8 }}>
              <FormTextField
                label={tr('אימייל הלקוח', 'Customer email')}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <FormSectionLabel icon="credit-card-multiple-outline">{tr('מספר תשלומים', 'Installments')}</FormSectionLabel>
              <ChoiceChips
                value={installments}
                onChange={setInstallments}
                options={['1', '2', '3', '6', '12'].map((n) => ({ key: n, label: n }))}
              />
            </View>
          )}
        </TaskFormBody>
        <TaskFormSubmitBar label={tr('צור ושלח בוואטסאפ', 'Create & send on WhatsApp')} onPress={submit} loading={busy} />
      </TaskFormFrame>
    </Modal>
  );
}
