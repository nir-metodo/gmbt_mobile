import React, { memo, useEffect, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, Button, IconButton, Menu } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { useRTL } from '../../../hooks/useRTL';
import { borderRadius } from '../../../constants/theme';
import { withAlpha } from '../../../utils/formatters';
import type { WaCampaign } from '../../../services/api/campaigns';
import { DerivedStatus, CampaignStatusKey, RunSummary, formatWhen } from './campaignUtils';

interface Props {
  campaign: WaCampaign;
  status: DerivedStatus;
  /** undefined = not loaded yet, null = failed to load. */
  summary: RunSummary | null | undefined;
  templateName: string;
  he: boolean;
  onVisible: (id: string) => void;
  onOpen: (c: WaCampaign) => void;
  onRun: (c: WaCampaign) => void;
  onDuplicate: (c: WaCampaign) => void;
  onDelete: (c: WaCampaign) => void;
  onCancelSchedule: (c: WaCampaign) => void;
}

export const STATUS_STYLE: Record<CampaignStatusKey, { color: string; icon: string; he: string; en: string }> = {
  scheduled: { color: '#2563eb', icon: 'calendar-clock', he: 'מתוזמן', en: 'Scheduled' },
  completed: { color: '#16a34a', icon: 'check-all', he: 'הושלם', en: 'Completed' },
  sent: { color: '#2e6155', icon: 'send-check', he: 'נשלח', en: 'Sent' },
  draft: { color: '#d97706', icon: 'pencil-outline', he: 'טיוטה', en: 'Draft' },
  cancelled: { color: '#6b7280', icon: 'calendar-remove', he: 'התזמון בוטל', en: 'Schedule cancelled' },
  broken: { color: '#dc2626', icon: 'calendar-alert', he: 'תזמון חסר', en: 'Schedule missing' },
  system: { color: '#0e7490', icon: 'cog-outline', he: 'מערכת', en: 'System' },
};

function Pill({ color, icon, label }: { color: string; icon: string; label: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: withAlpha(color, 0.12) }]}>
      <MaterialCommunityIcons name={icon as any} size={13} color={color} />
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

function CampaignCardBase({
  campaign,
  status,
  summary,
  templateName,
  he,
  onVisible,
  onOpen,
  onRun,
  onDuplicate,
  onDelete,
  onCancelSchedule,
}: Props) {
  const theme = useAppTheme();
  const { flexDirection, textAlign } = useRTL();
  const [menuOpen, setMenuOpen] = useState(false);
  const st = STATUS_STYLE[status.key];
  const isSystem = !!campaign.isSystem;

  useEffect(() => {
    if (!isSystem) onVisible(campaign.campaingId);
  }, [campaign.campaingId, isSystem, onVisible]);

  const canCancel = status.key === 'scheduled';
  const modified = formatWhen(campaign.modifiedOn || campaign.createdOn, he);

  return (
    <Pressable
      onPress={() => onOpen(campaign)}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.custom?.divider || theme.colors.outline,
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
      {/* Title + overflow menu */}
      <View style={[styles.row, { flexDirection }]}>
        <Text style={[styles.title, { color: theme.colors.onSurface, textAlign }]} numberOfLines={2}>
          {campaign.campaignName || (he ? 'ללא שם' : 'Untitled')}
        </Text>
        {!isSystem && (
          <Menu
            visible={menuOpen}
            onDismiss={() => setMenuOpen(false)}
            anchor={<IconButton icon="dots-vertical" size={20} onPress={() => setMenuOpen(true)} style={styles.kebab} />}
          >
            <Menu.Item
              leadingIcon="content-copy"
              title={he ? 'שכפל' : 'Duplicate'}
              onPress={() => {
                setMenuOpen(false);
                onDuplicate(campaign);
              }}
            />
            {canCancel && (
              <Menu.Item
                leadingIcon="calendar-remove"
                title={he ? 'בטל תזמון' : 'Cancel schedule'}
                onPress={() => {
                  setMenuOpen(false);
                  onCancelSchedule(campaign);
                }}
              />
            )}
            <Menu.Item
              leadingIcon="trash-can-outline"
              title={he ? 'מחק' : 'Delete'}
              titleStyle={{ color: theme.colors.error }}
              onPress={() => {
                setMenuOpen(false);
                onDelete(campaign);
              }}
            />
          </Menu>
        )}
      </View>

      {/* Status badge(s) */}
      <View style={[styles.badges, { flexDirection }]}>
        <Pill color={st.color} icon={st.icon} label={he ? st.he : st.en} />
        {status.key === 'scheduled' && status.nextRun ? (
          <Text style={[styles.meta, { color: theme.colors.onSurfaceVariant }]}>
            {(he ? 'הבא: ' : 'Next: ') + formatWhen(status.nextRun, he)}
          </Text>
        ) : null}
        {(status.key === 'scheduled' || status.key === 'completed') && status.totalRuns ? (
          <Text style={[styles.meta, { color: theme.colors.onSurfaceVariant }]}>
            {`${status.runsDone ?? 0}/${status.totalRuns}`}
          </Text>
        ) : null}
      </View>

      {/* Template */}
      {templateName ? (
        <View style={[styles.row, { flexDirection, gap: 6 }]}>
          <MaterialCommunityIcons name="message-text-outline" size={15} color={theme.colors.onSurfaceVariant} />
          <Text style={[styles.meta, { color: theme.colors.onSurfaceVariant, flex: 1, textAlign }]} numberOfLines={1}>
            {templateName}
          </Text>
        </View>
      ) : null}

      {/* Last run summary */}
      {!isSystem && (
        <View style={styles.lastRun}>
          {summary === undefined ? (
            <Text style={[styles.meta, { color: theme.colors.onSurfaceVariant, textAlign }]}>…</Text>
          ) : summary === null ? null : summary.runs === 0 ? (
            <Text style={[styles.meta, { color: theme.colors.onSurfaceVariant, textAlign }]}>
              {he ? 'עדיין לא הורץ' : 'Not run yet'}
            </Text>
          ) : (
            <>
              <Text style={[styles.meta, { color: theme.colors.onSurfaceVariant, textAlign }]}>
                {(he ? 'ריצה אחרונה: ' : 'Last run: ') + formatWhen(summary.lastRunAt, he)}
                {summary.inProcess ? (he ? ' · בתהליך' : ' · in progress') : ''}
                {summary.runs > 1 ? (he ? ` · ${summary.runs} ריצות` : ` · ${summary.runs} runs`) : ''}
              </Text>
              <View style={[styles.counters, { flexDirection }]}>
                <Pill color="#64748b" icon="send" label={String(summary.sent)} />
                <Pill color="#16a34a" icon="check-all" label={String(summary.delivered)} />
                <Pill color="#2563eb" icon="eye-outline" label={String(summary.read)} />
                {summary.failed > 0 ? <Pill color="#dc2626" icon="alert-circle-outline" label={String(summary.failed)} /> : null}
              </View>
            </>
          )}
        </View>
      )}

      {/* Footer: primary Run + subtle modified line */}
      <View style={[styles.footer, { flexDirection }]}>
        <Text style={[styles.modified, { color: theme.colors.onSurfaceVariant, textAlign, flex: 1 }]} numberOfLines={1}>
          {modified ? (he ? 'עודכן ' : 'Updated ') + modified : ''}
        </Text>
        {!isSystem && (
          <Button mode="contained" icon="play" compact onPress={() => onRun(campaign)} buttonColor={theme.colors.primary}>
            {he ? 'הרץ' : 'Run'}
          </Button>
        )}
      </View>
    </Pressable>
  );
}

export default memo(CampaignCardBase);

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    padding: 14,
    marginHorizontal: 12,
    marginVertical: 6,
    gap: 8,
  },
  row: { alignItems: 'center' },
  title: { flex: 1, fontSize: 16, fontWeight: '700' },
  kebab: { margin: -6 },
  badges: { alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 12, fontWeight: '700' },
  meta: { fontSize: 12 },
  lastRun: { gap: 6 },
  counters: { gap: 6, flexWrap: 'wrap' },
  footer: { alignItems: 'center', gap: 8, marginTop: 2 },
  modified: { fontSize: 11 },
});
