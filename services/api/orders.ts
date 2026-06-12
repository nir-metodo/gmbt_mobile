import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';

export interface OrderItem {
  id?: string;
  productId?: string;
  productName: string;
  sku?: string;
  quantity: number;
  price: number;
  total?: number;
}

export interface Order {
  id: string;
  orderNumber?: string;
  status: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  contactId?: string;
  totalAmount?: number;
  subtotal?: number;
  tax?: number;
  shipping?: number;
  currency?: string;
  items?: OrderItem[];
  notes?: string;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
  shippingAddress?: string;
  paymentMethod?: string;
}

export interface OrderNote {
  id?: string;
  note: string;
  createdAt?: string;
  createdBy?: string;
}

export interface OrderStatusConfig {
  id: string;
  label: string;
  color: string;
  icon?: string;
  order: number;
}

export const DEFAULT_ORDER_STATUSES: OrderStatusConfig[] = [
  { id: 'pending', label: 'ממתין', color: '#f59e0b', icon: 'clock-outline', order: 0 },
  { id: 'confirmed', label: 'אושר', color: '#3b82f6', icon: 'check-circle-outline', order: 1 },
  { id: 'collected', label: 'נאסף', color: '#8b5cf6', icon: 'package-variant', order: 2 },
  { id: 'shipped', label: 'נשלח', color: '#06b6d4', icon: 'truck-outline', order: 3 },
  { id: 'delivered', label: 'נמסר', color: '#10b981', icon: 'package-variant-closed-check', order: 4 },
  { id: 'cancelled', label: 'בוטל', color: '#ef4444', icon: 'close-circle-outline', order: 5 },
];

const STATUS_ICON_MAP: Record<string, string> = {
  pending: 'clock-outline',
  confirmed: 'check-circle-outline',
  collected: 'package-variant',
  processing: 'cog-outline',
  shipped: 'truck-outline',
  delivered: 'package-variant-closed-check',
  cancelled: 'close-circle-outline',
  refunded: 'cash-refund',
};

export function resolveOrderStatusIcon(statusId: string): string {
  return STATUS_ICON_MAP[statusId] || 'circle-outline';
}

export function normalizeOrderStatus(status?: string): string {
  if (!status) return 'pending';
  return status === 'processing' ? 'collected' : status;
}

export function getOrderTotal(order: Order): number {
  const raw = order.totalAmount ?? (order as { total?: number }).total;
  return raw != null ? Number(raw) : 0;
}

export const ordersApi = {
  async getAll(organization: string, params?: { status?: string; page?: number; pageSize?: number }): Promise<Order[]> {
    // Backend GetOrders reads `organization` + `filters` (not `organizationName`/`status`).
    // Sending the wrong field returned "organization required" → empty list on mobile.
    // Mirror the web: send organization + empty filters and filter client-side.
    const response = await axiosInstance.post(ENDPOINTS.GET_ORDERS, {
      organization,
      filters: params?.status ? { status: params.status } : {},
    });
    const raw = response.data;
    const items = raw?.orders || raw?.Orders || raw?.data || raw?.Data || (Array.isArray(raw) ? raw : []);
    return Array.isArray(items) ? items : [];
  },

  async getById(organization: string, orderId: string): Promise<Order | null> {
    const response = await axiosInstance.post(ENDPOINTS.GET_ORDER, {
      organization,
      orderId,
    });
    return response.data?.order || response.data?.Order || response.data || null;
  },

  async create(organization: string, order: Partial<Order> & { customerName?: string; discount?: number; isPaid?: boolean; orderNumber?: string; dynamicData?: Record<string, any> }, userId?: string, userName?: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.CREATE_ORDER, {
      organization,
      contactId: order.contactId ?? '',
      customerName: order.customerName ?? '',
      customerPhone: order.customerPhone ?? '',
      customerEmail: order.customerEmail ?? '',
      shippingAddress: order.shippingAddress ?? '',
      status: order.status ?? 'pending',
      notes: order.notes ?? '',
      items: (order.items ?? []).map((it: any) => ({
        ...it,
        productName: it.productName || it.name || '',
        quantity: parseInt(String(it.quantity)) || 1,
        price: parseFloat(String(it.price)) || 0,
        total: (parseFloat(String(it.price)) || 0) * (parseInt(String(it.quantity)) || 1),
      })),
      currency: order.currency ?? 'ILS',
      subtotal: order.subtotal ?? 0,
      discount: order.discount ?? 0,
      tax: order.tax ?? 0,
      totalAmount: order.totalAmount ?? 0,
      paymentMethod: order.paymentMethod ?? '',
      isPaid: order.isPaid ?? false,
      orderNumber: order.orderNumber ?? '',
      dynamicData: order.dynamicData ?? {},
      userId: userId ?? '',
      userName: userName ?? '',
    });
    return response.data;
  },

  async updateStatus(organization: string, orderId: string, status: string, userId?: string, userName?: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_ORDER_STATUS, {
      organization,
      orderId,
      status,
      userId: userId ?? '',
      userName: userName ?? '',
    });
    return response.data;
  },

  async addNote(organization: string, orderId: string, note: string, userId?: string, userName?: string): Promise<any> {
    // Backend AddOrderNote takes a JSON body ({ organization, orderId, note, userId, userName })
    // and does not support file attachments — mirror the web payload exactly.
    const response = await axiosInstance.post(ENDPOINTS.ADD_ORDER_NOTE, {
      organization,
      orderId,
      note,
      userId: userId ?? '',
      userName: userName ?? '',
    });
    return response.data;
  },

  async getSettings(organization: string): Promise<{ statuses: OrderStatusConfig[] }> {
    try {
      const response = await axiosInstance.post(ENDPOINTS.GET_ORDERS_SETTINGS, { organization });
      const raw = response.data;
      if (raw?.success && raw?.settings?.statuses) {
        const statuses = (raw.settings.statuses as OrderStatusConfig[])
          .map((s, i) => ({
            ...s,
            order: s.order ?? i,
            icon: resolveOrderStatusIcon(s.id),
          }))
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        return { statuses };
      }
    } catch {
      // fall through to defaults
    }
    return { statuses: DEFAULT_ORDER_STATUSES };
  },

  async getOrderFormSettings(organization: string): Promise<{ sections: any[]; formLayout: string[] }> {
    try {
      const response = await axiosInstance.post(ENDPOINTS.GET_ORDER_FORM_SETTINGS, { organization });
      const raw = response.data;
      if (raw?.error) return { sections: [], formLayout: [] };
      return {
        sections: Array.isArray(raw?.sections) ? raw.sections : [],
        formLayout: Array.isArray(raw?.formLayout) ? raw.formLayout : [],
      };
    } catch {
      return { sections: [], formLayout: [] };
    }
  },
};
