import { quotesApi } from '../services/api/quotes';
import type { Quote } from '../types';

/**
 * Quote Settings → "הפקת חשבונית משלב" (same setting the web uses: kanbanStages[].autoInvoice).
 * When a quote is moved to a stage that has it enabled, the app opens a pre-filled invoice draft
 * (nothing is issued automatically — the user reviews / edits / issues it).
 */

type StageConfig = { id: string; autoInvoice?: { enabled?: boolean; docType?: string } };

let cache: { org: string; at: number; stages: StageConfig[] } | null = null;
const CACHE_MS = 2 * 60 * 1000;

async function getStages(org: string): Promise<StageConfig[]> {
  if (cache && cache.org === org && Date.now() - cache.at < CACHE_MS) return cache.stages;
  const branding = await quotesApi.getBranding(org);
  const stages: StageConfig[] = Array.isArray(branding?.kanbanStages) ? branding.kanbanStages : [];
  cache = { org, at: Date.now(), stages };
  return stages;
}

export interface InvoiceFromQuoteParams {
  id: 'new';
  prefillContactName: string;
  prefillContactPhone: string;
  prefillRelatedQuoteId: string;
  prefillType: string;
}

/** Route params for the new-invoice screen, or null when the stage has no "invoice from stage" setting. */
export async function getInvoiceParamsForStage(
  org: string | undefined,
  quote: Pick<Quote, 'id' | 'status' | 'contactName' | 'contactPhone' | 'phoneNumber' | 'invoiceGeneratedId'>,
  newStatus: string,
): Promise<InvoiceFromQuoteParams | null> {
  if (!org || !quote?.id || quote.status === newStatus || quote.invoiceGeneratedId) return null;
  try {
    // Same default as the web (getStageAutoInvoice): an explicit stage setting always wins; when none was ever
    // saved the "paid" stage defaults to ON with a tax invoice + receipt.
    const stage = (await getStages(org)).find((s) => s.id === newStatus);
    const cfg = stage?.autoInvoice ?? (newStatus === 'paid' ? { enabled: true, docType: 'combined' } : undefined);
    if (!cfg?.enabled) return null;
    return {
      id: 'new',
      prefillContactName: quote.contactName || '',
      prefillContactPhone: quote.contactPhone || quote.phoneNumber || '',
      prefillRelatedQuoteId: quote.id,
      prefillType: cfg.docType || 'combined',
    };
  } catch {
    return null; // settings are optional — never block a status change
  }
}
