import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';

export interface POItem {
  id?: string;
  productName: string;
  sku?: string;
  quantity: number;
  costPrice: number;
  total?: number;
}

export interface PurchaseOrder {
  id: string;
  poNumber?: string;
  supplierId?: string;
  supplierName?: string;
  status: string;
  expectedDate?: string;
  items?: POItem[];
  total?: number;
  currency?: string;
  notes?: string;
  receivedBy?: string;
  receivedByName?: string;
  receivedOn?: string;
  createdOn?: string;
  modifiedOn?: string;
}

export const purchaseOrdersApi = {
  async getAll(organization: string): Promise<PurchaseOrder[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_PURCHASE_ORDERS, { organization });
    const raw = response.data;
    const items = raw?.purchaseOrders || raw?.PurchaseOrders || raw?.data || (Array.isArray(raw) ? raw : []);
    return Array.isArray(items) ? items : [];
  },

  async getById(organization: string, poId: string): Promise<PurchaseOrder | null> {
    const response = await axiosInstance.post(ENDPOINTS.GET_PURCHASE_ORDER, { organization, poId });
    return response.data?.purchaseOrder || response.data?.PurchaseOrder || null;
  },

  async create(organization: string, po: Partial<PurchaseOrder>, userId?: string, userName?: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.CREATE_PURCHASE_ORDER, {
      organization,
      supplierName: po.supplierName ?? '',
      supplierId: po.supplierId ?? '',
      status: po.status ?? 'draft',
      expectedDate: po.expectedDate ?? '',
      items: po.items ?? [],
      currency: po.currency ?? 'ILS',
      notes: po.notes ?? '',
      receivedBy: userId ?? '',
      receivedByName: userName ?? '',
    });
    return response.data;
  },

  async updateStatus(organization: string, poId: string, status: string, userId?: string, userName?: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_PURCHASE_ORDER, {
      organization,
      poId,
      status,
      receivedBy: userId ?? '',
      receivedByName: userName ?? '',
    });
    return response.data;
  },

  async delete(organization: string, poId: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.DELETE_PURCHASE_ORDER, { organization, poId });
    return response.data;
  },
};
