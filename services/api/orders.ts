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

export const ordersApi = {
  async getAll(organization: string, params?: { status?: string; page?: number; pageSize?: number }): Promise<Order[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_ORDERS, {
      organizationName: organization,
      status: params?.status,
      page: params?.page ?? 1,
      pageSize: params?.pageSize ?? 50,
    });
    const raw = response.data;
    const items = raw?.orders || raw?.Orders || raw?.data || raw?.Data || (Array.isArray(raw) ? raw : []);
    return Array.isArray(items) ? items : [];
  },

  async getById(organization: string, orderId: string): Promise<Order | null> {
    const response = await axiosInstance.post(ENDPOINTS.GET_ORDER, {
      organizationName: organization,
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

  async updateStatus(organization: string, orderId: string, status: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_ORDER_STATUS, {
      organizationName: organization,
      orderId,
      status,
    });
    return response.data;
  },

  async addNote(organization: string, orderId: string, note: string, userId?: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.ADD_ORDER_NOTE, {
      organizationName: organization,
      orderId,
      note,
      userId,
    });
    return response.data;
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
