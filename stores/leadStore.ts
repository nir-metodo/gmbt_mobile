import { create } from 'zustand';
import type { Lead } from '../types';
import { leadsApi } from '../services/api/leads';
import { appCache } from '../services/cache';

interface LeadState {
  leads: Lead[];
  isLoading: boolean;
  searchQuery: string;
  selectedStage: string | null;
  viewMode: 'list' | 'pipeline';
  selectedLead: Lead | null;

  loadLeads: (organization: string) => Promise<void>;
  createLead: (organization: string, lead: Partial<Lead>) => Promise<void>;
  updateLead: (organization: string, lead: Partial<Lead>) => Promise<void>;
  deleteLead: (organization: string, leadId: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setSelectedStage: (stage: string | null) => void;
  setViewMode: (mode: 'list' | 'pipeline') => void;
  setSelectedLead: (lead: Lead | null) => void;

  getFilteredLeads: () => Lead[];
  getLeadsByStage: () => Map<string, Lead[]>;
}

export const useLeadStore = create<LeadState>((set, get) => ({
  leads: [],
  isLoading: false,
  searchQuery: '',
  selectedStage: null,
  viewMode: 'list',
  selectedLead: null,

  loadLeads: async (organization) => {
    const cacheKey = `leads_${organization}`;
    const cached = appCache.get<Lead[]>(cacheKey);
    if (cached && get().leads.length === 0) {
      set({ leads: cached, isLoading: false });
    } else {
      set({ isLoading: true });
    }
    try {
      const result = await leadsApi.getAll(organization, { pageSize: 5000 });
      const arr = Array.isArray(result?.data) ? result.data : (Array.isArray(result) ? result : []);
      appCache.set(cacheKey, arr);
      set({ leads: arr, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  createLead: async (organization, lead) => {
    try {
      const result = await leadsApi.create(organization, lead);
      if (result) {
        set((state) => ({ leads: [result, ...state.leads] }));
      }
    } catch (err) {
      throw err;
    }
  },

  updateLead: async (organization, lead) => {
    try {
      await leadsApi.update(organization, lead);
      set((state) => ({
        leads: state.leads.map((l) =>
          l.id === lead.id ? { ...l, ...lead } : l
        ),
      }));
    } catch (err) {
      throw err;
    }
  },

  deleteLead: async (organization, leadId) => {
    try {
      await leadsApi.delete(organization, leadId);
      set((state) => ({
        leads: state.leads.filter((l) => l.id !== leadId),
      }));
    } catch (err) {
      throw err;
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedStage: (stage) => set({ selectedStage: stage }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setSelectedLead: (lead) => set({ selectedLead: lead }),

  getFilteredLeads: () => {
    const { leads, searchQuery, selectedStage } = get();
    let filtered = Array.isArray(leads) ? leads : [];
    if (selectedStage) {
      filtered = filtered.filter((l) => (l.stageName || l.stage) === selectedStage);
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (l) =>
          l.title?.toLowerCase().includes(query) ||
          l.contactName?.toLowerCase().includes(query) ||
          l.phoneNumber?.includes(query) ||
          l.email?.toLowerCase().includes(query)
      );
    }
    return filtered;
  },

  getLeadsByStage: () => {
    const { leads } = get();
    const grouped = new Map<string, Lead[]>();
    const list = Array.isArray(leads) ? leads : [];
    list.forEach((lead) => {
      const stage = lead.stageName || lead.stage || 'New';
      if (!grouped.has(stage)) grouped.set(stage, []);
      grouped.get(stage)!.push(lead);
    });
    return grouped;
  },
}));
