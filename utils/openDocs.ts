import { useEffect, useState } from 'react';
import axiosInstance from '../services/api/axiosInstance';

// Open (unfinished) quotes + pending payment links of the organization — mirrors the web `utils/openDocs.js`.
// One request per ~45s feeds every indicator on screen.
export interface OpenQuote {
  id: string; quoteNumber?: string; title?: string; total: number; currency?: string;
  status: string; leadId?: string; phone?: string;
}
export interface OpenPayment {
  id: string; amount: number; description?: string; leadId?: string; phone?: string;
  entityType?: string; entityId?: string;
}
interface Index { byLead: Record<string, { quotes: OpenQuote[]; payments: OpenPayment[] }>; byPhone: Record<string, { quotes: OpenQuote[]; payments: OpenPayment[] }>; loaded: boolean }

const TTL_MS = 45 * 1000;
const EMPTY: Index = { byLead: {}, byPhone: {}, loaded: false };
const cache: Record<string, { at: number; data: Index; promise: Promise<Index> | null }> = {};
const listeners = new Set<(org: string) => void>();

export const phoneKey = (p?: string) => {
  const d = String(p || '').replace(/\D/g, '');
  return d.length > 9 ? d.slice(-9) : d;
};

const buildIndex = (quotes: OpenQuote[], payments: OpenPayment[]): Index => {
  const byLead: Index['byLead'] = {};
  const byPhone: Index['byPhone'] = {};
  const slot = (map: Index['byLead'], key?: string) => {
    if (!key) return null;
    if (!map[key]) map[key] = { quotes: [], payments: [] };
    return map[key];
  };
  const add = (kind: 'quotes' | 'payments', item: any) => {
    const l = slot(byLead, item.leadId);
    if (l) (l[kind] as any[]).push(item);
    const p = slot(byPhone, phoneKey(item.phone));
    if (p) (p[kind] as any[]).push(item);
  };
  const quoteLead: Record<string, string> = {};
  (quotes || []).forEach((q) => { quoteLead[q.id] = q.leadId || ''; add('quotes', q); });
  // A payment link created from a quote belongs to that quote's lead.
  (payments || []).forEach((x) => add('payments', x.leadId || x.entityType !== 'quote' ? x : { ...x, leadId: quoteLead[x.entityId || ''] || '' }));
  return { byLead, byPhone, loaded: true };
};

export const refreshOpenDocs = async (organization: string, force = false): Promise<Index> => {
  if (!organization) return EMPTY;
  const c = cache[organization] || (cache[organization] = { at: 0, data: EMPTY, promise: null });
  const fresh = Date.now() - c.at < TTL_MS;
  if (!force && fresh && c.data.loaded) return c.data;
  if (c.promise) return c.promise;
  c.promise = axiosInstance
    .post('/api/Webhooks/GetOpenDocsSummary', { organization })
    .then((res) => {
      c.data = buildIndex(res.data?.quotes, res.data?.payments);
      c.at = Date.now();
      return c.data;
    })
    .catch(() => c.data)
    .finally(() => {
      c.promise = null;
      listeners.forEach((fn) => fn(organization));
    });
  return c.promise;
};

/** Call after a quote/payment changes so indicators update right away. */
export const invalidateOpenDocs = (organization?: string) => {
  if (organization && cache[organization]) cache[organization].at = 0;
  if (organization) refreshOpenDocs(organization, true);
};

export const useOpenDocs = (organization?: string): Index => {
  const [, force] = useState(0);
  useEffect(() => {
    if (!organization) return undefined;
    const onChange = (org: string) => { if (org === organization) force((n) => n + 1); };
    listeners.add(onChange);
    refreshOpenDocs(organization, true);
    return () => { listeners.delete(onChange); };
  }, [organization]);
  return (organization && cache[organization]?.data) || EMPTY;
};

export const getOpenDocs = (summary: Index, { leadId, phone }: { leadId?: string; phone?: string } = {}) => {
  const empty = { quotes: [] as OpenQuote[], payments: [] as OpenPayment[] };
  if (!summary?.loaded) return empty;
  // Lead view: what is linked to the lead. Chat view (phone only): everything of that contact.
  if (leadId) return summary.byLead[leadId] || empty;
  return (phone && summary.byPhone[phoneKey(phone)]) || empty;
};
