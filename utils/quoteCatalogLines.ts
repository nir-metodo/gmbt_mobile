// Mirrors gmbt_frontend/src/utils/quoteCatalogLines.js + quotePromotions.js so the app builds EXACTLY the same
// quote lines as the web: the product, its promotion line, its delivery & installation line, priced page info,
// the add-ons offered, and the empty add-on rows. Used by the quote editor (picking from the catalog) and by
// "create quote from lead" (the lead's products of interest).

import axiosInstance from '../services/api/axiosInstance';
import { ENDPOINTS } from '../constants/api';

// ── Promotions ("מבצעים") ─────────────────────────────────────────────────────────────────────────────────────

export const catalogItemKey = (ci: any): string =>
  String(ci?.id || ci?.sku || (ci?.name || '').trim().toLowerCase() || '');

const todayStr = (now = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
};

const isPromotionInDateRange = (promo: any, now = new Date()) => {
  const t = todayStr(now);
  if (promo?.startDate && t < promo.startDate) return false;
  if (promo?.endDate && t > promo.endDate) return false;
  return true;
};

const promotionAppliesToItem = (promo: any, ci: any) => {
  if (!promo || !ci) return false;
  if (promo.appliesTo === 'categories') {
    const cats = Array.isArray(promo.categories) ? promo.categories : [];
    return !!ci.category && cats.includes(ci.category);
  }
  if (promo.appliesTo === 'items') {
    const keys = Array.isArray(promo.itemKeys) ? promo.itemKeys : [];
    return keys.includes(catalogItemKey(ci));
  }
  return true;
};

const promotionDiscountPerUnit = (promo: any, unitPrice: any) => {
  const price = Number(unitPrice) || 0;
  const value = Number(promo?.value) || 0;
  if (price <= 0 || value <= 0) return 0;
  let d = 0;
  if (promo.type === 'percent') d = price * (Math.min(value, 100) / 100);
  else if (promo.type === 'fixed') d = value;
  else if (promo.type === 'price') d = price - value;
  return Math.max(0, Math.min(price, Math.round(d * 100) / 100));
};

export const getActivePromotion = (ci: any, promotions: any, now = new Date()) => {
  if (!ci || !Array.isArray(promotions) || promotions.length === 0) return null;
  const price = Number(ci.unitPrice) || 0;
  let best: { promo: any; discountPerUnit: number; promoPrice: number } | null = null;
  promotions.forEach((promo: any) => {
    if (!promo || promo.enabled === false) return;
    if (!isPromotionInDateRange(promo, now)) return;
    if (!promotionAppliesToItem(promo, ci)) return;
    const d = promotionDiscountPerUnit(promo, price);
    if (d > 0 && (!best || d > best.discountPerUnit)) {
      best = { promo, discountPerUnit: d, promoPrice: Math.round((price - d) * 100) / 100 };
    }
  });
  return best;
};

// ── Catalog lines ─────────────────────────────────────────────────────────────────────────────────────────────

export const resolveCatalogImage = (ci: any): string => {
  if (!ci) return '';
  if (Array.isArray(ci.images) && ci.images.length && ci.images[0]) return ci.images[0];
  return ci.imageUrl || ci.image || ci.thumbnail || '';
};

export const getLinkedRowsConfig = (cfg: any) => {
  const c = cfg || {};
  const rows = parseInt(c.extras?.rows, 10);
  return {
    delivery: { enabled: c.delivery?.enabled !== false },
    extras: { enabled: c.extras?.enabled !== false, rows: rows >= 1 && rows <= 10 ? rows : 3 },
    dimensions: { enabled: c.dimensions?.enabled === true },
    productLink: { enabled: c.productLink?.enabled === true, column: c.productLink?.column || 'link' },
    custom: (c.custom || {}) as Record<string, any>,
  };
};

export const newExtraRow = (): any => ({ type: 'item', lineKind: 'extra', description: '', quantity: 1, unitPrice: 0, image: '' });

export interface QuoteCatalogCtx {
  branding?: any;
  catalogCustomColumns?: any[];
  quantity?: number;
}

/** Quote items after adding catalog product `ci` to `prevItems` (same maths/lines as the web editor). */
export const addCatalogProductToItems = (prevItems: any[], ci: any, ctx: QuoteCatalogCtx = {}): any[] => {
  const { branding = {}, catalogCustomColumns = [] } = ctx;
  const qty = Math.max(1, parseInt(String(ctx.quantity), 10) || 1);
  const keptItems = (prevItems || []).filter(
    (i) => i.lineKind === 'extra' || (i.description || i.name || '').trim() || Number(i.unitPrice) > 0,
  );
  const extraRows = keptItems.filter((i) => i.lineKind === 'extra');
  const existingItems = keptItems.filter((i) => i.lineKind !== 'extra');
  const quoteColumns = catalogCustomColumns.filter((c: any) => c.showInQuote);
  const customFieldsText = quoteColumns
    .filter((col: any) => ci.customFields?.[col.key])
    .map((col: any) => `${col.label}: ${ci.customFields[col.key]}`)
    .join(' | ');
  // (catalogs whose data lives only in custom fields can have no `name` — never produce " - text")
  const descBase = ci.name && ci.description ? `${ci.name} - ${ci.description}` : ci.name || ci.description || '';
  const linkedCfg = getLinkedRowsConfig(branding.linkedRows);
  const dimensionsText =
    linkedCfg.dimensions.enabled && ci.dimensions
      ? `מידות: ${String(ci.dimensions).replace(/\s*\n+\s*/g, ' | ')}`
      : '';
  const linkedInfoOn = (Array.isArray(ci.linkedInfo) ? ci.linkedInfo : []).filter(
    (info: any) => info && linkedCfg.custom[info.key || String(info.label || '').toLowerCase()]?.enabled !== false,
  );
  const linkedInfoText = linkedInfoOn
    .filter((info: any) => !(Number(info.price) > 0) && info.text)
    .map((info: any) => `${info.label}: ${String(info.text).replace(/\s*\n+\s*/g, ' | ')}`)
    .join('\n');
  const description = [descBase, customFieldsText, dimensionsText, linkedInfoText].filter(Boolean).join('\n');

  const promoHit: any = getActivePromotion(ci, branding.promotions);
  const newItems: any[] = [
    {
      type: 'item',
      description,
      quantity: qty,
      unitPrice: ci.unitPrice || 0,
      ...(() => {
        if (!linkedCfg.productLink.enabled) return {};
        const col = linkedCfg.productLink.column;
        const url = String((col === 'link' ? ci.link : ci.customFields?.[col]) || '').trim();
        return /^https?:\/\//i.test(url) ? { link: url } : {};
      })(),
      ...(linkedCfg.extras.enabled && Array.isArray(ci.extras) && ci.extras.length > 0
        ? {
            availableExtras: ci.extras
              .filter((ex: any) => ex && (ex.name || '').trim())
              .slice(0, 24)
              .map((ex: any) => ({
                name: String(ex.name).trim(),
                price: Number(ex.price) || 0,
                image: ex.image || '',
                link: ex.link || '',
              })),
          }
        : {}),
      image: resolveCatalogImage(ci),
      images:
        Array.isArray(ci.images) && ci.images.length
          ? ci.images
          : resolveCatalogImage(ci)
            ? [resolveCatalogImage(ci)]
            : [],
    },
  ];
  if (promoHit) {
    newItems.push({
      type: 'discount',
      description: `מבצע: ${promoHit.promo.name || ci.name}`,
      quantity: qty,
      unitPrice: promoHit.discountPerUnit,
      promoId: promoHit.promo.id,
    });
  }
  const deliveryPrice = Number(ci.delivery?.price) || 0;
  if (linkedCfg.delivery.enabled && deliveryPrice > 0) {
    newItems.push({
      type: 'item',
      lineKind: 'delivery',
      description: `${ci.delivery.title || 'הובלה והתקנה'} — ${ci.name}`,
      quantity: 1,
      unitPrice: deliveryPrice,
      link: ci.delivery.link || ci.link || '',
    });
  }
  linkedInfoOn
    .filter((info: any) => Number(info.price) > 0)
    .forEach((info: any) => {
      newItems.push({
        type: 'item',
        lineKind: 'linked',
        description: `${info.label} — ${ci.name}`,
        quantity: 1,
        unitPrice: Number(info.price),
        link: ci.link || '',
      });
    });
  const offersExtras = linkedCfg.extras.enabled && Array.isArray(ci.extras) && ci.extras.length > 0;
  const extrasTail =
    extraRows.length || !offersExtras ? extraRows : Array.from({ length: linkedCfg.extras.rows }, newExtraRow);
  return [...existingItems, ...newItems, ...extrasTail];
};

export interface QuoteCatalogData {
  catalog: any[];
  catalogCustomColumns: any[];
  branding: any;
}

/** Loads the org catalog + the branding bits that drive the lines (linkedRows, promotions). Never throws. */
export const loadQuoteCatalog = async (organization: string): Promise<QuoteCatalogData> => {
  try {
    const res = await axiosInstance.post(ENDPOINTS.GET_QUOTE_BRANDING, { organization });
    const d = res.data || {};
    return {
      catalog: Array.isArray(d.catalogItems) ? d.catalogItems : [],
      catalogCustomColumns: Array.isArray(d.catalogCustomColumns) ? d.catalogCustomColumns : [],
      branding: { linkedRows: d.linkedRows, promotions: d.promotions },
    };
  } catch {
    return { catalog: [], catalogCustomColumns: [], branding: {} };
  }
};

/** Lines for a quote built from a lead's interested products (unknown products stay plain lines). */
export const buildQuoteItemsFromProducts = (
  products: any[],
  { catalog = [], catalogCustomColumns = [], branding = {} }: Partial<QuoteCatalogData> = {},
  { keepExtraRows = false }: { keepExtraRows?: boolean } = {},
): any[] => {
  let items: any[] = [];
  (products || []).forEach((p: any) => {
    const ci =
      catalog.find((c: any) => c.id && c.id === p.productId) ||
      catalog.find((c: any) => c.name && (c.name || '').trim() === (p.name || '').trim());
    if (ci) {
      const hasPrice = p.unitPrice !== undefined && p.unitPrice !== null && p.unitPrice !== '';
      const merged = hasPrice ? { ...ci, unitPrice: parseFloat(p.unitPrice) || 0 } : ci;
      items = addCatalogProductToItems(items, merged, { branding, catalogCustomColumns, quantity: p.quantity || 1 });
    } else {
      items = [
        ...items.filter((i) => i.lineKind === 'extra' || (i.description || '').trim() || Number(i.unitPrice) > 0),
        { type: 'item', description: p.name || '', quantity: p.quantity || 1, unitPrice: parseFloat(p.unitPrice) || 0 },
      ];
    }
  });
  return keepExtraRows ? items : items.filter((it) => !(it.lineKind === 'extra' && !(it.description || '').trim()));
};

/** Same maths as the web editor: priced lines add up, discount (promotion) lines are subtracted before tax. */
export const quoteItemTotals = (items: any[]) => {
  const subtotal = (items || [])
    .filter((it) => !it.type || it.type === 'item')
    .reduce(
      (s, it) =>
        s +
        Math.max((parseFloat(it.unitPrice) || 0) * (parseInt(it.quantity) || 1) - (parseFloat(it.discount) || 0), 0),
      0,
    );
  const lineDiscounts = (items || [])
    .filter((it) => it.type === 'discount')
    .reduce((s, it) => s + (parseInt(it.quantity) || 1) * Math.abs(parseFloat(it.unitPrice) || 0), 0);
  return { subtotal, lineDiscounts };
};

/** Display text of a quote line — web lines only have `description`, older app lines had `name` (+ description). */
export const quoteItemText = (it: any): string => (it?.description || it?.name || '') as string;
