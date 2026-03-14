export const API_BASE_URL = 'https://gambot.azurewebsites.net';
export const WS_BASE_URL = 'wss://gambot.azurewebsites.net/FirebaseWebsocketHandler.ashx';

/** Web app URL - for features that open in browser (Campaigns, Templates, Botomations, etc.) */
export const WEB_APP_BASE_URL = 'https://gambot.co.il';

export const ENDPOINTS = {
  // Auth
  AUTHENTICATE: '/api/Webhooks/authenticate',
  AUTHENTICATE_BY_ORG: '/api/Webhooks/authenticateInfoByOrg',
  REFRESH_TOKEN: '/api/Webhooks/refresh-token',
  FORGOT_PASSWORD: '/api/Webhooks/forgotPassword',
  HEALTH: '/api/Webhooks/health',

  // Contacts
  GET_CONTACTS: '/api/Webhooks/GetAllContactsByOrg',
  SEARCH_CONTACTS: '/api/Webhooks/SearchContacts',
  UPDATE_CONTACT: '/api/Webhooks/UpdateContact',
  DELETE_CONTACT: '/api/Webhooks/DeleteContact',
  UPDATE_CONTACT_OWNER: '/api/Webhooks/UpdateContactOwner',
  IMPORT_CONTACTS: '/api/Webhooks/ImportContacts',

  // Messages / Chats
  GET_MESSAGES: '/api/Webhooks/GetMessagesByPhoneNumber',
  SEARCH_MESSAGES: '/api/Webhooks/SearchMessages',
  GET_STARRED_MESSAGES: '/api/Webhooks/GetStarredMessages',
  CREATE_OUTBOUND_MESSAGE: '/api/Webhooks/CreateOutboundMessage',
  CREATE_MEDIA_MESSAGE: '/api/Webhooks/CreateWabaMediaMessages',
  SCHEDULE_MESSAGE: '/api/Webhooks/ScheduleMessage',
  UPDATE_SCHEDULED_MESSAGE: '/api/Webhooks/UpdateScheduledMessage',
  CANCEL_SCHEDULED_MESSAGE: '/api/Gambot/CancelScheduledMessage',
  MARK_AS_READ: '/api/Webhooks/MarkMessagesAsRead',
  TOGGLE_STARRED: '/api/Webhooks/ToggleStarredMessage',
  CREATE_INTERNAL_MESSAGE: '/api/Webhooks/CreateInternalMessage',
  GET_CONVERSATION_STATUS: '/api/Webhooks/GetConversationStatusDetailed',
  IS_CONVERSATION_LIVE: '/api/Webhooks/IsConversationLiveByPhoneNumber',
  IS_REPLY_LAST_24H: '/api/Webhooks/isRecipientReplyLast24Hours',
  GET_CONVERSATION_EXPIRATION: '/api/Webhooks/GetConversationExpirationTime',
  UPDATE_CONVERSATION_CATEGORY: '/api/Webhooks/updateConversationCategory',
  UPDATE_CONVERSATION_STATUS: '/api/Webhooks/updateConversationStatus',

  // Templates
  GET_TEMPLATES: '/api/Webhooks/GetAllTemplates',
  CREATE_TEMPLATE: '/api/Webhooks/CreateTemplate',
  SEND_TEMPLATE_MESSAGE: '/api/Webhooks/SendTemplateMessage',

  // Leads
  GET_LEADS: '/api/Webhooks/GetLeadsPaginated',
  GET_LEADS_BY_CONTACT: '/api/Webhooks/GetLeadsByContact',
  CREATE_LEAD: '/api/Webhooks/CreateLead',
  UPDATE_LEAD: '/api/Webhooks/UpdateLead',
  DELETE_LEAD: '/api/Webhooks/DeleteLead',
  GET_PIPELINE_SETTINGS: '/api/Webhooks/GetPipelineSettings',
  GET_LEAD_FORM_SETTINGS: '/api/Webhooks/GetLeadFormSettings',

  // Reactions
  SEND_REACTION: '/api/Webhooks/SendReaction',

  // Dynamic columns
  GET_DYNAMIC_COLUMNS: '/api/Webhooks/GetDynamicContactColumns',

  // Contacts pagination
  GET_CONTACTS_PAGINATED: '/api/Webhooks/GetAllContactsByOrg_Pagination_ByModifiedOn',
  DELETE_CONTACT_BY_ID: '/api/Webhooks/DeleteContactById',
  MARK_ALL_CONTACTS_READ: '/api/Webhooks/MarkAllContactsAsRead',

  // Cases
  GET_CASES: '/api/Webhooks/GetCasesPaginated',
  GET_CASE_SETTINGS: '/api/Webhooks/GetCaseSettings',
  CREATE_CASE: '/api/Webhooks/CreateCase',
  UPDATE_CASE: '/api/Webhooks/UpdateCase',
  DELETE_CASE: '/api/Webhooks/DeleteCase',

  // Tasks
  GET_TASKS: '/api/Webhooks/GetAllTasksByOrganization',
  CREATE_TASK: '/api/Webhooks/CreateTask',
  UPDATE_TASK: '/api/Webhooks/UpdateTask',
  DELETE_TASK: '/api/Webhooks/DeleteTask',

  // Quotes
  GET_QUOTES: '/api/Webhooks/GetQuotesPaginated',
  GET_QUOTES_PAGINATED: '/api/Webhooks/GetQuotesPaginated',
  GET_ALL_QUOTES: '/api/Webhooks/GetAllQuotes',
  GET_QUOTE_BY_ID: '/api/Webhooks/GetQuoteById',
  CREATE_QUOTE: '/api/Webhooks/CreateQuote',
  UPDATE_QUOTE: '/api/Webhooks/UpdateQuote',
  DELETE_QUOTE: '/api/Webhooks/DeleteQuote',
  GET_QUOTE_BRANDING: '/api/Webhooks/GetQuoteBranding',

  // E-Signature
  GET_ESIGNATURE_DOC: '/api/Webhooks/ESignature_GetDocumentByToken',
  GET_ESIGNATURE_DOC_BY_ID: '/api/Webhooks/ESignature_GetDocumentById',
  SUBMIT_SIGNATURE: '/api/Webhooks/ESignature_SubmitSignature',
  CREATE_ESIGNATURE_DOC: '/api/Webhooks/ESignature_CreateDocument',
  CREATE_ESIGNATURE_DOC_WITH_FILE: '/api/Webhooks/ESignature_CreateDocumentWithFile',
  GET_ESIGNATURE_DOCS: '/api/Webhooks/ESignature_GetAllDocuments',
  DELETE_ESIGNATURE_DOC: '/api/Webhooks/ESignature_DeleteDocument',
  SEND_ESIGNATURE_REMINDER: '/api/Webhooks/ESignature_SendReminder',

  // Users
  GET_USERS: '/api/Webhooks/GetAllUsersByOrg',
  GET_REGULAR_USERS: '/api/Webhooks/GetAllUsersByOrganizationAsync_RegularUsers',
  CREATE_USER: '/api/Webhooks/CreateUser',
  UPDATE_USER: '/api/Webhooks/UpdateUser',
  DELETE_USER: '/api/Webhooks/DeleteUser',

  // Settings
  GET_SETTINGS: '/api/Webhooks/GetSettings',
  UPDATE_SETTINGS: '/api/Webhooks/UpdateSettings',
  GET_COMPANY_LOGO: '/api/Webhooks/GetCompanyLogo',
  GET_ORG_DISPLAY_NAME: '/api/Webhooks/GetOrgDisplayName',

  // Timeline
  GET_TIMELINE: '/api/Webhooks/GetTimelineByPhoneNumber',
  GET_CHAT_TIMELINE: '/api/Webhooks/GetChatTimeline',
  GET_RELATED_RECORDS: '/api/Webhooks/GetRelatedRecordsByContact',
  ADD_TIMELINE_ENTRY: '/api/Webhooks/AddTimelineEntryForm',
  UPDATE_TIMELINE_ENTRY: '/api/Webhooks/UpdateTimelineEntry',
  DELETE_TIMELINE_ENTRY: '/api/Webhooks/DeleteTimelineEntry',
  GET_LEADS_BY_CONTACT: '/api/Webhooks/GetLeadsByContact',

  // Quick Messages
  GET_QUICK_MESSAGES: '/api/Webhooks/GetQuickMessages',
  GET_SCHEDULED_MESSAGES: '/api/Webhooks/GetScheduledMessages',

  // Dashboard
  GET_DASHBOARD_STATS: '/api/Webhooks/GetDashboardStatistics',
  GET_CONTACT_GROWTH: '/api/Webhooks/GetContactGrowthStatistics',
  GET_LEADS_DASHBOARD: '/api/Webhooks/GetLeadsDashboardStats',
  GET_CONVERSATION_STATS: '/api/Webhooks/GetConversationsDashboardStats',

  // Reports
  GET_SLA_BREACHES: '/api/Webhooks/GetSlaBreaches',
  DISMISS_SLA_BREACHES: '/api/Webhooks/DismissSlaBreaches',
  COMPLETE_TASK: '/api/Webhooks/CompleteTask',

  // Phone Calls
  GET_PHONE_CALLS: '/api/Webhooks/GetAllPhoneCallsPagination',
  GET_APP_PHONE_CALLS: '/api/Webhooks/GetAppPhoneCalls',
  CREATE_APP_PHONE_CALL: '/api/Webhooks/CreateAppPhoneCall',
  GET_CALL_RECORDING: '/api/Webhooks/GetCallRecording',
  GET_CALL_BY_ID: '/api/Webhooks/GetCallById',
  GET_CALL_TIMELINE: '/api/Webhooks/GetTimelineByCallId',
  CREATE_PHONE_CALL: '/api/Webhooks/CreatePhoneCall',
  UPDATE_PHONE_CALL: '/api/Webhooks/UpdatePhoneCall',
  UPDATE_APP_PHONE_CALL: '/api/Webhooks/UpdateAppPhoneCall',
  GENERATE_VOICE_TOKEN: '/api/Webhooks/generateVoiceToken',
  STREAM_OUTBOUND_CALL: '/api/Webhooks/streamOutboundCall',
  OUTBOUND_CALL: '/api/Webhooks/outboundCall',
  LOG_CALL: '/api/Webhooks/LogPhoneCall',
  GET_CALL_LOGS: '/api/Webhooks/GetPhoneCallLogs',
  UPLOAD_RECORDING: '/api/Webhooks/UploadCallRecording',
  TRANSCRIBE_CALL: '/api/Webhooks/TranscribeCall',
  GET_CALL_RULES: '/api/Webhooks/GetCallRules',
  UPDATE_CALL_RULES: '/api/Webhooks/UpdateCallRules',

  // Media Manager
  GET_MEDIA_FOLDERS: '/api/Webhooks/GetMediaFolders',
  GET_MEDIA_FILES: '/api/Webhooks/GetMediaFiles',
  UPLOAD_MEDIA_FILE: '/api/Webhooks/UploadMediaFile',
  CREATE_MEDIA_FOLDER: '/api/Webhooks/CreateMediaFolder',
  UPDATE_MEDIA_FOLDER: '/api/Webhooks/UpdateMediaFolder',
  DELETE_MEDIA_FILE: '/api/Webhooks/DeleteMediaFile',
  DELETE_MEDIA_FOLDER: '/api/Webhooks/DeleteMediaFolder',

  // Internal Messages
  GET_INTERNAL_MESSAGES: '/api/Webhooks/GetAllInternalMessages',
  MARK_MENTION_READ: '/api/Webhooks/MarkMentionAsRead',

  // Push Notifications
  REGISTER_DEVICE: '/api/Webhooks/RegisterDeviceToken',
  UNREGISTER_DEVICE: '/api/Webhooks/UnregisterDeviceToken',

  // Employees / Attendance
  GET_EMPLOYEES_DASHBOARD: '/api/Webhooks/GetEmployeesDashboard',
  GET_ATTENDANCE_RECORDS: '/api/Webhooks/GetAttendanceRecords',
  CLOCK_IN: '/api/Webhooks/ClockIn',
  CLOCK_OUT: '/api/Webhooks/ClockOut',
  GET_MY_CLOCK_STATUS: '/api/Webhooks/GetMyClockStatus',
} as const;
