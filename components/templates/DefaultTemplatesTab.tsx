import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, Pressable, ScrollView, Modal, Alert, RefreshControl } from 'react-native';
import { Text, ActivityIndicator, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../stores/authStore';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useRTL } from '../../hooks/useRTL';
import { chatsApi } from '../../services/api/chats';
import { campaignsApi, type WaTemplate } from '../../services/api/campaigns';
import axiosInstance from '../../services/api/axiosInstance';
import { analyzeTemplate } from '../campaigns/whatsapp/campaignUtils';

/**
 * Default WhatsApp templates per role: what the app (and the web) sends when the 24h conversation window is CLOSED
 * (opening a conversation, quote, invoice, payment link, digital signature, form). The system creates them with the WhatsApp
 * connection; here the user can see their approval status, pick a different approved template, or create the defaults.
 */
export const ROLES: { key: string; icon: string; he: string; en: string; systemName: string; vars: Record<number, string>; descHe: string; descEn: string }[] = [
  { key: 'openConversation', icon: 'message-plus-outline', he: 'פתיחת שיחה', en: 'Open a conversation', systemName: 'gambot_default_conversation', vars: { 1: 'contact.firstName', 2: 'user.UserName' }, descHe: 'משמשת לפתיחת שיחה עם לקוח כשחלון 24 השעות סגור (שליחה מהצ׳אט, איש קשר, ליד).', descEn: 'Used to start a conversation when the 24-hour window is closed (chat, contact, lead).' },
  { key: 'sendQuote', icon: 'file-document-outline', he: 'הצעת מחיר', en: 'Send a quote', systemName: 'gambot_default_quote', vars: { 1: 'contact.firstName', 2: 'hardcoded' }, descHe: 'משמשת לשליחת הצעת מחיר בוואטסאפ כשהשיחה סגורה.', descEn: 'Used to send a quote on WhatsApp when the conversation is closed.' },
  { key: 'sendInvoice', icon: 'receipt', he: 'חשבונית', en: 'Send an invoice', systemName: 'gambot_default_invoice', vars: { 1: 'contact.firstName', 2: 'hardcoded' }, descHe: 'משמשת לשליחת חשבונית / קבלה בוואטסאפ כשהשיחה סגורה.', descEn: 'Used to send an invoice / receipt on WhatsApp when the conversation is closed.' },
  { key: 'sendPaymentLink', icon: 'cash-fast', he: 'קישור לתשלום', en: 'Send a payment link', systemName: 'gambot_default_payment', vars: { 1: 'contact.firstName', 2: 'hardcoded' }, descHe: 'משמשת לשליחת קישור לתשלום כשהשיחה סגורה.', descEn: 'Used to send a payment link when the conversation is closed.' },
  { key: 'digitalSignature', icon: 'draw', he: 'חתימה דיגיטלית', en: 'Digital signature', systemName: 'gambot_default_signature', vars: { 1: 'contact.firstName', 2: 'hardcoded' }, descHe: 'משמשת לבקשת חתימה דיגיטלית על מסמך כשהשיחה סגורה.', descEn: 'Used to request a digital signature on a document when the conversation is closed.' },
  { key: 'sendForm', icon: 'clipboard-text-outline', he: 'קישור (טופס / מסמך / קטלוג)', en: 'Send a link (form / document / catalog)', systemName: 'gambot_default_form', vars: { 1: 'contact.firstName', 2: 'hardcoded' }, descHe: 'תבנית אחת לכל קישור שנשלח ללקוח — טופס, מסמך למילוי, קטלוג או פריט — כשהשיחה סגורה.', descEn: 'One template for any link sent to the customer — form, fill-in document, catalog or item — when the conversation is closed.' },
];

/** For the templates list: the role (quote / invoice / ...) a default template belongs to + where it is used.
 *  Also covers the ready-made starters created with the account (createdFrom = 'onboarding'). */
export function defaultTemplateInfo(t: any, isRTL: boolean): { title?: string; use: string; setup?: boolean } | null {
  const name = String(t?.name || '');
  const role = ROLES.find((r) => name.startsWith(r.systemName));
  if (role) return { title: `${isRTL ? role.he : role.en} (${isRTL ? 'ברירת מחדל' : 'default'})`, use: isRTL ? role.descHe : role.descEn };
  if (t?.createdFrom === 'onboarding') {
    const use = String(t.sourceNote || '').replace(/^נוצרה אוטומטית על ידי גמבוט בעת יצירת החשבון\.\s*/, '').trim();
    return { use, setup: true };
  }
  return null;
}

const STATUS: Record<string, { bg: string; fg: string; he: string; en: string }> = {
  APPROVED: { bg: '#dcfce7', fg: '#166534', he: 'מאושרת', en: 'Approved' },
  PENDING: { bg: '#fef3c7', fg: '#92400e', he: 'בבדיקה', en: 'Pending' },
  REJECTED: { bg: '#fee2e2', fg: '#991b1b', he: 'נדחתה', en: 'Rejected' },
};

const tplId = (t: WaTemplate) => String(t.Id || t.id || '');
/** Firestore may return [] for an empty string. */
const normId = (v: any) => (Array.isArray(v) || v == null ? '' : String(v));

function mappingsFor(vars: Record<number, string>, bodyText: string) {
  const idx = [...new Set((bodyText.match(/\{\{(\d+)\}\}/g) || []).map((m) => parseInt(m.replace(/\D/g, ''), 10)))].sort((a, b) => a - b);
  return idx.map((i) => ({ index: i, source: vars[i] || 'contact.firstName', hardcodedValue: '' }));
}

export default function DefaultTemplatesTab() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { isRTL, textAlign, flexDirection } = useRTL();
  const tr = (he: string, en: string) => (isRTL ? he : en);
  const org = useAuthStore((s) => s.user?.organization) || '';

  const [assignments, setAssignments] = useState<Record<string, any>>({});
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickRole, setPickRole] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!org) return;
    try {
      const [a, t] = await Promise.all([
        chatsApi.getDefaultMessageTemplates(org).catch(() => null),
        campaignsApi.getTemplates(org).catch(() => [] as WaTemplate[]),
      ]);
      setAssignments(a?.Data?.templates || {});
      setTemplates(t);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [org]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const byId = useMemo(() => {
    const m = new Map<string, WaTemplate>();
    templates.forEach((t) => m.set(tplId(t), t));
    return m;
  }, [templates]);

  const approved = useMemo(
    () => templates.filter((t) => String(t.status || '').toUpperCase() === 'APPROVED')
      .sort((a, b) => String(a.friendlyName || a.name).localeCompare(String(b.friendlyName || b.name))),
    [templates],
  );

  const missing = ROLES.filter((r) => !byId.get(normId(assignments[r.key]?.templateId)));

  const save = useCallback(async (roleKey: string, tpl: WaTemplate) => {
    const role = ROLES.find((r) => r.key === roleKey)!;
    const info = analyzeTemplate(tpl, isRTL);
    const value = { templateId: tplId(tpl), templateName: tpl.name, varMappings: mappingsFor(role.vars, info.bodyText || '') };
    const next = { ...assignments, [roleKey]: value };
    setSaving(true);
    try {
      const res = await axiosInstance.post('/api/Webhooks/SaveDefaultMessageTemplates', { organization: org, templates: next });
      if (res.data?.Success === false) throw new Error(res.data?.Message || 'save failed');
      setAssignments(next);
      setPickRole(null);
    } catch (e: any) {
      Alert.alert(tr('שגיאה', 'Error'), e?.message || tr('השמירה נכשלה', 'Save failed'));
    } finally {
      setSaving(false);
    }
  }, [assignments, org, isRTL]);

  const createDefaults = useCallback(async () => {
    setCreating(true);
    try {
      const res = await axiosInstance.post('/api/Webhooks/CreateSystemDefaultWabaTemplates', { organization: org });
      if (res.data?.Success) {
        Alert.alert(
          tr('נוצר', 'Created'),
          res.data?.Message || tr('התבניות נשלחו לאישור של מטא. עד שיאושרו, שליחה כשהשיחה סגורה לא תעבוד.', 'The templates were sent to Meta for review. Until approved, sending when the conversation is closed will not work.'),
        );
        await load();
      } else {
        Alert.alert(tr('שגיאה', 'Error'), res.data?.Message || tr('יצירת התבניות נכשלה', 'Template creation failed'));
      }
    } catch (e: any) {
      Alert.alert(tr('שגיאה', 'Error'), e?.message || tr('יצירת התבניות נכשלה', 'Template creation failed'));
    } finally {
      setCreating(false);
    }
  }, [org, load, isRTL]);

  if (loading) return <ActivityIndicator style={{ marginTop: 40 }} />;

  const picking = ROLES.find((r) => r.key === pickRole);
  const pickedId = picking ? normId(assignments[picking.key]?.templateId) : '';

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 10 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 13, textAlign, lineHeight: 20 }}>
          {tr(
            'התבניות שנשלחות ללקוח כשהשיחה סגורה (עברו 24 שעות מהודעתו האחרונה). כשהשיחה פתוחה נשלחת הודעה רגילה.',
            'The templates sent to a customer when the conversation is closed (24 hours since their last message). When it is open a regular message is sent.',
          )}
        </Text>

        {missing.length > 0 && (
          <View style={[styles.notice, { backgroundColor: '#fffbeb', borderColor: '#fcd34d' }]}>
            <Text style={{ color: '#92400e', fontSize: 13, textAlign, lineHeight: 20 }}>
              {tr(
                `חסרה תבנית ל-${missing.length} פעולות. בלעדיה אי אפשר לשלוח אותן כשהשיחה סגורה.`,
                `${missing.length} actions have no template, so they cannot be sent when the conversation is closed.`,
              )}
            </Text>
            <Button mode="contained" compact loading={creating} disabled={creating} onPress={createDefaults} buttonColor="#2e6155" textColor="#fff" style={{ marginTop: 10, alignSelf: isRTL ? 'flex-end' : 'flex-start' }}>
              {tr('צור תבניות ברירת מחדל', 'Create default templates')}
            </Button>
          </View>
        )}

        {ROLES.map((role) => {
          const a = assignments[role.key];
          const tpl = byId.get(normId(a?.templateId));
          const st = tpl ? STATUS[String(tpl.status || '').toUpperCase()] : undefined;
          return (
            <Pressable
              key={role.key}
              onPress={() => setPickRole(role.key)}
              style={[styles.row, { flexDirection, backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant }]}
            >
              <View style={[styles.icon, { backgroundColor: '#2e615518' }]}>
                <MaterialCommunityIcons name={role.icon as any} size={22} color="#2e6155" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', fontSize: 15, color: theme.colors.onSurface, textAlign }}>{isRTL ? role.he : role.en}</Text>
                <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, textAlign, marginTop: 2, lineHeight: 17 }}>{isRTL ? role.descHe : role.descEn}</Text>
                <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '600', color: tpl ? theme.colors.onSurface : '#b45309', textAlign, marginTop: 4 }}>
                  {tpl ? (tpl.friendlyName || tpl.name) : tr('לא הוגדרה תבנית', 'No template set')}
                </Text>
              </View>
              {st ? (
                <View style={[styles.pill, { backgroundColor: st.bg }]}>
                  <Text style={{ color: st.fg, fontSize: 11, fontWeight: '700' }}>{isRTL ? st.he : st.en}</Text>
                </View>
              ) : null}
              <MaterialCommunityIcons name={isRTL ? 'chevron-left' : 'chevron-right'} size={20} color={theme.colors.onSurfaceVariant} />
            </Pressable>
          );
        })}
      </ScrollView>

      <Modal visible={!!picking} transparent animationType="slide" onRequestClose={() => setPickRole(null)}>
        <Pressable style={styles.overlay} onPress={() => setPickRole(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: theme.colors.surface, paddingBottom: insets.bottom + 12 }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.handle} />
            <Text style={{ fontWeight: '800', fontSize: 16, color: theme.colors.onSurface, textAlign, marginBottom: 4 }}>
              {picking ? (isRTL ? picking.he : picking.en) : ''}
            </Text>
            <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, textAlign, marginBottom: 10 }}>
              {tr('בחרו תבנית מאושרת', 'Choose an approved template')}
            </Text>
            <ScrollView style={{ maxHeight: 380 }}>
              {approved.length === 0 ? (
                <Text style={{ color: theme.colors.onSurfaceVariant, textAlign, paddingVertical: 16 }}>
                  {tr('אין עדיין תבניות מאושרות.', 'There are no approved templates yet.')}
                </Text>
              ) : approved.map((t) => {
                const on = tplId(t) === pickedId;
                const body = analyzeTemplate(t, isRTL).bodyText || '';
                return (
                  <Pressable
                    key={tplId(t)}
                    disabled={saving}
                    onPress={() => picking && save(picking.key, t)}
                    style={[styles.opt, { flexDirection, borderColor: on ? '#2e6155' : theme.colors.outlineVariant, backgroundColor: on ? '#2e615510' : 'transparent' }]}
                  >
                    <MaterialCommunityIcons name={on ? 'radiobox-marked' : 'radiobox-blank'} size={20} color={on ? '#2e6155' : theme.colors.onSurfaceVariant} />
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={{ fontWeight: '700', fontSize: 14, color: theme.colors.onSurface, textAlign }}>{t.friendlyName || t.name}</Text>
                      {body ? <Text numberOfLines={2} style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, textAlign, marginTop: 2 }}>{body}</Text> : null}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
            {saving ? <ActivityIndicator style={{ marginTop: 8 }} /> : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { borderWidth: 1, borderRadius: 12, padding: 14 },
  row: { alignItems: 'center', gap: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 12 },
  icon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  pill: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#cbd5e1', marginBottom: 12 },
  opt: { alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8 },
});
