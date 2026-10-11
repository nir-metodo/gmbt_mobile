import { create } from 'zustand';
import type { Contact } from '../types';
import { contactsApi } from '../services/api/contacts';
import {
  queryPage,
  upsertMany,
  deleteById,
  getById,
  countRows,
  distinctValues,
} from '../services/db/repository';
import {
  CONTACTS_TABLE,
  mapContactRow,
  extractTags,
  contactId,
} from '../services/db/contactsTable';
import { syncContacts } from '../services/sync/contactsSync';
import {
  EMPTY_FILTERS,
  BUILTIN_VIEW_FILTERS,
  buildContactWhere,
  buildContactOrder,
  type BuiltInViewId,
  type ContactFilterState,
  type ContactSort,
} from '../services/contactFilters';

// Contacts are backed by SQLite (see services/db). The store holds only the current visible
// window (filtered / searched page), never the whole table - so a list of 50k contacts opens
// instantly from disk, scrolls with constant memory, and searches/filters run as SQL against the
// entire cached dataset (see services/contactFilters.ts for the WHERE builder).

const PAGE_SIZE = 50;

export type { ContactSort };
export type ContactFilters = ContactFilterState;

interface Facets {
  tags: string[];
  owners: string[];
  statuses: string[];
}

// Live counts for the built-in view tabs (a tab is hidden when its count is 0).
export type ViewCounts = Record<BuiltInViewId, number>;
const EMPTY_VIEW_COUNTS: ViewCounts = {
  __all: 0,
  __mine: 0,
  __unassigned: 0,
  __new: 0,
  __unread: 0,
  __optedout: 0,
};

interface ContactState {
  contacts: Contact[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  // Rows matching the current search + filters across the WHOLE cached table (not just the window).
  totalCount: number;
  viewCounts: ViewCounts;
  searchQuery: string;
  selectedContact: Contact | null;
  filters: ContactFilters;
  facets: Facets;

  organization: string;
  scopeOwnerId: string;
  currentUserId: string;

  loadContacts: (organization: string, userId?: string, dataVisibility?: string) => Promise<void>;
  loadMore: () => Promise<void>;
  // `reset` = the query changed (search/filters): start again from the first page instead of
  // preserving how far the user had scrolled.
  reloadWindow: (reset?: boolean) => Promise<void>;
  refreshFacets: () => Promise<void>;
  refreshViewCounts: () => Promise<void>;
  ensureFacets: (organization: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  // Who "Mine" refers to. Separate from loadContacts' userId, which is only set for own-data scopes.
  setCurrentUserId: (userId: string) => void;
  setSelectedContact: (contact: Contact | null) => void;
  setFilters: (partial: Partial<ContactFilters>) => void;
  replaceFilters: (filters: ContactFilters) => void;
  createContact: (organization: string, contact: Partial<Contact>, userId?: string, userName?: string) => Promise<Contact>;
  updateContact: (organization: string, contact: Partial<Contact>, userId?: string, userName?: string) => Promise<void>;
  deleteContact: (organization: string, contactId: string) => Promise<void>;
  addOrUpdateContact: (contact: Contact) => void;
  getContactById: (id: string) => Promise<Contact | null>;
}

function buildQuery(state: ContactState): {
  where: string;
  params: (string | number | null)[];
  orderBy: string;
} {
  const { where, params } = buildContactWhere(state.filters, {
    organization: state.organization,
    scopeOwnerId: state.scopeOwnerId,
    currentUserId: state.currentUserId,
    search: state.searchQuery,
  });
  return { where, params, orderBy: buildContactOrder(state.filters.sortBy) };
}

async function fetchWindow(
  state: ContactState,
  limit: number,
  offset: number,
): Promise<Contact[]> {
  const { where, params, orderBy } = buildQuery(state);
  return queryPage<Contact>(CONTACTS_TABLE, { where, params, orderBy, limit, offset });
}

// Guards against out-of-order results while the user types / toggles filters quickly.
let reloadSeq = 0;

export const useContactStore = create<ContactState>((set, get) => ({
  contacts: [],
  isLoading: false,
  isLoadingMore: false,
  hasMore: false,
  totalCount: 0,
  viewCounts: { ...EMPTY_VIEW_COUNTS },
  searchQuery: '',
  selectedContact: null,
  filters: { ...EMPTY_FILTERS },
  facets: { tags: [], owners: [], statuses: [] },

  organization: '',
  scopeOwnerId: '',
  currentUserId: '',

  loadContacts: async (organization, userId, dataVisibility) => {
    const scopeOwnerId = dataVisibility === 'own' ? userId || '' : '';
    set({
      organization,
      scopeOwnerId,
      currentUserId: userId || get().currentUserId,
    });

    // 1. Instant render from the on-device DB (if we have anything cached).
    const localCount = await countRows(CONTACTS_TABLE, 'organization = ?', [organization]);
    if (localCount > 0) {
      await get().reloadWindow();
      get().refreshFacets();
    } else {
      set({ isLoading: true });
    }

    // 2. Background sync from the server, refreshing the window + facets as data lands.
    syncContacts(organization, {
      userId: dataVisibility === 'own' ? userId : '',
      dataVisibility: dataVisibility || 'all',
      onProgress: (pageCount) => {
        // Show the first page of fresh data immediately; later pages refresh on completion.
        if (pageCount === 1) get().reloadWindow();
      },
    })
      .then(() => {
        get().reloadWindow();
        get().refreshFacets();
      })
      .catch(() => {
        set({ isLoading: false });
      });
  },

  reloadWindow: async (reset = false) => {
    const state = get();
    const seq = ++reloadSeq;
    // Preserve how many rows the user has already scrolled through on a background refresh
    // (sync landing / realtime update), but start over when the search or filters changed.
    const limit = reset ? PAGE_SIZE : Math.max(PAGE_SIZE, state.contacts.length);
    try {
      const { where, params } = buildQuery(state);
      const [rows, total] = await Promise.all([
        fetchWindow(state, limit, 0),
        countRows(CONTACTS_TABLE, where, params),
      ]);
      if (seq !== reloadSeq) return; // a newer query superseded this one
      set({
        contacts: rows,
        totalCount: total,
        isLoading: false,
        hasMore: rows.length >= limit && rows.length < total,
      });
    } catch {
      if (seq === reloadSeq) set({ isLoading: false });
    }
  },

  loadMore: async () => {
    const state = get();
    if (!state.hasMore || state.isLoadingMore) return;
    const seq = reloadSeq;
    set({ isLoadingMore: true });
    const offset = state.contacts.length;
    try {
      const rows = await fetchWindow(state, PAGE_SIZE, offset);
      if (seq !== reloadSeq) {
        set({ isLoadingMore: false });
        return; // the query changed while paging; the fresh window already replaced the list
      }
      set({
        contacts: [...get().contacts, ...rows],
        isLoadingMore: false,
        hasMore: rows.length === PAGE_SIZE,
      });
    } catch {
      set({ isLoadingMore: false });
    }
  },

  refreshFacets: async () => {
    const { organization } = get();
    if (!organization) return;
    try {
      const [owners, statuses, keysTexts] = await Promise.all([
        distinctValues(CONTACTS_TABLE, 'ownerName', 'organization = ?', [organization]),
        distinctValues(CONTACTS_TABLE, 'status', 'organization = ?', [organization]),
        distinctValues(CONTACTS_TABLE, 'keysText', "organization = ? AND keysText != ''", [organization]),
      ]);
      const tagSet = new Set<string>();
      keysTexts.forEach((kt) => extractTags(kt).forEach((t) => tagSet.add(t)));
      set({
        facets: {
          owners: owners.map((o) => o.trim()).filter(Boolean).sort(),
          statuses: statuses.map((s) => s.trim()).filter(Boolean).sort(),
          tags: Array.from(tagSet).sort(),
        },
      });
    } catch {
      // keep previous facets on failure
    }
    get().refreshViewCounts();
  },

  refreshViewCounts: async () => {
    const { organization, scopeOwnerId, currentUserId } = get();
    if (!organization) return;
    try {
      const ids = Object.keys(BUILTIN_VIEW_FILTERS) as BuiltInViewId[];
      const counts = await Promise.all(
        ids.map((id) => {
          if (id === '__mine' && !currentUserId) return Promise.resolve(0);
          const { where, params } = buildContactWhere(BUILTIN_VIEW_FILTERS[id], {
            organization,
            scopeOwnerId,
            currentUserId,
          });
          return countRows(CONTACTS_TABLE, where, params);
        }),
      );
      const next = { ...EMPTY_VIEW_COUNTS };
      ids.forEach((id, i) => {
        next[id] = counts[i];
      });
      set({ viewCounts: next });
    } catch {
      // keep previous counts
    }
  },

  // Lightweight: make sure org tag facets are available even when the Contacts tab was never
  // opened (so tag autocomplete works from the chat screen). Sets the org if missing, then reads
  // distinct tags from the on-device DB - no network sync, unlike loadContacts.
  ensureFacets: async (organization) => {
    if (!organization) return;
    if (get().organization !== organization) set({ organization });
    await get().refreshFacets();
  },

  setSearchQuery: (query) => {
    if (query === get().searchQuery) return;
    set({ searchQuery: query });
    get().reloadWindow(true);
  },

  setCurrentUserId: (userId) => {
    if (!userId || userId === get().currentUserId) return;
    set({ currentUserId: userId });
    get().reloadWindow();
    get().refreshViewCounts();
  },

  setSelectedContact: (contact) => set({ selectedContact: contact }),

  setFilters: (partial) => {
    set({ filters: { ...get().filters, ...partial } });
    get().reloadWindow(true);
  },

  replaceFilters: (filters) => {
    set({ filters: { ...EMPTY_FILTERS, ...filters } });
    get().reloadWindow(true);
  },

  createContact: async (organization, contact, userId, userName) => {
    const result = await contactsApi.create(organization, contact, userId, userName);
    // CreateNewContact returns a FirestoreResponse { Success, Message, Data } - the saved record
    // (incl. the resolved owner) is in Data. Merge it, and fall back to the creator so the new row
    // shows its owner immediately, even if the backend response is sparse.
    const data = (result && (result.Data || result.data)) || {};
    const newContact = {
      ...contact,
      ...data,
      ownerId: (contact as any).ownerId || data.ownerId || userId || '',
      ownerName: (contact as any).ownerName || data.ownerName || userName || '',
      id: data.id || contact.phoneNumber || contactId(contact),
    } as Contact;
    await upsertMany(CONTACTS_TABLE, [newContact], mapContactRow);
    set((state) => ({ contacts: [newContact, ...state.contacts], totalCount: state.totalCount + 1 }));
    get().refreshFacets();
    return newContact;
  },

  updateContact: async (organization, contact, userId, userName) => {
    const prevContacts = get().contacts;
    // Optimistic: patch the window + DB immediately.
    const merged = (() => {
      const existing = prevContacts.find((c) => c.id === contact.id);
      return { ...(existing || {}), ...contact } as Contact;
    })();
    set((state) => {
      const exists = state.contacts.some((c) => c.id === contact.id);
      return {
        contacts: exists
          ? state.contacts.map((c) => (c.id === contact.id ? { ...c, ...contact } : c))
          : [merged, ...state.contacts],
      };
    });
    await upsertMany(CONTACTS_TABLE, [merged], mapContactRow);
    try {
      await contactsApi.update(organization, contact, userId, userName);
    } catch (err) {
      set({ contacts: prevContacts });
      throw err;
    }
  },

  deleteContact: async (organization, id) => {
    const res = await contactsApi.delete(organization, id);
    if (res && res.Success === false) {
      throw new Error(res?.Message || res?.error || 'Delete failed');
    }
    await deleteById(CONTACTS_TABLE, id);
    set((state) => {
      const next = state.contacts.filter((c) => c.id !== id && c.phoneNumber !== id);
      return {
        contacts: next,
        totalCount: Math.max(0, state.totalCount - (state.contacts.length - next.length)),
      };
    });
    get().refreshViewCounts();
  },

  addOrUpdateContact: (contact) => {
    upsertMany(CONTACTS_TABLE, [contact], mapContactRow).catch(() => {});
    set((state) => {
      const index = state.contacts.findIndex((c) => c.id === contact.id);
      if (index >= 0) {
        const newContacts = [...state.contacts];
        newContacts[index] = { ...newContacts[index], ...contact };
        return { contacts: newContacts };
      }
      return { contacts: [contact, ...state.contacts] };
    });
  },

  getContactById: async (id) => {
    if (!id) return null;
    const fromWindow = get().contacts.find((c) => c.id === id);
    if (fromWindow) return fromWindow;
    return getById<Contact>(CONTACTS_TABLE, id);
  },
}));
