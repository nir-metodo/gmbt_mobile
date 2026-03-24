import { useState, useCallback, useRef } from 'react';
import { contactsApi } from '../services/api/contacts';
import type { Contact } from '../types';

export interface ContactLookupState {
  contactSearch: string;
  contactResults: Contact[];
  contactSearching: boolean;
  selectedContact: Contact | null;
  handleContactSearch: (text: string, org: string) => void;
  handleSelectContact: (contact: Contact) => void;
  resetContactLookup: () => void;
}

export function useContactLookup(): ContactLookupState {
  const [contactSearch, setContactSearch] = useState('');
  const [contactResults, setContactResults] = useState<Contact[]>([]);
  const [contactSearching, setContactSearching] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleContactSearch = useCallback((text: string, org: string) => {
    setContactSearch(text);
    setSelectedContact(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!text.trim() || text.length < 2) { setContactResults([]); return; }
    setContactSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await contactsApi.search(org, text, 20);
        setContactResults(results);
      } catch { setContactResults([]); }
      finally { setContactSearching(false); }
    }, 350);
  }, []);

  const handleSelectContact = useCallback((contact: Contact) => {
    setSelectedContact(contact);
    setContactSearch('');
    setContactResults([]);
  }, []);

  const resetContactLookup = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setContactSearch('');
    setContactResults([]);
    setContactSearching(false);
    setSelectedContact(null);
  }, []);

  return {
    contactSearch,
    contactResults,
    contactSearching,
    selectedContact,
    handleContactSearch,
    handleSelectContact,
    resetContactLookup,
  };
}
