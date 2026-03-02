export interface User {
  fullname: string;
  email: string;
  photoURL: string | null;
  userId: string;
  organization: string;
  wabaNumber: string | null;
  timeZone: string | null;
  phoneNumber: string | null;
  uID: string | null;
  Email: string;
  PhoneNumber: string | null;
  authToken: string;
  refreshToken: string | null;
  SecurityRole: 'Admin' | 'Chat' | 'Basic' | 'Custom';
  Permissions: Record<string, boolean> | null;
  hasItsOwnSim: boolean;
  planName: string | null;
  language: 'en' | 'he';
  Language: 'en' | 'he';
  DataVisibility?: Record<string, 'all' | 'own'>;
}

export interface Contact {
  id: string;
  name: string;
  phoneNumber: string;
  email?: string;
  keys?: string[] | string;
  ownerId?: string;
  ownerName?: string;
  organization?: string;
  createdOn?: string;
  modifiedOn?: string;
  isRead?: boolean;
  isSpam?: boolean;
  photoURL?: string;
  lastMessage?: string;
  lastMessageTime?: string;
  time?: string;
  from?: string;
  to?: string;
  lastMessageDirection?: string;
  lastConversationStatus?: string;
  lastConversationCategory?: string;
  [key: string]: any;
}

export interface Message {
  id: string;
  messageId: string;
  from: string;
  to: string;
  text?: string;
  body?: string;
  timestamp: string;
  createdOn?: string;
  type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'location' | 'template' | 'internal' | 'media';
  messageType?: string;
  status: 'sent' | 'delivered' | 'read' | 'failed' | 'pending';
  direction: 'Inbound' | 'Outbound' | 'inbound' | 'outbound';
  mediaUrl?: string;
  mediaType?: string;
  fileName?: string;
  isStarred?: boolean;
  quotedMessage?: Message;
  ContextMessageId?: string;
  senderName?: string;
  sentByName?: string;
  createdByName?: string;
  sentFromApp?: boolean;
  templateId?: string;
  templateName?: string;
  templateConfig?: any;
  reactions?: Record<string, string> | MessageReaction[];
  errorMessage?: string;
  isHistoryMediaSuccess?: boolean;
}

export interface MessageReaction {
  emoji: string;
  userId: string;
}

export interface Chat {
  id: string;
  phoneNumber: string;
  contactName: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  isRead?: boolean;
  profilePicture?: string;
  isOnline?: boolean;
  category?: string;
  status?: string;
  lastConversationStatus?: string;
  lastMessageDirection?: string;
  assignedTo?: string;
  ownerId?: string;
  ownerName?: string;
  tags?: string[];
  keys?: string[] | string;
}

export interface Lead {
  id: string;
  title: string;
  contactPhone?: string;
  contactName?: string;
  contactId?: string;
  phoneNumber?: string;
  companyName?: string;
  jobTitle?: string;
  pipelineId?: string;
  stageId?: string;
  stageName?: string;
  stage?: string;
  value?: number;
  currency?: string;
  priority?: 'low' | 'medium' | 'high';
  status?: string;
  source?: string;
  medium?: string;
  notes?: string;
  owner?: string;
  ownerId?: string;
  ownerName?: string;
  description?: string;
  expectedCloseDate?: string;
  nextFollowUp?: string;
  score?: number;
  lostReason?: string;
  tags?: string[];
  relatedContacts?: any[];
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  gclid?: string;
  fbclid?: string;
  referrerUrl?: string;
  organization?: string;
  createdOn?: string;
  modifiedOn?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface LeadStage {
  id: string;
  name: string;
  color: string;
  order: number;
  isWon?: boolean;
  isLost?: boolean;
}

export interface Task {
  id: string;
  taskId?: string;
  title: string;
  description?: string;
  status: 'open' | 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  taskType?: 'phone_call' | 'follow_up' | 'meeting' | 'general' | 'other';
  taskTypeCustom?: string;
  dueDate?: string;
  completedDate?: string;
  createdOn?: string;
  modifiedOn?: string;
  createdById?: string;
  createdByName?: string;
  assignedToId?: string;
  assignedToName?: string;
  modifiedById?: string;
  modifiedByName?: string;
  relatedTo?: {
    type: string;
    entityId: string;
    entityName: string;
    tableName?: string;
  };
  source?: string;
  sourceDetails?: string;
  tags?: string[];
  category?: string;
  reminderEnabled?: boolean;
  reminderDate?: string;
  reminderSent?: boolean;
  reminderTimezone?: string;
  reminderRecipientType?: string;
  reminderRecipientValue?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  assignedTo?: string;
  relatedContactId?: string;
  relatedContactName?: string;
  relatedLeadId?: string;
  relatedLeadName?: string;
  relatedCaseId?: string;
  relatedCaseName?: string;
}

export interface Case {
  id: string;
  subject?: string;
  title?: string;
  description?: string;
  contactPhone?: string;
  contactName?: string;
  contactId?: string;
  assignedTo?: string;
  assignedToName?: string;
  pipelineId?: string;
  stageId?: string;
  stageName?: string;
  status: string;
  category?: string;
  categoryName?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  source?: string;
  ownerId?: string;
  ownerName?: string;
  dueDate?: string;
  notes?: string;
  tags?: string[];
  relatedContacts?: any[];
  organization?: string;
  createdBy?: string;
  createdOn?: string;
  modifiedOn?: string;
  createdAt?: string;
  updatedAt?: string;
  resolvedAt?: string;
}

export interface Quote {
  id: string;
  title: string;
  quoteNumber?: string;
  date?: string;
  validUntil?: string;
  contactId?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  contactCompany?: string;
  phoneNumber?: string;
  leadId?: string;
  leadTitle?: string;
  currency: string;
  items: QuoteItem[];
  discount?: number;
  discountType?: 'percent' | 'fixed';
  tax?: number;
  subtotal?: number;
  discountAmount?: number;
  afterDiscount?: number;
  taxAmount?: number;
  total?: number;
  notes?: string;
  terms?: string;
  status: 'draft' | 'sent' | 'accepted' | 'awaiting_payment' | 'paid' | 'rejected' | 'expired';
  salespersonId?: string;
  salespersonName?: string;
  showSalesperson?: boolean;
  showSignatureLine?: boolean;
  signers?: Array<{ name: string; role: string }>;
  additionalContacts?: Array<{ name: string; phone: string; email: string }>;
  branding?: any;
  createdOn?: string;
  modifiedOn?: string;
  createdAt?: string;
  updatedAt?: string;
  sentAt?: string;
}

export interface QuoteItem {
  id?: string;
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  total: number;
  image?: string;
}

export interface ESignatureSigner {
  signerRole: string;
  signerName: string;
  signerEmail?: string;
  signerPhone?: string;
  status: 'pending' | 'signed';
  signingToken?: string;
  signedAt?: string;
  signatureUrl?: string;
}

export interface ESignatureDocument {
  id: string;
  title: string;
  documentName?: string;
  status: 'pending' | 'partiallySigned' | 'signed' | 'expired' | 'cancelled';
  contactId?: string;
  contactName?: string;
  phoneNumber?: string;
  documentUrl?: string;
  originalFileUrl?: string;
  signedFileUrl?: string;
  signedAt?: string;
  signatureUrl?: string;
  createdAt: string;
  expiresAt?: string;
  token?: string;
  signers?: ESignatureSigner[];
  requiresSequentialSigning?: boolean;
  language?: 'en' | 'he';
  uploadedBy?: string;
  uploadedByName?: string;
}

export interface PhoneCall {
  id: string;
  contactId?: string;
  contactName?: string;
  phoneNumber: string;
  direction: 'inbound' | 'outbound';
  status: 'answered' | 'missed' | 'busy' | 'no_answer' | 'voicemail';
  duration: number;
  startTime: string;
  endTime?: string;
  recordingUrl?: string;
  transcription?: string;
  aiSummary?: string;
  aiActionItems?: string[];
  leadId?: string;
  createdAt: string;
}

export interface CallRule {
  id: string;
  name: string;
  enabled: boolean;
  condition: CallRuleCondition;
  action: CallRuleAction;
}

export interface CallRuleCondition {
  type: 'lead_stage' | 'call_duration' | 'call_status' | 'contact_tag';
  operator: 'equals' | 'greater_than' | 'less_than' | 'contains';
  value: string;
}

export interface CallRuleAction {
  type: 'move_stage' | 'create_task' | 'send_message' | 'update_lead' | 'add_tag';
  params: Record<string, any>;
}

export interface TimelineEvent {
  id: string;
  type: 'message' | 'call' | 'lead_update' | 'task' | 'note' | 'email' | 'stage_change';
  title: string;
  description?: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export interface AppSettings {
  callRecordingEnabled: boolean;
  callRules: CallRule[];
  pushNotificationsEnabled: boolean;
  language: 'en' | 'he';
  theme: 'light' | 'dark' | 'system';
}

export interface OrgUser {
  id: string;
  uID?: string;
  userName: string;
  email: string;
  phoneNumber?: string;
  securityRole: 'Admin' | 'Chat' | 'Basic' | 'Custom';
  SecurityRole?: 'Admin' | 'Chat' | 'Basic' | 'Custom';
  permissions?: Record<string, boolean>;
  dataVisibility?: Record<string, 'all' | 'own'>;
  isActive: boolean;
  createdAt?: string;
  profilePicture?: string;
  language?: 'en' | 'he';
  timeZone?: string;
}

export interface MediaFolder {
  id: string;
  name: string;
  color: string;
  scope: 'organization' | 'personal';
  createdBy?: string;
  createdByName?: string;
  createdAt?: string;
  fileCount?: number;
}

export interface MediaFile {
  id: string;
  name: string;
  url: string;
  type: 'image' | 'video' | 'audio' | 'document';
  mimeType?: string;
  size?: number;
  folderId?: string;
  folderName?: string;
  uploadedBy?: string;
  uploadedByName?: string;
  createdAt?: string;
  thumbnailUrl?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface Template {
  id: string;
  templateId?: string;
  name: string;
  category: string;
  language: string;
  status: string;
  components: any[];
  modifiedOn?: string;
}

export interface QuickMessage {
  id: string;
  title: string;
  message: string;
  shortcut?: string;
}

export interface PipelineSettings {
  id: string;
  name: string;
  stages: LeadStage[];
}

export interface CaseSettings {
  pipelines: Array<{ stages: LeadStage[] }>;
  caseStatuses: Array<{ id: string; name: string; color: string; isDefault?: boolean; order: number }>;
  categories: Array<{ id: string; name: string; color: string; order: number }>;
  sla?: { enabled: boolean; responseTime: number; resolutionTime: number };
}
