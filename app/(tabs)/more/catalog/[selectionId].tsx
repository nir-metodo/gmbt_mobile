import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Linking,
  Alert,
} from 'react-native';
import {
  Text,
  Appbar,
  ActivityIndicator,
  Divider,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { catalogApi, CatalogSelection, CatalogSelectionItem, CatalogCustomColumn } from '../../../../services/api/catalog';
import { cleanPhoneNumber } from '../../../../utils/phoneNumber';

const BRAND_COLOR = '#059669';

export default function CatalogSelectionDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const params = useLocalSearchParams<{ selectionId: string; data?: string; cols?: string }>();
  const selectionId = String(params.selectionId || '');

  // Custom column definitions (passed from the list) so each item's custom fields render with their
  // proper labels — matching the web selection view. Falls back to showing raw keys if unavailable.
  const customColumns = useMemo<CatalogCustomColumn[]>(() => {
    if (!params.cols) return [];
    try {
      const parsed = JSON.parse(String(params.cols));
      return Array.isArray(parsed) ? (parsed as CatalogCustomColumn[]) : [];
    } catch {
      return [];
    }
  }, [params.cols]);

  // The list already holds the full selection, so it's passed through as a JSON param to render
  // instantly. We keep a fetch-by-id fallback so a cold deep-link (no param) still resolves.
  const initial = useMemo<CatalogSelection | null>(() => {
    if (!params.data) return null;
    try {
      return JSON.parse(String(params.data)) as CatalogSelection;
    } catch {
      return null;
    }
  }, [params.data]);

  const [selection, setSelection] = useState<CatalogSelection | null>(initial);
  const [loading, setLoading] = useState(!initial);

  useEffect(() => {
    if (initial || !user?.organization || !selectionId) return;
    let alive = true;
    setLoading(true);
    catalogApi
      .getSelections(user.organization)
      .then((list) => {
        if (!alive) return;
        setSelection(list.find((s) => s.id === selectionId) || null);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [initial, user?.organization, selectionId]);

  const fmtDate = useCallback(
    (iso?: string) => {
      if (!iso) return '';
      try {
        return new Date(iso).toLocaleString(isRTL ? 'he-IL' : 'en-US');
      } catch {
        return iso;
      }
    },
    [isRTL]
  );

  const purposeLabel = useCallback(
    (p?: string) => {
      if (isRTL) return ({ order: 'הזמנה', lead: 'ליד', inquiry: 'התעניינות', browse: 'צפייה' } as Record<string, string>)[p || ''] || p || '—';
      return ({ order: 'Order', lead: 'Lead', inquiry: 'Inquiry', browse: 'Browse' } as Record<string, string>)[p || ''] || p || '—';
    },
    [isRTL]
  );

  const currencySym = selection?.currency === 'USD' ? '$' : selection?.currency === 'EUR' ? '€' : '₪';
  const fmtMoney = useCallback(
    (n?: number) => `${currencySym}${Number(n || 0).toLocaleString()}`,
    [currencySym]
  );

  const openLink = useCallback((url?: string) => {
    const u = (url || '').trim();
    if (!u) return;
    const full = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    Linking.openURL(full).catch(() => {});
  }, []);

  // Renders an item's custom fields the same way the web selection view does: using the column
  // label + a friendly boolean, skipping empty values.
  const renderItemCustomFields = useCallback((it: CatalogSelectionItem) => {
    const cf = it.customFields;
    if (!cf || customColumns.length === 0) return null;
    const rows = customColumns
      .map((col) => {
        const val = (cf as Record<string, any>)[col.key];
        if (val === undefined || val === null || val === '') return null;
        const display = col.type === 'boolean'
          ? ((val === true || /^(כן|yes|true|1)$/i.test(String(val))) ? (isRTL ? 'כן' : 'Yes') : (isRTL ? 'לא' : 'No'))
          : String(val);
        return { label: col.label, display };
      })
      .filter(Boolean) as { label: string; display: string }[];
    if (rows.length === 0) return null;
    return (
      <View style={{ marginTop: 4 }}>
        {rows.map((r, i) => (
          <Text key={i} variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
            {r.label}: {r.display}
          </Text>
        ))}
      </View>
    );
  }, [customColumns, isRTL, theme.colors.onSurfaceVariant, textAlign]);

  const cleanPhone = (p?: string) => (p || '').replace(/[^\d+]/g, '');

  const callContact = useCallback(() => {
    const p = cleanPhone(selection?.contactPhone);
    if (p) Linking.openURL(`tel:${p}`).catch(() => {});
  }, [selection?.contactPhone]);

  const whatsappContact = useCallback(() => {
    // Normalize to a full international number (e.g. a customer-entered "050…" → "972…").
    // Without this, wa.me gets a local-format number and shows "the link couldn't be opened".
    const p = cleanPhoneNumber(selection?.contactPhone || '');
    if (p) Linking.openURL(`https://wa.me/${p}`).catch(() => {});
  }, [selection?.contactPhone]);

  const emailContact = useCallback(() => {
    const e = (selection?.contactEmail || '').trim();
    if (e) Linking.openURL(`mailto:${e}`).catch(() => {});
  }, [selection?.contactEmail]);

  const computedTotal = useMemo(() => {
    if (selection?.total) return Number(selection.total);
    const its = Array.isArray(selection?.items) ? selection!.items! : [];
    return its.reduce((s, it) => s + (it.total ?? (it.unitPrice || 0) * (it.quantity || 1)), 0);
  }, [selection]);

  const items: CatalogSelectionItem[] = Array.isArray(selection?.items) ? selection!.items! : [];

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header style={{ backgroundColor: BRAND_COLOR }} statusBarHeight={insets.top}>
        <Appbar.BackAction onPress={() => router.back()} color="#fff" />
        <Appbar.Content
          title={isRTL ? 'בחירת לקוח' : 'Customer selection'}
          titleStyle={styles.headerTitle}
          color="#fff"
        />
      </Appbar.Header>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={BRAND_COLOR} />
        </View>
      ) : !selection ? (
        <View style={styles.center}>
          <MaterialCommunityIcons name="inbox-remove-outline" size={64} color={theme.colors.onSurfaceVariant} style={{ opacity: 0.35 }} />
          <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 12 }}>
            {isRTL ? 'הבחירה לא נמצאה' : 'Selection not found'}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Contact card */}
          <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
            <View style={[styles.rowBetween, { flexDirection }]}>
              <Text variant="titleMedium" style={{ color: theme.colors.onSurface, flex: 1, textAlign }}>
                {selection.contactName || (isRTL ? 'ללא שם' : 'No name')}
              </Text>
              <View style={[styles.purposeBadge, { backgroundColor: BRAND_COLOR + '18' }]}>
                <Text variant="labelSmall" style={{ color: BRAND_COLOR, fontWeight: '700' }}>
                  {purposeLabel(selection.purpose)}
                </Text>
              </View>
            </View>

            {selection.createdAt ? (
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4, textAlign }}>
                {fmtDate(selection.createdAt)}
              </Text>
            ) : null}

            {/* Contact actions */}
            {(selection.contactPhone || selection.contactEmail) ? (
              <View style={[styles.actionsRow, { flexDirection }]}>
                {selection.contactPhone ? (
                  <>
                    <Pressable style={[styles.actionBtn, { borderColor: BRAND_COLOR }]} onPress={callContact}>
                      <MaterialCommunityIcons name="phone" size={18} color={BRAND_COLOR} />
                      <Text style={[styles.actionTxt, { color: BRAND_COLOR }]}>{isRTL ? 'חיוג' : 'Call'}</Text>
                    </Pressable>
                    <Pressable style={[styles.actionBtn, { borderColor: '#25D366' }]} onPress={whatsappContact}>
                      <MaterialCommunityIcons name="whatsapp" size={18} color="#25D366" />
                      <Text style={[styles.actionTxt, { color: '#25D366' }]}>WhatsApp</Text>
                    </Pressable>
                  </>
                ) : null}
                {selection.contactEmail ? (
                  <Pressable style={[styles.actionBtn, { borderColor: theme.colors.onSurfaceVariant }]} onPress={emailContact}>
                    <MaterialCommunityIcons name="email-outline" size={18} color={theme.colors.onSurfaceVariant} />
                    <Text style={[styles.actionTxt, { color: theme.colors.onSurfaceVariant }]}>{isRTL ? 'מייל' : 'Email'}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {selection.contactPhone ? (
              <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 8, writingDirection: 'ltr', textAlign }}>
                {selection.contactPhone}
              </Text>
            ) : null}
            {selection.contactEmail ? (
              <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 2, writingDirection: 'ltr', textAlign }}>
                {selection.contactEmail}
              </Text>
            ) : null}
          </View>

          {/* Note */}
          {selection.note ? (
            <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
              <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, textAlign }}>
                {isRTL ? 'הערה' : 'Note'}
              </Text>
              <Text style={{ color: theme.colors.onSurface, textAlign, fontStyle: 'italic' }}>{selection.note}</Text>
            </View>
          ) : null}

          {/* Items */}
          <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
            <View style={[styles.rowBetween, { flexDirection }]}>
              <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant }}>
                {isRTL ? 'פריטים שנבחרו' : 'Selected items'}
              </Text>
              <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                {items.length}
              </Text>
            </View>

            {items.length === 0 ? (
              <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 10, textAlign }}>—</Text>
            ) : (
              items.map((it, idx) => {
                const img = it.images && it.images.length > 0 ? it.images[0] : '';
                const qty = it.quantity && it.quantity > 0 ? it.quantity : 1;
                const line = it.total ?? (it.unitPrice || 0) * qty;
                return (
                  <View key={it.id || idx}>
                    {idx > 0 ? <Divider style={{ marginVertical: 10 }} /> : <View style={{ height: 10 }} />}
                    <View style={[styles.itemRow, { flexDirection }]}>
                      {img ? (
                        <Image source={{ uri: img }} style={styles.itemImg} contentFit="cover" />
                      ) : (
                        <View style={[styles.itemImgPlaceholder, { backgroundColor: BRAND_COLOR + '15' }]}>
                          <MaterialCommunityIcons name="package-variant" size={24} color={BRAND_COLOR} />
                        </View>
                      )}
                      <View style={{ flex: 1, marginHorizontal: 12 }}>
                        <Text variant="titleSmall" style={{ color: theme.colors.onSurface, textAlign }} numberOfLines={2}>
                          {it.name || '—'}
                        </Text>
                        {it.sku ? (
                          <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign, marginTop: 2 }}>
                            {it.sku}
                          </Text>
                        ) : null}
                        {it.category ? (
                          <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign, marginTop: 2 }}>
                            {it.category}
                          </Text>
                        ) : null}
                        {it.description ? (
                          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign, marginTop: 2 }} numberOfLines={3}>
                            {it.description}
                          </Text>
                        ) : null}
                        {renderItemCustomFields(it)}
                        <View style={[styles.itemMeta, { flexDirection }]}>
                          {it.unitPrice ? (
                            <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                              {fmtMoney(it.unitPrice)}
                            </Text>
                          ) : null}
                          <View style={[styles.qtyBadge, { backgroundColor: theme.colors.onSurfaceVariant + '14' }]}>
                            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>×{qty}</Text>
                          </View>
                        </View>
                        {it.link ? (
                          <Pressable onPress={() => openLink(it.link)} style={{ marginTop: 6 }}>
                            <Text variant="labelSmall" style={{ color: BRAND_COLOR, textAlign }}>
                              {isRTL ? 'לפרטים נוספים ›' : 'More details ›'}
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                      <Text variant="titleSmall" style={{ color: BRAND_COLOR, fontWeight: '700' }}>
                        {fmtMoney(line)}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>

          {/* Total */}
          {computedTotal > 0 ? (
            <View style={[styles.card, styles.totalCard, { backgroundColor: theme.colors.surface, flexDirection }]}>
              <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>
                {isRTL ? 'סה״כ' : 'Total'}
              </Text>
              <Text variant="titleLarge" style={{ color: BRAND_COLOR, fontWeight: '800' }}>
                {fmtMoney(computedTotal)}
              </Text>
            </View>
          ) : null}

          <View style={{ height: 24 }} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  scroll: { padding: 12 },
  card: {
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  rowBetween: { alignItems: 'center', justifyContent: 'space-between' },
  purposeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  actionsRow: { gap: 8, marginTop: 12, flexWrap: 'wrap' },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  actionTxt: { fontSize: 13, fontWeight: '600' },
  itemRow: { alignItems: 'center' },
  itemImg: { width: 52, height: 52, borderRadius: 8 },
  itemImgPlaceholder: { width: 52, height: 52, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  itemMeta: { alignItems: 'center', gap: 8, marginTop: 4 },
  qtyBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  totalCard: { alignItems: 'center', justifyContent: 'space-between' },
});
