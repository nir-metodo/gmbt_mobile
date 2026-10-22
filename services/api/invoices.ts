import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total?: number;
}

export interface Invoice {
  id?: string;
  type: string;
  status: string;
  documentNumber?: string;
  date?: string;
  dueDate?: string;
  currency?: string;
  vatRate?: number;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  contactCompany?: string;
  contactTaxId?: string;
  items: InvoiceItem[];
  subtotal?: number;
  vatAmount?: number;
  total?: number;
  discount?: number;
  notes?: string;
  paymentMethod?: string;
  isLocked?: boolean;
  relatedQuoteId?: string;
  createdAt?: string;
  updatedAt?: string;
  viewCount?: number;
  lastViewedAt?: string;
  contactId?: string;
  /** Unpaid balance of an issued tax invoice (backend-computed). */
  balanceDue?: number;
  paidAmount?: number;
  creditedAmount?: number;
  allocationNumber?: string;
}

export interface OpenInvoicesSummary {
  count: number;
  total: number;
  overdueCount: number;
  overdueTotal: number;
  dueSoonCount: number;
}

export type InvoiceSortKey = 'date' | 'created' | 'dueDate' | 'amount' | 'balance' | 'customer' | 'number' | 'createdBy';

export interface InvoiceCreator {
  id: string;
  name: string;
  count: number;
}

export const DOCUMENT_TYPES = [
  { key: 'tax_invoice',    labelHe: 'חשבונית מס',           color: '#2e6155' },
  { key: 'combined',       labelHe: 'חשבונית מס קבלה',      color: '#2e6155' },
  { key: 'receipt',        labelHe: 'קבלה',                  color: '#2563eb' },
  { key: 'transaction',    labelHe: 'חשבון עסקה',            color: '#d97706' },
  { key: 'credit_invoice', labelHe: 'חשבונית זיכוי',        color: '#dc2626' },
  { key: 'credit_receipt', labelHe: 'קבלת זיכוי',           color: '#f59e0b' },
] as const;

export const INVOICE_STATUSES = [
  { key: 'draft',     labelHe: 'טיוטה',    color: '#9ca3af' },
  { key: 'issued',    labelHe: 'הופק',     color: '#2563eb' },
  { key: 'sent',      labelHe: 'נשלח',     color: '#7c3aed' },
  { key: 'paid',      labelHe: 'שולם',     color: '#16a34a' },
  { key: 'overdue',   labelHe: 'באיחור',   color: '#dc2626' },
  { key: 'cancelled', labelHe: 'בוטל',     color: '#d97706' },
] as const;

export const invoicesApi = {
  async getPaginated(
    organization: string,
    params?: {
      page?: number;
      pageSize?: number;
      searchTerm?: string;
      statusFilter?: string;
      typeFilter?: string;
      /** Document date range, 'yyyy-MM-dd' (inclusive). */
      fromDate?: string;
      toDate?: string;
      minAmount?: number;
      maxAmount?: number;
      /** Only documents created by this user id. */
      createdByFilter?: string;
      sortBy?: InvoiceSortKey;
      sortDir?: 'asc' | 'desc';
      /** Also return the distinct creators (for the "created by" picker). */
      includeCreators?: boolean;
      /** 'own' limits the list to the user's own documents (server-enforced, same as the web). */
      dataVisibility?: string;
      userId?: string;
    }
  ): Promise<{ invoices: Invoice[]; totalCount: number; creators: InvoiceCreator[] }> {
    const response = await axiosInstance.post(ENDPOINTS.GET_INVOICES_PAGINATED, {
      organization,
      pageNumber: params?.page ?? 1,
      pageSize: params?.pageSize ?? 25,
      searchTerm: params?.searchTerm || null,
      statusFilter: params?.statusFilter || 'all',
      typeFilter: params?.typeFilter || 'all',
      fromDate: params?.fromDate || null,
      toDate: params?.toDate || null,
      minAmount: params?.minAmount ?? null,
      maxAmount: params?.maxAmount ?? null,
      createdByFilter: params?.createdByFilter || null,
      sortBy: params?.sortBy || null,
      sortDir: params?.sortDir || null,
      includeCreators: params?.includeCreators ? true : null,
      dataVisibility: params?.dataVisibility || null,
      userId: params?.userId || null,
    });
    const raw = response.data;
    return {
      invoices: raw?.Invoices || raw?.invoices || [],
      totalCount: raw?.TotalCount || raw?.totalCount || 0,
      creators: raw?.Creators || raw?.creators || [],
    };
  },

  async getById(organization: string, invoiceId: string): Promise<Invoice | null> {
    const response = await axiosInstance.post(ENDPOINTS.GET_INVOICE_BY_ID, { organization, invoiceId });
    return response.data?.invoice || response.data?.Invoice || response.data || null;
  },

  async create(organization: string, invoice: Partial<Invoice>, userId?: string, userName?: string): Promise<any> {
    // The backend (and the web app) expects the document under `invoiceData`.
    const response = await axiosInstance.post(ENDPOINTS.CREATE_INVOICE, {
      organization,
      invoiceData: invoice,
      userId: userId ?? '',
      userName: userName ?? '',
    });
    return response.data;
  },

  async update(organization: string, invoiceId: string, invoice: Partial<Invoice>, userId?: string, userName?: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_INVOICE, {
      organization,
      invoiceId,
      invoiceData: invoice,
      userId: userId ?? '',
      userName: userName ?? '',
    });
    return response.data;
  },

  /** Issue (finalize + lock) a draft. Returns { Success, Message, notConnected?, allocation? }. */
  async issue(organization: string, invoiceId: string, userId?: string, userName?: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.ISSUE_INVOICE, {
      organization,
      invoiceId,
      userId: userId ?? '',
      userName: userName ?? '',
    });
    return response.data;
  },

  /** Derive another document (e.g. a receipt for the open balance) from an issued invoice. Returns { success, message: newInvoiceId }. */
  async createDocumentFrom(
    organization: string,
    sourceInvoiceId: string,
    targetType: string,
    partialAmount = 0,
    userId?: string,
    userName?: string,
  ): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.CREATE_DOCUMENT_FROM_INVOICE, {
      organization,
      sourceInvoiceId,
      targetType,
      partialAmount,
      userId: userId ?? '',
      userName: userName ?? '',
    });
    return response.data;
  },

  /** Open (unpaid issued) documents: count / total / overdue — same endpoint the web list header uses. */
  async getOpenSummary(organization: string): Promise<OpenInvoicesSummary | null> {
    const response = await axiosInstance.post(ENDPOINTS.GET_OPEN_INVOICES_SUMMARY, { organization });
    const d = response.data;
    if (!d || typeof d !== 'object') return null;
    return {
      count: Number(d.count ?? d.Count ?? 0),
      total: Number(d.total ?? d.Total ?? 0),
      overdueCount: Number(d.overdueCount ?? d.OverdueCount ?? 0),
      overdueTotal: Number(d.overdueTotal ?? d.OverdueTotal ?? 0),
      dueSoonCount: Number(d.dueSoonCount ?? d.DueSoonCount ?? 0),
    };
  },

  async delete(organization: string, invoiceId: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.DELETE_INVOICE, { organization, invoiceId });
    return response.data;
  },

  async getBranding(organization: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.GET_INVOICE_BRANDING, { organization });
    return response.data || {};
  },
};
