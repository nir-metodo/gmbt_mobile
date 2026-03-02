import { create } from 'zustand';
import type { Lead } from '../types';
import { leadsApi } from '../services/api/leads';

interface LeadState {
  leads: Lead[];
  isLoading: boolean;
  searchQuery: string;
  selectedStage: string | null;
  viewMode: 'list' | 'pipeline';

  loadLeads: (organization: string) => Promise<void>;
  createLead: (organization: string, lead: Partial<Lead>) => Promise<void>;
  updateLead: (organization: string, lead: Partial<Lead>) => Promise<void>;
  deleteLead: (organization: string, leadId: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setSelectedStage: (stage: string | null) => void;
  setViewMode: (mode: 'list' | 'pipeline') => void;

  getFilteredLeads: () => Lead[];
  getLeadsByStage: () => Map<string, Lead[]>;
}

export const useLeadStore = create<LeadState>((set, get) => ({
  leads: [],
  isLoading: false,
  searchQuery: '',
  selectedStage: null,
  viewMode: 'list',

  loadLeads: async (organization) => {
    set({ isLoading: true });
    try {
      const result = await leadsApi.getAll(organization);
      const arr = Array.isArray(result?.data) ? result.data : (Array.isArray(result) ? result : []);
      set({ leads: arr, isLoading: false });
    } catch (err) {
      console.log('loadLeads error:', err);
      set({ leads: [], isLoading: false });
    }
  },

  createLead: async (organization, lead) => {
    try {
      const result = await leadsApi.create(organization, lead);
      if (result) {
        set((state) => ({ leads: [result, ...state.leads] }));
      }
    } catch (err) {
      console.error('createLead error:', err);
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
      console.error('updateLead error:', err);
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
      console.error('deleteLead error:', err);
      throw err;
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedStage: (stage) => set({ selectedStage: stage }),
  setViewMode: (mode) => set({ viewMode: mode }),

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
