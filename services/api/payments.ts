import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';

export interface ClearingSettings {
  activeProvider: string | null;
  enabledEntities: {
    leads?: boolean;
    cases?: boolean;
    quotes?: boolean;
    calendar?: boolean;
    orders?: boolean;
    customTables?: boolean;
  };
  testMode?: boolean;
  defaultVatInclusive?: boolean;
}

export interface PaymentLinkResult {
  success: boolean;
  paymentUrl?: string;
  gambotPaymentUrl?: string;
  transactionId?: string;
  error?: string;
}

export interface ManualChargeResult {
  success: boolean;
  iframeUrl?: string;
  transactionId?: string;
  invoiceNumber?: string;
  error?: string;
}

export interface Transaction {
  id?: string;
  transactionId?: string;
  organization?: string;
  amount: number;
  description?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  status: 'paid' | 'pending' | 'failed';
  entityType?: string;
  entityId?: string;
  payments?: number;
  chargeMethod?: string;
  chargeType?: string;
  linkedRecordType?: string;
  linkedRecordId?: string;
  linkedRecordName?: string;
  invoiceNumber?: string;
  invoiceId?: string;
  paymentUrl?: string;
  gambotPaymentUrl?: string;
  tranzilaInvoiceUrl?: string;
  createdAt?: { _seconds: number } | string;
  paidAt?: { _seconds: number } | string;
  updatedAt?: { _seconds: number } | string;
  viewCount?: number;
  lastViewedAt?: string;
}

import { invalidateOpenDocs } from '../../utils/openDocs';

export const paymentsApi = {
  async getClearingSettings(organization: string): Promise<ClearingSettings | null> {
    try {
      const response = await axiosInstance.post(ENDPOINTS.GET_CLEARING_SETTINGS, { organization });
      const raw = response.data;
      if (raw?.success && raw.settings) {
        return {
          activeProvider: raw.settings.activeProvider || null,
          enabledEntities: raw.settings.enabledEntities || {},
          testMode: !!raw.settings.testMode,
          defaultVatInclusive: raw.settings.defaultVatInclusive !== false,
        };
      }
      return null;
    } catch {
      return null;
    }
  },

  async createPaymentLink(
    organization: string,
    params: {
      amount: number;
      description?: string;
      customerName?: string;
      customerPhone?: string;
      customerEmail?: string;
      entityType?: string;
      entityId?: string;
      payments?: number;
      /** Line items (name / unitPrice / quantity) — shown on the payment page and used for the invoice. */
      items?: Array<{ name: string; unitPrice: number; quantity: number; sku?: string; image?: string }>;
      /** The amount already includes VAT (default). When false the caller must have added the VAT to `amount`. */
      vatInclusive?: boolean;
      /** The record shown in the "linked record" column (contact / lead). Defaults to the lead when entityType is 'lead'. */
      linkedRecordType?: string;
      linkedRecordId?: string;
      linkedRecordName?: string;
    },
  ): Promise<PaymentLinkResult> {
    const response = await axiosInstance.post(ENDPOINTS.CREATE_PAYMENT_LINK, {
      organization,
      amount: params.amount,
      description: params.description || '',
      customerName: params.customerName || '',
      customerPhone: params.customerPhone || '',
      customerEmail: params.customerEmail || '',
      entityType: params.entityType || '',
      entityId: params.entityId || '',
      payments: params.payments || 1,
      linkedRecordType: params.linkedRecordType ?? (params.entityType === 'lead' ? 'lead' : ''),
      linkedRecordId: params.linkedRecordId ?? (params.entityType === 'lead' ? params.entityId : ''),
      linkedRecordName: params.linkedRecordName ?? (params.customerName || ''),
      items: params.items && params.items.length > 0 ? params.items : undefined,
      vatInclusive: params.vatInclusive,
    });
    invalidateOpenDocs(organization);
    return response.data;
  },

  async createManualCharge(
    organization: string,
    params: {
      amount: number;
      description?: string;
      customerName?: string;
      customerPhone?: string;
      customerEmail?: string;
      entityType?: string;
      entityId?: string;
      payments?: number;
      chargeMethod?: string;
    },
  ): Promise<ManualChargeResult> {
    const response = await axiosInstance.post(ENDPOINTS.CREATE_MANUAL_CHARGE, {
      organization,
      amount: params.amount,
      description: params.description || '',
      customerName: params.customerName || '',
      customerPhone: params.customerPhone || '',
      customerEmail: params.customerEmail || '',
      entityType: params.entityType || '',
      entityId: params.entityId || '',
      payments: params.payments || 1,
      chargeMethod: params.chargeMethod || 'credit_card',
    });
    return response.data;
  },

  async getTransactions(organization: string): Promise<Transaction[]> {
    try {
      const response = await axiosInstance.post(ENDPOINTS.GET_PAYMENT_TRANSACTIONS, { organization });
      const raw = response.data;
      const data = raw?.transactions || raw?.Data || [];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },
};
