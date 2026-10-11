import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useRowDirection } from '../../hooks/useRowDirection';
import { ChipRow, fmtNum, fmtPct, SectionCard, Skeleton, StatTile } from '../dashboard/ui';
import { ExpandableBars } from '../dashboard/records';
import {
  fetchAllTemplates,
  fetchButtonClickStats,
  fetchTemplateClickStats,
  fetchTemplateSendStats,
} from '../../services/api/dashboard';

interface Props {
  org: string;
  /** yyyy-MM-dd or null = all time */
  from: string | null;
  to: string | null;
  refreshKey: number;
}

type Tab = 'sends' | 'buttons' | 'links';

/** WhatsApp templates: sends, quick-reply button presses and tracked link clicks (web WhatsAppClickReport). */
export default function TemplatesPanel({ org, from, to, refreshKey }: Props) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const dir = useRowDirection();
  const [tab, setTab] = useState<Tab>('sends');
  const [templates, setTemplates] = useState<any[]>([]);
  const [sends, setSends] = useState<any>(undefined);
  const [buttons, setButtons] = useState<any>(undefined);
  const [links, setLinks] = useState<any>(undefined);

  // Everything is reloaded when the period / refresh changes; only the active tab fetches.
  useEffect(() => {
    setSends(undefined);
    setButtons(undefined);
    setLinks(undefined);
  }, [org, from, to, refreshKey]);

  useEffect(() => {
    let alive = true;
    if (templates.length === 0) fetchAllTemplates(org).then((r) => alive && setTemplates(r)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [org, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true;
    if (tab === 'sends' && sends === undefined) fetchTemplateSendStats(org, from, to).then((d) => alive && setSends(d || {})).catch(() => alive && setSends({}));
    if (tab === 'buttons' && buttons === undefined)
      fetchButtonClickStats(org, from, to).then((d) => alive && setButtons(d || {})).catch(() => alive && setButtons({ buttons: [] }));
    if (tab === 'links' && links === undefined)
      fetchAllTemplates(org)
        .then((all) => fetchTemplateClickStats(org, all, from, to))
        .then((d) => alive && setLinks(d || {}))
        .catch(() => alive && setLinks({ templates: [] }));
    return () => {
      alive = false;
    };
  }, [tab, sends, buttons, links, org, from, to]);

  const friendly = useMemo(() => {
    const map: Record<string, string> = {};
    templates.forEach((tm) => {
      const id = tm.id ?? tm.Id ?? tm.templateId ?? tm.TemplateId;
      const name = tm.name ?? tm.Name ?? tm.templateName ?? tm.TemplateName;
      const fr = tm.friendlyName ?? tm.FriendlyName;
      const label = fr || name;
      if (id && label) map[String(id)] = label;
      if (name && label) map[String(name)] = label;
    });
    return map;
  }, [templates]);
  const labelOf = (id: any, name?: any) => friendly[String(id)] || friendly[String(name)] || name || id || '-';

  const tabs = [
    { key: 'sends' as const, label: t('reports.tpl.sends', 'שליחות'), icon: 'send-outline' },
    { key: 'buttons' as const, label: t('reports.tpl.buttons', 'כפתורים'), icon: 'gesture-tap-button' },
    { key: 'links' as const, label: t('reports.tpl.links', 'קליקים בקישורים'), icon: 'link-variant' },
  ];

  const loading = (tab === 'sends' && sends === undefined) || (tab === 'buttons' && buttons === undefined) || (tab === 'links' && links === undefined);

  const body = () => {
    if (tab === 'sends') {
      const list: any[] = sends?.templates || [];
      const totalClicks = list.reduce((a, x) => a + Object.values(x.buttonClickCounts || {}).reduce((s: number, n: any) => s + Number(n || 0), 0), 0);
      return (
        <>
          <View style={[styles.tiles, { flexDirection: dir }]}>
            <StatTile label={t('reports.tpl.totalSends', 'סה״כ שליחות')} value={sends?.totalSends || 0} width="31.5%" />
            <StatTile label={t('reports.tpl.templatesUsed', 'תבניות בשימוש')} value={list.length} width="31.5%" />
            <StatTile label={t('reports.tpl.buttonPresses', 'לחיצות כפתור')} value={totalClicks} color="#16a34a" width="31.5%" />
          </View>
          <SectionCard title={t('reports.tpl.byTemplate', 'לפי תבנית')} icon="file-document-check-outline" color="#059669">
            <ExpandableBars
              color="#059669"
              empty={t('reports.noData', 'אין נתונים')}
              items={list
                .slice()
                .sort((a, b) => (b.sendCount || 0) - (a.sendCount || 0))
                .map((x) => {
                  const clicks = Object.values(x.buttonClickCounts || {}).reduce((s: number, n: any) => s + Number(n || 0), 0);
                  const ctr = x.sendCount > 0 ? Math.round((clicks / x.sendCount) * 100) : 0;
                  return {
                    label: `${labelOf(x.templateId, x.templateName)}${clicks > 0 ? ` · ${fmtPct(ctr)}` : ''}`,
                    count: x.sendCount || 0,
                  };
                })}
            />
          </SectionCard>
        </>
      );
    }
    if (tab === 'buttons') {
      const rows: any[] = buttons?.buttons || [];
      const agg: Record<string, { label: string; count: number; contacts: Set<string> }> = {};
      rows.forEach((b) => {
        const k = b.buttonText || '—';
        if (!agg[k]) agg[k] = { label: k, count: 0, contacts: new Set() };
        agg[k].count += b.count || 0;
        (b.contacts || []).forEach((p: string) => p && agg[k].contacts.add(p));
      });
      const list = Object.values(agg).sort((a, b) => b.count - a.count);
      return (
        <>
          <View style={[styles.tiles, { flexDirection: dir }]}>
            <StatTile label={t('reports.tpl.buttonPresses', 'לחיצות כפתור')} value={list.reduce((a, x) => a + x.count, 0)} width="48%" />
            <StatTile label={t('reports.tpl.uniqueContacts', 'אנשי קשר ייחודיים')} value={new Set(list.flatMap((x) => [...x.contacts])).size} width="48%" />
          </View>
          <SectionCard title={t('reports.tpl.byButton', 'לפי כפתור')} icon="gesture-tap-button" color="#7c3aed">
            <ExpandableBars color="#7c3aed" empty={t('reports.noData', 'אין נתונים')} items={list.map((x) => ({ label: `${x.label} · ${fmtNum(x.contacts.size)} ${t('reports.bot.contacts', 'אנשי קשר')}`, count: x.count }))} />
          </SectionCard>
        </>
      );
    }
    const list: any[] = links?.templates || [];
    return (
      <>
        <View style={[styles.tiles, { flexDirection: dir }]}>
          <StatTile label={t('reports.tpl.totalClicks', 'סה״כ קליקים')} value={links?.orgTotalClicks ?? list.reduce((a, x) => a + (x.totalClicks || 0), 0)} width="48%" />
          <StatTile label={t('reports.tpl.templatesUsed', 'תבניות')} value={list.length} width="48%" />
        </View>
        <SectionCard title={t('reports.tpl.byTemplate', 'לפי תבנית')} icon="link-variant" color="#2563eb">
          <ExpandableBars
            color="#2563eb"
            empty={t('reports.noData', 'אין נתונים')}
            items={list
              .slice()
              .sort((a, b) => (b.totalClicks || 0) - (a.totalClicks || 0))
              .map((x) => ({ label: labelOf(x.templateId, x.templateName), count: x.totalClicks || 0 }))}
          />
        </SectionCard>
      </>
    );
  };

  return (
    <View>
      <ChipRow options={tabs} value={tab} onChange={setTab} />
      {loading ? (
        <View style={{ gap: 12, paddingHorizontal: 12 }}>
          <Skeleton height={80} />
          <Skeleton height={160} />
        </View>
      ) : (
        body()
      )}
      {!loading && from === null ? (
        <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 4 }}>{t('reports.allTimeNote', 'מוצגים נתוני כל הזמן')}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, marginBottom: 12 },
});
