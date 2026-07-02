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
  GET_CONTACT_BY_ID: '/api/Webhooks/GetContactById',
  SEARCH_CONTACTS: '/api/Webhooks/SearchContacts',
  CREATE_CONTACT: '/api/Webhooks/CreateNewContact',
  UPDATE_CONTACT: '/api/Webhooks/UpdateContact',
  UPDATE_CONTACT_BY_ID: '/api/Webhooks/UpdateContactById',
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
  CANCEL_SCHEDULED_MESSAGE: '/api/Webhooks/CancelScheduledMessage',
  MARK_AS_READ: '/api/Webhooks/MarkMessagesAsRead',
  MARK_AS_UNREAD: '/api/Webhooks/MarkMessagesAsUnread',
  TOGGLE_STARRED: '/api/Webhooks/ToggleStarredMessage',
  CREATE_INTERNAL_MESSAGE: '/api/Webhooks/CreateInternalMessage',
  GET_CONVERSATION_STATUS: '/api/Webhooks/GetConversationStatusDetailed',
  IS_CONVERSATION_LIVE: '/api/Webhooks/IsConversationLiveByPhoneNumber',
  IS_REPLY_LAST_24H: '/api/Webhooks/isRecipientReplyLast24Hours',
  GET_CONVERSATION_EXPIRATION: '/api/Webhooks/GetConversationExpirationTime',
  UPDATE_CONVERSATION_CATEGORY: '/api/Webhooks/updateConversationCategory',
  UPDATE_CONVERSATION_STATUS: '/api/Webhooks/updateConversationStatus',
  GET_CONVERSATION_CATEGORIES: '/api/Webhooks/getConversationCategories',
  ADD_CONVERSATION_CATEGORY: '/api/Webhooks/addConversationCategory',
  UPDATE_CONTACT_KEYS: '/api/Webhooks/UpdateContactKeysById',

  // Templates
  GET_TEMPLATES: '/api/Webhooks/GetAllTemplates',
  GET_TEMPLATE_BY_ID: '/api/webhooks/GetTemplateById',
  GET_MEDIA_BY_TEMPLATE_ID: '/api/webhooks/GetMediaByTemplateId',
  GET_DEFAULT_MESSAGE_TEMPLATES: '/api/Webhooks/GetDefaultMessageTemplates',
  CREATE_TEMPLATE: '/api/Webhooks/CreateTemplate',
  SEND_TEMPLATE_MESSAGE: '/api/Webhooks/SendTemplateMessage',

  // Leads
  GET_LEADS: '/api/Webhooks/GetLeadsPaginated',
  GET_LEAD_FILTER_OPTIONS: '/api/Webhooks/GetLeadFilterOptions',
  GET_LEADS_BY_CONTACT: '/api/Webhooks/GetLeadsByContact',
  CREATE_LEAD: '/api/Webhooks/CreateLead',
  UPDATE_LEAD: '/api/Webhooks/UpdateLead',
  MOVE_LEAD_STAGE: '/api/Webhooks/MoveLeadStage',
  DELETE_LEAD: '/api/Webhooks/DeleteLead',
  GET_PIPELINE_SETTINGS: '/api/Webhooks/GetPipelineSettings',
  GET_LEAD_FORM_SETTINGS: '/api/Webhooks/GetLeadFormSettings',
  GET_LEAD_VIEWS: '/api/Webhooks/GetLeadViews',
  SAVE_LEAD_VIEW: '/api/Webhooks/SaveLeadView',
  DELETE_LEAD_VIEW: '/api/Webhooks/DeleteLeadView',
  GET_ORDER_FORM_SETTINGS: '/api/Webhooks/GetOrderFormSettings',

  // Reactions
  SEND_REACTION: '/api/Webhooks/SendReaction',

  // Dynamic columns
  GET_DYNAMIC_COLUMNS: '/api/Webhooks/GetDynamicContactColumns',

  // WhatsApp Numbers
  GET_WHATSAPP_NUMBERS: '/api/Webhooks/GetWhatsAppNumbers',

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
  GET_CASES_BY_CONTACT: '/api/Webhooks/GetCasesByContact',

  // Tasks
  GET_TASKS: '/api/Webhooks/GetAllTasksByOrganization',
  CREATE_TASK: '/api/Webhooks/CreateTask',
  UPDATE_TASK: '/api/Webhooks/UpdateTask',
  DELETE_TASK: '/api/Webhooks/DeleteTask',
  GET_TASK_REMINDER_DEFAULT_SETTING: '/api/Gambot/GetTaskReminderDefaultSetting',
  UPDATE_TASK_REMINDER_DEFAULT_SETTING: '/api/Gambot/UpdateTaskReminderDefaultSetting',

  // Quotes
  GET_QUOTES: '/api/Webhooks/GetQuotesPaginated',
  GET_QUOTES_PAGINATED: '/api/Webhooks/GetQuotesPaginated',
  GET_ALL_QUOTES: '/api/Webhooks/GetAllQuotes',
  GET_QUOTE_BY_ID: '/api/Webhooks/GetQuoteById',
  CREATE_QUOTE: '/api/Webhooks/CreateQuote',
  UPDATE_QUOTE: '/api/Webhooks/UpdateQuote',
  DELETE_QUOTE: '/api/Webhooks/DeleteQuote',

  GET_QUOTE_BRANDING: '/api/Webhooks/GetQuoteBranding',
  SAVE_QUOTE_BRANDING: '/api/Webhooks/SaveQuoteBranding',

  // Public catalog (shareable page + customer selections)
  GET_CATALOG_SELECTIONS: '/api/Webhooks/GetCatalogSelections',

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
  GET_FEATURE_TOGGLES: '/api/Webhooks/GetFeatureToggles',

  // Timeline
  GET_TIMELINE: '/api/Webhooks/GetTimelineByPhoneNumber',
  GET_CHAT_TIMELINE: '/api/Webhooks/GetChatTimeline',
  GET_RELATED_RECORDS: '/api/Webhooks/GetRelatedRecordsByContact',
  ADD_TIMELINE_ENTRY: '/api/Webhooks/AddTimelineEntryForm',
  UPDATE_TIMELINE_ENTRY: '/api/Webhooks/UpdateTimelineEntry',
  DELETE_TIMELINE_ENTRY: '/api/Webhooks/DeleteTimelineEntry',
  TOGGLE_TIMELINE_ENTRY_PIN: '/api/Webhooks/ToggleTimelineEntryPin',
  GET_LEADS_BY_CONTACT: '/api/Webhooks/GetLeadsByContact',
  GET_CROSS_ENTITY_NOTES_SETTING: '/api/Webhooks/GetCrossEntityNotesSetting',
  GET_ALL_NOTES_FOR_ORGANIZATION: '/api/Webhooks/GetAllNotesForOrganization',

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
  GET_TASK_ACTIVITY: '/api/Webhooks/GetTaskActivity',
  ADD_TASK_COMMENT: '/api/Webhooks/AddTaskComment',
  GET_TASK_BY_ID: '/api/Webhooks/GetTaskById',
  GET_DAILY_CONVERSATION_REPORT: '/api/Webhooks/GetDailyConversationReport',
  GET_DAILY_BOT_SUMMARY: '/api/Webhooks/GetDailyBotSummary',
  GET_TEMPLATE_ANALYTICS: '/api/Webhooks/GetTemplateAnalytics',

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
  TELNYX_OUTBOUND_CALL: '/api/webhooks/telnyx/streamOutboundCall',
  GET_TELEPHONY_SETTINGS: '/api/Webhooks/GetTelephonySettings',
  INITIATE_OUTBOUND_CALL: '/api/Webhooks/InitiateOutboundCall',
  GET_CALL_RECORDINGS: '/api/Webhooks/GetCallRecordings',
  GET_RECORDING_SETTINGS: '/api/Webhooks/GetRecordingSettings',
  UPDATE_RECORDING_SETTINGS: '/api/Webhooks/UpdateRecordingSettings',
  REPORT_DEVICE_CALL_EVENT: '/api/Webhooks/ReportDeviceCallEvent',
  SET_DEVICE_CALL_REPORTING: '/api/Webhooks/SetDeviceCallReporting',

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
  GET_INTERNAL_MESSAGES_HUB: '/api/Webhooks/GetInternalMessagesHub',
  MARK_MENTION_READ: '/api/Webhooks/MarkMentionAsRead',

  // Lead Seen/Unseen tracking
  GET_LEAD_SEEN_IDS: '/api/Webhooks/GetLeadSeenIds',
  MARK_LEAD_SEEN: '/api/Webhooks/MarkLeadSeen',
  CLEAR_LEAD_SEEN_IDS: '/api/Webhooks/ClearLeadSeenIds',

  // Saved Views
  GET_USER_VIEWS: '/api/Webhooks/GetUserViews',
  SAVE_USER_VIEW: '/api/Webhooks/SaveUserView',
  DELETE_USER_VIEW: '/api/Webhooks/DeleteUserView',
  PIN_USER_VIEW: '/api/Webhooks/PinUserView',

  // Contact Groups (Keys)
  GET_ALL_KEYS: '/api/Webhooks/GetAllKeys',

  // Push Notifications
  REGISTER_DEVICE: '/api/Webhooks/RegisterDeviceToken',
  UNREGISTER_DEVICE: '/api/Webhooks/UnregisterDeviceToken',
  REGISTER_PUSH_TOKEN: '/api/Webhooks/RegisterPushToken',
  UNREGISTER_PUSH_TOKEN: '/api/Webhooks/UnregisterPushToken',
  UPDATE_PUSH_SETTINGS: '/api/Webhooks/UpdatePushNotificationSettings',
  GET_PUSH_SETTINGS: '/api/Webhooks/GetPushNotificationSettings',

  // Employees / Attendance
  GET_EMPLOYEES_DASHBOARD: '/api/Webhooks/GetEmployeesDashboard',
  GET_ATTENDANCE_RECORDS: '/api/Webhooks/GetAttendanceRecords',
  CLOCK_IN: '/api/Webhooks/ClockIn',
  CLOCK_OUT: '/api/Webhooks/ClockOut',

  // Orders
  GET_ORDERS: '/api/Orders/GetOrders',
  GET_ORDERS_SETTINGS: '/api/Orders/GetOrdersSettings',
  GET_ORDER: '/api/Orders/GetOrder',
  CREATE_ORDER: '/api/Orders/CreateOrder',
  UPDATE_ORDER: '/api/Orders/UpdateOrder',
  UPDATE_ORDER_STATUS: '/api/Orders/UpdateOrderStatus',
  DELETE_ORDER: '/api/Orders/DeleteOrder',
  ADD_ORDER_NOTE: '/api/Orders/AddOrderNote',

  // Inventory
  GET_INVENTORY: '/api/Inventory/GetInventory',
  GET_INVENTORY_ITEM: '/api/Inventory/GetInventoryItem',
  SAVE_INVENTORY_ITEM: '/api/Inventory/SaveInventoryItem',
  ADJUST_STOCK: '/api/Inventory/AdjustStock',
  GET_INVENTORY_MOVEMENTS: '/api/Inventory/GetMovements',
  ADD_INVENTORY_ACTIVITY: '/api/Inventory/AddInventoryActivity',

  // Purchase Orders
  GET_PURCHASE_ORDERS: '/api/PurchaseOrders/GetPurchaseOrders',
  GET_PURCHASE_ORDER: '/api/PurchaseOrders/GetPurchaseOrder',
  CREATE_PURCHASE_ORDER: '/api/PurchaseOrders/CreatePurchaseOrder',
  UPDATE_PURCHASE_ORDER: '/api/PurchaseOrders/UpdatePurchaseOrder',
  DELETE_PURCHASE_ORDER: '/api/PurchaseOrders/DeletePurchaseOrder',

  // Suppliers
  GET_SUPPLIERS: '/api/Suppliers/GetSuppliers',
  CREATE_SUPPLIER: '/api/Suppliers/CreateSupplier',
  UPDATE_SUPPLIER: '/api/Suppliers/UpdateSupplier',
  DELETE_SUPPLIER: '/api/Suppliers/DeleteSupplier',

  // Payments / Clearing
  GET_CLEARING_SETTINGS: '/api/Webhooks/GetClearingSettings',
  CREATE_PAYMENT_LINK: '/api/Webhooks/CreatePaymentLink',
  CREATE_MANUAL_CHARGE: '/api/Webhooks/CreateManualCharge',
  GET_PAYMENT_TRANSACTIONS: '/api/Webhooks/GetPaymentTransactions',
  MARK_TRANSACTION_PAID: '/api/Webhooks/MarkTransactionPaid',

  // Invoices
  GET_INVOICES_PAGINATED: '/api/Webhooks/GetInvoicesPaginated',
  GET_INVOICE_BY_ID: '/api/Webhooks/GetInvoiceById',
  CREATE_INVOICE: '/api/Webhooks/CreateInvoice',
  UPDATE_INVOICE: '/api/Webhooks/UpdateInvoice',
  DELETE_INVOICE: '/api/Webhooks/DeleteInvoiceDraft',
  GET_INVOICE_BRANDING: '/api/Webhooks/GetInvoiceBranding',

  // Calendar Events
  GET_CALENDAR_EVENTS: '/api/Webhooks/GetCalendarEvents',
  CREATE_CALENDAR_EVENT: '/api/Webhooks/CreateCalendarEvent',
  UPDATE_CALENDAR_EVENT: '/api/Webhooks/UpdateCalendarEvent',
  DELETE_CALENDAR_EVENT: '/api/Webhooks/DeleteCalendarEvent',
  GET_CALENDARS: '/api/Webhooks/GetCalendars',
  GET_CONNECTIONS: '/api/Webhooks/GetConnections',

  // Email
  SEND_EMAIL: '/api/Webhooks/contact-form/send-email',
  GET_EMAIL_TEMPLATES: '/api/Webhooks/email-templates',
} as const;
