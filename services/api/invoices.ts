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
}

export const DOCUMENT_TYPES = [
  { key: 'tax_invoice',    labelHe: 'חשבונית מס',           color: '#2e6155' },
  { key: 'combined',       labelHe: 'חשבונית מס קבלה',      color: '#7c3aed' },
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
    params?: { page?: number; pageSize?: number; searchTerm?: string; statusFilter?: string; typeFilter?: string }
  ): Promise<{ invoices: Invoice[]; totalCount: number }> {
    const response = await axiosInstance.post(ENDPOINTS.GET_INVOICES_PAGINATED, {
      organization,
      pageNumber: params?.page ?? 1,
      pageSize: params?.pageSize ?? 25,
      searchTerm: params?.searchTerm || null,
      statusFilter: params?.statusFilter || 'all',
      typeFilter: params?.typeFilter || 'all',
    });
    const raw = response.data;
    return {
      invoices: raw?.Invoices || raw?.invoices || [],
      totalCount: raw?.TotalCount || raw?.totalCount || 0,
    };
  },

  async getById(organization: string, invoiceId: string): Promise<Invoice | null> {
    const response = await axiosInstance.post(ENDPOINTS.GET_INVOICE_BY_ID, { organization, invoiceId });
    return response.data?.invoice || response.data?.Invoice || response.data || null;
  },

  async create(organization: string, invoice: Partial<Invoice>, userId?: string, userName?: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.CREATE_INVOICE, {
      organization,
      ...invoice,
      userId: userId ?? '',
      userName: userName ?? '',
    });
    return response.data;
  },

  async update(organization: string, invoiceId: string, invoice: Partial<Invoice>): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_INVOICE, { organization, invoiceId, ...invoice });
    return response.data;
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
