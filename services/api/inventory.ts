import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';

export interface InventoryItem {
  id: string;
  productName: string;
  sku?: string;
  quantity: number;
  minQuantity?: number;
  maxQuantity?: number;
  price?: number;
  cost?: number;
  currency?: string;
  category?: string;
  catalogId?: string;
  description?: string;
  imageUrl?: string;
  location?: string;
  isActive?: boolean;
  lastUpdated?: string;
}

export interface StockMovement {
  id?: string;
  type: string;
  quantity: number;
  note?: string;
  createdAt?: string;
  createdBy?: string;
  previousQuantity?: number;
  newQuantity?: number;
}

export const inventoryApi = {
  async getAll(organization: string, params?: { search?: string; category?: string }): Promise<InventoryItem[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_INVENTORY, {
      organizationName: organization,
      search: params?.search,
      category: params?.category,
    });
    const raw = response.data;
    const items = raw?.items || raw?.Items || raw?.inventory || raw?.data || raw?.Data || (Array.isArray(raw) ? raw : []);
    return Array.isArray(items) ? items : [];
  },

  async getById(organization: string, itemId: string): Promise<InventoryItem | null> {
    const response = await axiosInstance.post(ENDPOINTS.GET_INVENTORY_ITEM, {
      organizationName: organization,
      itemId,
    });
    return response.data?.item || response.data?.Item || response.data || null;
  },

  async adjustStock(organization: string, itemId: string, quantity: number, note?: string, userId?: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.ADJUST_STOCK, {
      organizationName: organization,
      itemId,
      quantity,
      note,
      userId,
    });
    return response.data;
  },

  async createItem(organization: string, item: Partial<InventoryItem> & { sku: string; productName: string }): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.SAVE_INVENTORY_ITEM, {
      organization,
      sku: item.sku,
      productName: item.productName,
      quantity: item.quantity ?? 0,
      lowStockThreshold: item.minQuantity ?? 5,
      trackStock: true,
      location: item.location ?? '',
      notes: item.description ?? '',
      costPrice: item.cost ?? 0,
      catalogId: item.catalogId ?? '',
      category: item.category ?? '',
      unit: '',
      customFields: {},
    });
    return response.data;
  },

  async getMovements(organization: string, itemId: string): Promise<StockMovement[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_INVENTORY_MOVEMENTS, {
      organizationName: organization,
      itemId,
    });
    const raw = response.data;
    const items = raw?.movements || raw?.Movements || raw?.data || (Array.isArray(raw) ? raw : []);
    return Array.isArray(items) ? items : [];
  },
};
