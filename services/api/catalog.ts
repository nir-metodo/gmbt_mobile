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
  /** When true, the item is shown in the public catalog while shareMode === 'marked'. */
  isPublic?: boolean;
}

export interface CatalogCustomColumn {
  id: string;
  key: string;
  label: string;
  type: string;
  showInQuote?: boolean;
  searchable?: boolean;
  /** Whether the column is shown in the catalog list/cards (web Catalog → Columns). Defaults to true. */
  showInTable?: boolean;
  /** Dedicated toolbar filter for this column: '' | 'text' | 'range' | 'select' | 'boolean' | 'date' (set on web). */
  filterType?: '' | 'text' | 'range' | 'select' | 'boolean' | 'date' | string;
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
  /** Persisted display order of columns/fields (tokens: base keys + `custom:<id>`), set in the web Catalog → Columns settings. */
  columnOrder?: string[];
  /** Which base columns are shown in the catalog list/cards (web Catalog → Columns). */
  tableColumns?: Record<string, boolean>;
  /** Enables a "price from/to" range filter in the catalog toolbar (web Catalog → Columns). */
  priceRangeFilter?: boolean;
}

export interface CatalogData {
  catalogItems: CatalogItem[];
  catalogCustomColumns: CatalogCustomColumn[];
  catalogFieldsConfig?: CatalogFieldsConfig;
}

export interface PublicCatalogConfig {
  enabled?: boolean;
  slug?: string;
  title?: string;
  purpose?: 'browse' | 'order' | 'lead' | 'inquiry';
  whatsappShare?: boolean;
  whatsappNumber?: string;
  allowQuantity?: boolean;
  requireContact?: boolean;
  columns?: Record<string, boolean>;
  /** 'all' shares the whole catalog; 'marked' shares only items with isPublic. Defaults to 'all'. */
  shareMode?: 'all' | 'marked';
}

export interface CatalogSelectionItem {
  id?: string;
  name?: string;
  sku?: string;
  unitPrice?: number;
  quantity?: number;
  total?: number;
  images?: string[];
  description?: string;
  category?: string;
  link?: string;
  customFields?: Record<string, any>;
}

export interface CatalogSelection {
  id: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  note?: string;
  purpose?: string;
  total?: number;
  currency?: string;
  slug?: string;
  createdAt?: string;
  items?: CatalogSelectionItem[];
}

function genSlug(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
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

  /** Reads the public-catalog share config from branding. */
  async getPublicConfig(organization: string): Promise<PublicCatalogConfig> {
    const response = await axiosInstance.post(ENDPOINTS.GET_QUOTE_BRANDING, { organization });
    const raw = response.data || {};
    return (raw.publicCatalog && typeof raw.publicCatalog === 'object') ? raw.publicCatalog : {};
  },

  /**
   * Enables (or updates) the shareable public catalog and returns the saved config. Preserves the
   * full branding doc (saved with overwrite) and any existing publicCatalog fields; only fills in
   * sensible defaults when sharing is turned on for the first time.
   */
  async enablePublicCatalog(organization: string): Promise<PublicCatalogConfig> {
    const response = await axiosInstance.post(ENDPOINTS.GET_QUOTE_BRANDING, { organization });
    const existing = response.data || {};
    const current: PublicCatalogConfig = (existing.publicCatalog && typeof existing.publicCatalog === 'object') ? existing.publicCatalog : {};
    const cfg: PublicCatalogConfig = {
      // Default to "lead" so selections are visible both in Leads and the selections viewer.
      purpose: current.purpose || 'lead',
      whatsappShare: current.whatsappShare !== false,
      requireContact: current.requireContact !== false,
      allowQuantity: current.allowQuantity || false,
      columns: current.columns && Object.keys(current.columns).length ? current.columns : { image: true, description: true, unitPrice: true, category: true },
      title: current.title || '',
      whatsappNumber: current.whatsappNumber || '',
      ...current,
      enabled: true,
      slug: current.slug || genSlug(),
    };
    await axiosInstance.post(ENDPOINTS.SAVE_QUOTE_BRANDING, {
      organization,
      brandingData: { ...existing, publicCatalog: cfg },
    });
    return cfg;
  },

  /**
   * Saves the public-catalog share config (and optionally the current items, so item public-marks
   * are committed together with a shareMode change). Re-fetches the full branding doc first so we
   * never drop logo/colors/columns (backend persists branding with overwrite).
   */
  async savePublicConfig(organization: string, cfg: PublicCatalogConfig, items?: CatalogItem[]): Promise<PublicCatalogConfig> {
    const response = await axiosInstance.post(ENDPOINTS.GET_QUOTE_BRANDING, { organization });
    const existing = response.data || {};
    const brandingData: Record<string, any> = { ...existing, publicCatalog: cfg };
    if (Array.isArray(items)) brandingData.catalogItems = items;
    await axiosInstance.post(ENDPOINTS.SAVE_QUOTE_BRANDING, { organization, brandingData });
    return cfg;
  },

  /**
   * Creates a per-contact personalized catalog share link. The customer opening the returned link
   * (`/catalog/{org}?p={token}`) sees only the hand-picked items (or the whole catalog when itemIds
   * is empty). Returns the public token.
   */
  async createShareLink(
    organization: string,
    opts: { itemIds: string[]; contactName?: string; contactPhone?: string; contactEmail?: string; title?: string; purpose?: string; createdBy?: string; createdById?: string }
  ): Promise<{ token: string; id: string }> {
    const response = await axiosInstance.post(ENDPOINTS.CREATE_CATALOG_SHARE_LINK, {
      organization,
      itemIds: opts.itemIds || [],
      contactName: opts.contactName || '',
      contactPhone: (opts.contactPhone || '').replace(/\D/g, ''),
      contactEmail: opts.contactEmail || '',
      title: opts.title || '',
      purpose: opts.purpose || 'browse',
      createdBy: opts.createdBy || '',
      createdById: opts.createdById || '',
    });
    const raw = response.data || {};
    if (raw.ok === false || !raw.token) throw new Error(raw.error || 'Failed to create share link');
    return { token: raw.token, id: raw.id };
  },

  /** Lists customer selections submitted via the public catalog (newest first). */
  async getSelections(organization: string): Promise<CatalogSelection[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_CATALOG_SELECTIONS, { organization });
    const raw = response.data || {};
    const list = Array.isArray(raw.selections) ? raw.selections : (Array.isArray(raw) ? raw : []);
    return list as CatalogSelection[];
  },
};
