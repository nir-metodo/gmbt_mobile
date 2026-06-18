import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';

export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  unitPrice: number;
  sku: string;
  category: string;
  link: string;
  images: string[];
  customFields?: Record<string, any>;
}

export interface CatalogCustomColumn {
  id: string;
  key: string;
  label: string;
  type: string;
  showInQuote?: boolean;
  searchable?: boolean;
  // Web stores select options as a comma-separated string; older/other data may be an array.
  options?: string[] | string;
}

export interface CatalogFieldsConfig {
  name?: boolean;
  description?: boolean;
  unitPrice?: boolean;
  sku?: boolean;
  category?: boolean;
  link?: boolean;
  /** Which field is mandatory when adding/editing an item (defaults to 'name'). */
  requiredField?: string;
  /** Which base fields are included in list search (defaults to name + description + sku). */
  searchBaseFields?: Record<string, boolean>;
}

export interface CatalogData {
  catalogItems: CatalogItem[];
  catalogCustomColumns: CatalogCustomColumn[];
  catalogFieldsConfig?: CatalogFieldsConfig;
}

export const catalogApi = {
  async getAll(organization: string): Promise<CatalogData> {
    const response = await axiosInstance.post(ENDPOINTS.GET_QUOTE_BRANDING, {
      organization,
    });
    const raw = response.data || {};
    return {
      catalogItems: Array.isArray(raw.catalogItems) ? raw.catalogItems : [],
      catalogCustomColumns: Array.isArray(raw.catalogCustomColumns) ? raw.catalogCustomColumns : [],
      catalogFieldsConfig: raw.catalogFieldsConfig || undefined,
    };
  },

  async save(organization: string, items: CatalogItem[], customColumns?: CatalogCustomColumn[]): Promise<void> {
    // The backend persists branding with SetOptions.Overwrite, so we must send back the FULL doc.
    // Re-fetch the latest branding so we don't drop logo/colors/fieldsConfig and don't clobber
    // column definitions that may have been edited on web since this screen loaded.
    const response = await axiosInstance.post(ENDPOINTS.GET_QUOTE_BRANDING, {
      organization,
    });
    const existing = response.data || {};
    const brandingData: Record<string, any> = {
      ...existing,
      catalogItems: items,
    };
    // Mobile cannot edit column definitions — keep whatever the server has. Only fall back to the
    // in-memory columns if the server doc somehow has none (e.g. first-ever save).
    if (!Array.isArray(existing.catalogCustomColumns) && customColumns) {
      brandingData.catalogCustomColumns = customColumns;
    }
    await axiosInstance.post(ENDPOINTS.SAVE_QUOTE_BRANDING, {
      organization,
      brandingData,
    });
  },

  async deleteItem(organization: string, itemId: string, allItems: CatalogItem[]): Promise<CatalogItem[]> {
    const updated = allItems.filter((i) => i.id !== itemId);
    await this.save(organization, updated);
    return updated;
  },
};
