import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRowDirection } from '../../hooks/useRowDirection';
import { ChipRow, fmtMoney, fmtPct, SectionCard, Skeleton, StatTile } from '../dashboard/ui';
import { ExpandableBars } from '../dashboard/records';
import { fetchStoreReportData } from '../../services/api/dashboard';

interface Props {
  org: string;
  from: string | null;
  to: string | null;
  refreshKey: number;
}

type Tab = 'orders' | 'stock' | 'pos';

const num = (v: any) => parseFloat(v || 0) || 0;
const parseTs = (s: any): Date | null => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

/** Store: orders & revenue, inventory health, purchase orders (web StoreReport). */
export default function StorePanel({ org, from, to, refreshKey }: Props) {
  const { t } = useTranslation();
  const dir = useRowDirection();
  const [tab, setTab] = useState<Tab>('orders');
  const [data, setData] = useState<{ orders: any[]; inventory: any[]; purchaseOrders: any[] } | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    setData(undefined);
    fetchStoreReportData(org, from, to)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData({ orders: [], inventory: [], purchaseOrders: [] }));
    return () => {
      alive = false;
    };
  }, [org, from, to, refreshKey]);

  const computed = useMemo(() => {
    if (!data) return null;
    // The server filters by date, but the web re-applies the range client-side - same here.
    const start = from ? new Date(`${from}T00:00:00`) : null;
    const end = to ? new Date(`${to}T23:59:59`) : null;
    const orders = data.orders.filter((o) => {
      const ts = parseTs(o.createdOn || o.createdAt);
      if (!ts) return true;
      if (start && ts < start) return false;
      if (end && ts > end) return false;
      return true;
    });
    const byStatus: Record<string, { count: number; revenue: number }> = {};
    orders.forEach((o) => {
      const s = o.status || 'unknown';
      if (!byStatus[s]) byStatus[s] = { count: 0, revenue: 0 };
      byStatus[s].count++;
      byStatus[s].revenue += num(o.total || o.totalAmount);
    });
    const revenue = orders.reduce((a, o) => a + num(o.total || o.totalAmount), 0);
    const products: Record<string, { qty: number; revenue: number }> = {};
    orders.forEach((o) =>
      (o.items || o.products || []).forEach((it: any) => {
        const name = it.name || it.productName || '—';
        const qty = parseInt(it.quantity || it.qty || 1, 10) || 1;
        if (!products[name]) products[name] = { qty: 0, revenue: 0 };
        products[name].qty += qty;
        products[name].revenue += num(it.price || it.unitPrice) * qty;
      }),
    );
    const top = Object.entries(products).sort((a, b) => b[1].qty - a[1].qty).slice(0, 8);

    const tracked = data.inventory.filter((i) => i.trackStock);
    const out = tracked.filter((i) => (parseInt(i.quantity, 10) || 0) === 0);
    const low = tracked.filter((i) => {
      const q = parseInt(i.quantity, 10) || 0;
      return q > 0 && q <= (parseInt(i.lowStockThreshold, 10) || 5);
    });
    const reorder = [...out, ...low].sort((a, b) => (parseInt(a.quantity, 10) || 0) - (parseInt(b.quantity, 10) || 0));
    const health = tracked.length > 0 ? Math.round(((tracked.length - out.length - low.length) / tracked.length) * 100) : 100;

    const pos = data.purchaseOrders;
    const pending = pos.filter((p) => ['draft', 'sent', 'partial'].includes(p.status));
    const received = pos.filter((p) => p.status === 'received');
    return {
      orders,
      byStatus,
      revenue,
      top,
      tracked,
      out,
      low,
      reorder,
      health,
      pos,
      pending,
      received,
      poValue: pos.reduce((a, p) => a + num(p.total), 0),
      pendingValue: pending.reduce((a, p) => a + num(p.total), 0),
    };
  }, [data, from, to]);

  const tabs = [
    { key: 'orders' as const, label: t('reports.store.orders', 'הזמנות'), icon: 'package-variant-closed' },
    { key: 'stock' as const, label: t('reports.store.stock', 'מלאי'), icon: 'warehouse' },
    { key: 'pos' as const, label: `${t('reports.store.pos', 'רכש')}${computed && computed.pending.length ? ` ${computed.pending.length}` : ''}`, icon: 'truck-delivery-outline' },
  ];

  if (!computed) {
    return (
      <View style={{ gap: 12, paddingHorizontal: 12 }}>
        <Skeleton height={90} />
        <Skeleton height={160} />
      </View>
    );
  }

  const statusLabel = (s: string) => t(`reports.store.status.${s}`, s);

  return (
    <View>
      <ChipRow options={tabs} value={tab} onChange={setTab} />
      {tab === 'orders' ? (
        <>
          <View style={[styles.tiles, { flexDirection: dir }]}>
            <StatTile label={t('reports.store.ordersCount', 'הזמנות')} value={computed.orders.length} width="31.5%" />
            <StatTile label={t('reports.store.revenue', 'הכנסות')} value={fmtMoney(computed.revenue)} color="#16a34a" width="31.5%" />
            <StatTile
              label={t('reports.store.avgOrder', 'ממוצע להזמנה')}
              value={fmtMoney(computed.orders.length ? computed.revenue / computed.orders.length : 0)}
              width="31.5%"
            />
            <StatTile
              label={t('reports.store.delivered', 'סופקו')}
              value={fmtPct(computed.orders.length ? ((computed.byStatus.delivered?.count || 0) / computed.orders.length) * 100 : 0)}
              color="#16a34a"
              width="31.5%"
            />
            <StatTile
              label={t('reports.store.cancelled', 'בוטלו')}
              value={fmtPct(computed.orders.length ? ((computed.byStatus.cancelled?.count || 0) / computed.orders.length) * 100 : 0)}
              color={(computed.byStatus.cancelled?.count || 0) > 0 ? '#dc2626' : undefined}
              width="31.5%"
            />
          </View>
          <SectionCard title={t('reports.store.byStatus', 'לפי סטטוס')} icon="package-variant-closed" color="#db2777">
            <ExpandableBars
              color="#db2777"
              empty={t('reports.noData', 'אין נתונים')}
              items={Object.entries(computed.byStatus).map(([s, v]) => ({ label: `${statusLabel(s)} · ${fmtMoney(v.revenue)}`, count: v.count }))}
            />
          </SectionCard>
          <SectionCard title={t('reports.store.topProducts', 'מוצרים מובילים')} icon="star-outline" color="#d97706">
            <ExpandableBars
              color="#d97706"
              empty={t('reports.noData', 'אין נתונים')}
              items={computed.top.map(([name, v]) => ({ label: `${name} · ${fmtMoney(v.revenue)}`, count: v.qty }))}
            />
          </SectionCard>
        </>
      ) : null}
      {tab === 'stock' ? (
        <>
          <View style={[styles.tiles, { flexDirection: dir }]}>
            <StatTile label={t('reports.store.stockHealth', 'בריאות מלאי')} value={fmtPct(computed.health)} color={computed.health >= 80 ? '#16a34a' : '#d97706'} width="31.5%" />
            <StatTile label={t('reports.store.low', 'מלאי נמוך')} value={computed.low.length} color={computed.low.length ? '#d97706' : undefined} width="31.5%" />
            <StatTile label={t('reports.store.out', 'אזל')} value={computed.out.length} color={computed.out.length ? '#dc2626' : undefined} width="31.5%" />
          </View>
          <SectionCard title={t('reports.store.reorder', 'להזמנה מחדש')} icon="alert-outline" color="#dc2626">
            <ExpandableBars
              color="#dc2626"
              empty={t('reports.store.stockOk', 'המלאי תקין')}
              items={computed.reorder.map((i) => ({ label: `${i.productName || i.name || i.sku}${i.sku ? ` · ${i.sku}` : ''}`, count: parseInt(i.quantity, 10) || 0 }))}
            />
          </SectionCard>
        </>
      ) : null}
      {tab === 'pos' ? (
        <>
          <View style={[styles.tiles, { flexDirection: dir }]}>
            <StatTile label={t('reports.store.poTotal', 'הזמנות רכש')} value={computed.pos.length} width="31.5%" />
            <StatTile label={t('reports.store.poPending', 'בהמתנה')} value={computed.pending.length} color="#d97706" width="31.5%" />
            <StatTile label={t('reports.store.poReceived', 'התקבלו')} value={computed.received.length} color="#16a34a" width="31.5%" />
            <StatTile label={t('reports.store.poValue', 'שווי כולל')} value={fmtMoney(computed.poValue)} width="48%" />
            <StatTile label={t('reports.store.poPendingValue', 'שווי בהמתנה')} value={fmtMoney(computed.pendingValue)} width="48%" />
          </View>
          <SectionCard title={t('reports.store.pendingPos', 'ממתינות לקבלה')} icon="truck-delivery-outline" color="#d97706">
            <ExpandableBars
              color="#d97706"
              empty={t('reports.noData', 'אין נתונים')}
              items={computed.pending.map((p) => ({ label: `${p.supplierName || '—'}${p.poNumber ? ` · #${p.poNumber}` : ''} · ${fmtMoney(num(p.total))}`, count: (p.items || []).length }))}
            />
          </SectionCard>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, marginBottom: 12 },
});
