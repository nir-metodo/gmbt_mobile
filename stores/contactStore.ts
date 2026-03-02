import { create } from 'zustand';
import type { Contact } from '../types';
import { contactsApi } from '../services/api/contacts';

interface ContactState {
  contacts: Contact[];
  isLoading: boolean;
  searchQuery: string;
  selectedContact: Contact | null;
  tagFilter: string[];
  ownerFilter: string[];

  loadContacts: (organization: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setSelectedContact: (contact: Contact | null) => void;
  setTagFilter: (tags: string[]) => void;
  setOwnerFilter: (owners: string[]) => void;
  createContact: (organization: string, contact: Partial<Contact>) => Promise<Contact>;
  updateContact: (organization: string, contact: Partial<Contact>) => Promise<void>;
  deleteContact: (organization: string, contactId: string) => Promise<void>;
  addOrUpdateContact: (contact: Contact) => void;

  getFilteredContacts: () => Contact[];
}

function extractTags(keys: string[] | string | undefined): string[] {
  if (!keys) return [];
  if (Array.isArray(keys)) return keys;
  if (typeof keys === 'string') {
    return keys.split('#').filter((t: string) => t.trim()).map((t: string) => t.trim());
  }
  return [];
}

export const useContactStore = create<ContactState>((set, get) => ({
  contacts: [],
  isLoading: false,
  searchQuery: '',
  selectedContact: null,
  tagFilter: [],
  ownerFilter: [],

  loadContacts: async (organization) => {
    set({ isLoading: true });
    try {
      const contacts = await contactsApi.getAll(organization);
      set({ contacts: Array.isArray(contacts) ? contacts : [], isLoading: false });
    } catch (err) {
      console.log('loadContacts error:', err);
      set({ isLoading: false });
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedContact: (contact) => set({ selectedContact: contact }),
  setTagFilter: (tags) => set({ tagFilter: tags }),
  setOwnerFilter: (owners) => set({ ownerFilter: owners }),

  createContact: async (organization: string, contact: Partial<Contact>) => {
    try {
      const result = await contactsApi.update(organization, contact);
      const newContact = { ...contact, ...(result || {}), id: result?.id || contact.phoneNumber || '' } as Contact;
      set((state) => ({
        contacts: [newContact, ...state.contacts],
      }));
      return newContact;
    } catch (err) {
      console.error('createContact error:', err);
      throw err;
    }
  },

  updateContact: async (organization, contact) => {
    try {
      await contactsApi.update(organization, contact);
      set((state) => {
        const exists = state.contacts.some((c) => c.id === contact.id);
        if (exists) {
          return {
            contacts: state.contacts.map((c) =>
              c.id === contact.id ? { ...c, ...contact } : c
            ),
          };
        }
        return { contacts: [contact as Contact, ...state.contacts] };
      });
    } catch (err) {
      console.error('updateContact error:', err);
      throw err;
    }
  },

  deleteContact: async (organization, contactId) => {
    try {
      await contactsApi.delete(organization, contactId);
      set((state) => ({
        contacts: state.contacts.filter((c) => c.id !== contactId),
      }));
    } catch (err) {
      console.error('deleteContact error:', err);
      throw err;
    }
  },

  addOrUpdateContact: (contact) => {
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

  getFilteredContacts: () => {
    const { contacts, searchQuery, tagFilter, ownerFilter } = get();
    let filtered = contacts;

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.name?.toLowerCase().includes(query) ||
          c.phoneNumber?.includes(query) ||
          c.email?.toLowerCase().includes(query)
      );
    }

    if (tagFilter.length > 0) {
      filtered = filtered.filter((c) => {
        const tags = extractTags(c.keys);
        return tagFilter.some((tf) => tags.includes(tf));
      });
    }

    if (ownerFilter.length > 0) {
      filtered = filtered.filter((c) =>
        ownerFilter.includes(c.ownerId || '')
      );
    }

    return filtered;
  },
}));
