import { create } from 'zustand';
import type { Contact } from '../types';
import { contactsApi } from '../services/api/contacts';
import {
  queryPage,
  searchFts,
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

// Contacts are now backed by SQLite (see services/db). The store holds only the current visible
// window (or search results), never the whole table - so a list of 50k contacts opens instantly
// from disk, scrolls with constant memory, and searches via FTS across the entire dataset.

const PAGE_SIZE = 50;
const SEARCH_LIMIT = 100;

export type ContactSort = 'name' | 'createdOn' | 'modifiedOn' | '';
export type ContactMode = 'all' | 'myContacts' | 'recent';

interface ContactFilters {
  tag: string | null;
  ownerName: string;
  status: string;
  mode: ContactMode;
  sortBy: ContactSort;
}

interface Facets {
  tags: string[];
  owners: string[];
  statuses: string[];
}

interface ContactState {
  contacts: Contact[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  searchQuery: string;
  selectedContact: Contact | null;
  filters: ContactFilters;
  facets: Facets;

  organization: string;
  scopeOwnerId: string;
  currentUserId: string;

  loadContacts: (organization: string, userId?: string, dataVisibility?: string) => Promise<void>;
  loadMore: () => Promise<void>;
  reloadWindow: () => Promise<void>;
  refreshFacets: () => Promise<void>;
  setSearchQuery: (query: string) => void;
  setSelectedContact: (contact: Contact | null) => void;
  setFilters: (partial: Partial<ContactFilters>) => void;
  createContact: (organization: string, contact: Partial<Contact>, userId?: string, userName?: string) => Promise<Contact>;
  updateContact: (organization: string, contact: Partial<Contact>, userId?: string, userName?: string) => Promise<void>;
  deleteContact: (organization: string, contactId: string) => Promise<void>;
  addOrUpdateContact: (contact: Contact) => void;
  getContactById: (id: string) => Promise<Contact | null>;
}

const DEFAULT_FILTERS: ContactFilters = {
  tag: null,
  ownerName: '',
  status: '',
  mode: 'all',
  sortBy: '',
};

function buildQuery(state: ContactState): {
  where: string;
  params: (string | number | null)[];
  orderBy: string;
} {
  const where: string[] = ['organization = ?'];
  const params: (string | number | null)[] = [state.organization];

  if (state.scopeOwnerId) {
    where.push('ownerId = ?');
    params.push(state.scopeOwnerId);
  }
  const f = state.filters;
  if (f.mode === 'myContacts' && state.currentUserId) {
    where.push('ownerId = ?');
    params.push(state.currentUserId);
  }
  if (f.tag) {
    where.push('keysText LIKE ?');
    params.push(`%#${f.tag}#%`);
  }
  if (f.ownerName) {
    where.push('ownerName = ?');
    params.push(f.ownerName);
  }
  if (f.status) {
    where.push('LOWER(status) = ?');
    params.push(f.status.toLowerCase());
  }

  let orderBy = 'modifiedOn DESC';
  if (f.sortBy === 'name') orderBy = 'name COLLATE NOCASE ASC';
  else if (f.sortBy === 'createdOn') orderBy = 'createdOn DESC';
  else if (f.sortBy === 'modifiedOn' || f.mode === 'recent') orderBy = 'modifiedOn DESC';

  return { where: where.join(' AND '), params, orderBy };
}

async function fetchWindow(
  state: ContactState,
  limit: number,
  offset: number,
): Promise<Contact[]> {
  const { where, params, orderBy } = buildQuery(state);
  if (state.searchQuery.trim()) {
    // FTS ranks by relevance; pagination/offset isn't meaningful, so we cap at SEARCH_LIMIT.
    return searchFts<Contact>(CONTACTS_TABLE, state.searchQuery, { where, params, limit });
  }
  return queryPage<Contact>(CONTACTS_TABLE, { where, params, orderBy, limit, offset });
}

export const useContactStore = create<ContactState>((set, get) => ({
  contacts: [],
  isLoading: false,
  isLoadingMore: false,
  hasMore: false,
  searchQuery: '',
  selectedContact: null,
  filters: { ...DEFAULT_FILTERS },
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

  reloadWindow: async () => {
    const state = get();
    const isSearch = state.searchQuery.trim().length > 0;
    // Preserve how many rows the user has already scrolled through on a background refresh.
    const limit = isSearch ? SEARCH_LIMIT : Math.max(PAGE_SIZE, state.contacts.length);
    try {
      const rows = await fetchWindow(state, limit, 0);
      set({
        contacts: rows,
        isLoading: false,
        hasMore: !isSearch && rows.length >= limit,
      });
    } catch {
      set({ isLoading: false });
    }
  },

  loadMore: async () => {
    const state = get();
    if (state.searchQuery.trim() || !state.hasMore || state.isLoadingMore) return;
    set({ isLoadingMore: true });
    const offset = state.contacts.length;
    try {
      const rows = await fetchWindow(state, PAGE_SIZE, offset);
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
  },

  setSearchQuery: (query) => {
    if (query === get().searchQuery) return;
    set({ searchQuery: query });
    get().reloadWindow();
  },

  setSelectedContact: (contact) => set({ selectedContact: contact }),

  setFilters: (partial) => {
    set({ filters: { ...get().filters, ...partial } });
    get().reloadWindow();
  },

  createContact: async (organization, contact, userId, userName) => {
    const result = await contactsApi.create(organization, contact, userId, userName);
    const newContact = {
      ...contact,
      ...(result || {}),
      id: result?.id || contact.phoneNumber || contactId(contact),
    } as Contact;
    await upsertMany(CONTACTS_TABLE, [newContact], mapContactRow);
    set((state) => ({ contacts: [newContact, ...state.contacts] }));
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
    set((state) => ({
      contacts: state.contacts.filter((c) => c.id !== id && c.phoneNumber !== id),
    }));
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
