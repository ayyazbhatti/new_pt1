import { create } from 'zustand'
import type { Lead, LeadActivity } from '../types/leads'

interface LeadsState {
  leads: Lead[]
  activities: LeadActivity[]
  setLeads: (leads: Lead[]) => void
  setActivities: (activities: LeadActivity[]) => void
  addLead: (lead: Lead) => void
  updateLead: (id: string, patch: Partial<Lead>) => void
  removeLead: (id: string) => void
  addActivity: (activity: LeadActivity) => void
  getActivitiesByLeadId: (leadId: string) => LeadActivity[]
}

const DEMO_LEADS: Lead[] = [
  {
    id: '1',
    name: 'John Smith',
    email: 'john.smith@example.com',
    phone: '+1 555 0100',
    company: 'Acme Corp',
    source: 'website',
    status: 'new',
    ownerId: undefined,
    ownerName: undefined,
    score: 45,
    createdAt: '2026-03-08T10:00:00Z',
    updatedAt: '2026-03-08T10:00:00Z',
  },
  {
    id: '2',
    name: 'Jane Doe',
    email: 'jane.doe@example.com',
    source: 'referral',
    status: 'contacted',
    ownerName: 'Support Agent',
    score: 72,
    createdAt: '2026-03-07T14:30:00Z',
    updatedAt: '2026-03-09T09:15:00Z',
    lastActivityAt: '2026-03-09T09:15:00Z',
  },
  {
    id: '3',
    name: 'Bob Wilson',
    email: 'bob@trading.io',
    company: 'Trading IO',
    source: 'demo_request',
    campaign: 'Q1 2026',
    status: 'qualified',
    ownerName: 'Sales',
    score: 88,
    createdAt: '2026-03-05T08:00:00Z',
    updatedAt: '2026-03-09T11:00:00Z',
    lastActivityAt: '2026-03-09T11:00:00Z',
  },
]

const DEMO_ACTIVITIES: LeadActivity[] = [
  { id: 'a1', leadId: '2', type: 'call', content: 'Initial call - interested in funded program.', createdAt: '2026-03-09T09:15:00Z', createdBy: 'Support Agent' },
  { id: 'a2', leadId: '2', type: 'status_change', content: 'Status changed to Contacted', createdAt: '2026-03-09T09:15:00Z', createdBy: 'Support Agent' },
  { id: 'a3', leadId: '3', type: 'note', content: 'Requested proposal for $50K challenge.', createdAt: '2026-03-09T11:00:00Z', createdBy: 'Sales' },
]

export const useLeadsStore = create<LeadsState>((set, get) => ({
  leads: DEMO_LEADS,
  activities: DEMO_ACTIVITIES,

  setLeads: (leads) => set({ leads }),
  setActivities: (activities) => set({ activities }),

  addLead: (lead) => set((state) => ({ leads: [...state.leads, lead] })),

  updateLead: (id, patch) =>
    set((state) => ({
      leads: state.leads.map((l) => (l.id === id ? { ...l, ...patch, updatedAt: new Date().toISOString() } : l)),
    })),

  removeLead: (id) =>
    set((state) => ({
      leads: state.leads.filter((l) => l.id !== id),
      activities: state.activities.filter((a) => a.leadId !== id),
    })),

  addActivity: (activity) =>
    set((state) => ({
      activities: [activity, ...state.activities],
      leads: state.leads.map((l) =>
        l.id === activity.leadId ? { ...l, lastActivityAt: activity.createdAt, updatedAt: activity.createdAt } : l
      ),
    })),

  getActivitiesByLeadId: (leadId) => get().activities.filter((a) => a.leadId === leadId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
}))
