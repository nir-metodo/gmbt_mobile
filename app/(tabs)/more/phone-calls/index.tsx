import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  Linking,
  LayoutAnimation,
  Platform,
  UIManager,
  RefreshControl,
  Pressable,
  ScrollView,
  Alert,
} from 'react-native';
import type { MD3Theme } from 'react-native-paper';
import {
  Appbar,
  Surface,
  Text,
  Chip,
  Card,
  IconButton,
  Button,
  FAB,
  Portal,
  Modal,
  TextInput,
  Switch,
  SegmentedButtons,
  Divider,
  ActivityIndicator,
  Menu,
  Searchbar,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { phoneCallsApi } from '../../../../services/api/phoneCalls';
import { usersApi } from '../../../../services/api/users';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { useDebouncedValue, useWindowedList } from '../../../../hooks/useWindowedList';
import { ListPaginationFooter } from '../../../../components/ListPaginationFooter';
import { useAuthStore } from '../../../../stores/authStore';
import { useSettingsStore } from '../../../../stores/settingsStore';
import { useActiveCallStore } from '../../../../stores/activeCallStore';
import { makeAppCall, makeGambotCall, placeSmartCall, tryInAppSipCall } from '../../../../utils/phoneCall';
import { sipPhone } from '../../../../services/sip/sipPhone';
import CallDetailPanel from '../../../../components/phone-calls/CallDetailPanel';
import { useMissedCallsStore } from '../../../../stores/missedCallsStore';
import { getDataVisibility } from '../../../../constants/permissions';
import { PhoneCall, CallRule } from '../../../../types';
import {
  formatDate,
  formatDuration,
  formatPhoneNumber,
} from '../../../../utils/formatters';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const BRAND_COLOR = '#2e6155';

type TabKey = 'history' | 'rules';
type FilterKey = 'all' | 'answered' | 'missed';
type CallsScopeKey = 'my' | 'all';
type DateRangeKey = 'all' | 'today' | 'yesterday' | '7d' | 'month';
const DATE_RANGE_KEYS: DateRangeKey[] = ['all', 'today', 'yesterday', '7d', 'month'];

/** Local-day boundaries of a preset range (the phone's own time zone). */
function rangeBounds(key: DateRangeKey): { from?: Date; to?: Date } {
  if (key === 'all') return {};
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = startOf(new Date());
  const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  if (key === 'today') return { from: today, to: addDays(today, 1) };
  if (key === 'yesterday') return { from: addDays(today, -1), to: today };
  if (key === '7d') return { from: addDays(today, -6), to: addDays(today, 1) };
  return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: addDays(today, 1) };
}
type ConditionType = 'lead_stage' | 'call_duration' | 'call_status';
type Operator = 'equals' | 'greater_than' | 'less_than';
type ActionType = 'move_stage' | 'create_task' | 'send_message' | 'update_lead';

const CONDITION_TYPES: { value: ConditionType; labelKey: string }[] = [
  { value: 'lead_stage', labelKey: 'phoneCalls.conditionLeadStage' },
  { value: 'call_duration', labelKey: 'phoneCalls.conditionCallDuration' },
  { value: 'call_status', labelKey: 'phoneCalls.conditionCallStatus' },
];

const OPERATORS: { value: Operator; labelKey: string }[] = [
  { value: 'equals', labelKey: 'phoneCalls.operatorEquals' },
  { value: 'greater_than', labelKey: 'phoneCalls.operatorGreaterThan' },
  { value: 'less_than', labelKey: 'phoneCalls.operatorLessThan' },
];

const ACTION_TYPES: { value: ActionType; labelKey: string }[] = [
  { value: 'move_stage', labelKey: 'phoneCalls.actionMoveStage' },
  { value: 'create_task', labelKey: 'phoneCalls.actionCreateTask' },
  { value: 'send_message', labelKey: 'phoneCalls.actionSendMessage' },
  { value: 'update_lead', labelKey: 'phoneCalls.actionUpdateLead' },
];

const EMPTY_RULE: Omit<CallRule, 'id'> = {
  name: '',
  condition: { type: 'call_status', operator: 'equals', value: '' },
  action: { type: 'move_stage', params: {} },
  enabled: true,
};

// Stored call times are UTC ISO strings (sometimes without the "Z") - parse them as UTC so they show in the phone's local time.
function callDate(iso?: string): Date | null {
  if (!iso) return null;
  const s = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function callTime(iso?: string): number {
  return callDate(iso)?.getTime() ?? 0;
}
function formatCallWhen(iso?: string): string {
  const d = callDate(iso);
  return d ? formatDate(d.toISOString(), 'dd/MM/yyyy HH:mm') : '';
}

function getDirectionIcon(direction: string, status: string) {
  if (status === 'missed') return { name: 'phone-missed' as const, color: '#E63946' };
  if (direction === 'inbound') return { name: 'phone-incoming' as const, color: '#2A9D8F' };
  return { name: 'phone-outgoing' as const, color: BRAND_COLOR };
}

interface CallItemProps {
  call: PhoneCall;
  expanded: boolean;
  onPress: () => void;
  isRTL: boolean;
  t: (key: string) => string;
  themeColors: MD3Theme['colors'];
  onQuickAction: (action: string, call: PhoneCall) => void;
  onDial: (phone: string) => void;
  org: string;
}

function CallHistoryItem({ call, expanded, onPress, isRTL, t, themeColors, onQuickAction, onDial, org }: CallItemProps) {
  const dirIcon = getDirectionIcon(call.direction, call.status);
  return (
    <Surface style={[itemStyles.card, { backgroundColor: themeColors.surface }]} elevation={1}>
      <Pressable onPress={onPress} style={[itemStyles.row, { flexDirection: 'row' }]}>
        <View style={[itemStyles.iconWrap, { backgroundColor: dirIcon.color + '15' }]}>
          <MaterialCommunityIcons name={dirIcon.name} size={22} color={dirIcon.color} />
        </View>

        <View style={[itemStyles.info, { alignItems: 'flex-start' }]}>
          <Text
            variant="titleSmall"
            style={{ color: call.status === 'missed' ? '#E63946' : themeColors.onSurface, fontWeight: '700' }}
            numberOfLines={1}
          >
            {call.contactName || formatPhoneNumber(call.phoneNumber) || t('phoneCalls.unknownNumber')}
          </Text>
          {/* digits only → always left-to-right so numbers and times never come out reversed */}
          <Text variant="bodySmall" style={[itemStyles.meta, { color: themeColors.onSurfaceVariant }]} numberOfLines={1}>
            {call.contactName ? `${formatPhoneNumber(call.phoneNumber)}  ·  ` : ''}{formatCallWhen(call.createdAt)}
          </Text>
        </View>

        <View style={[itemStyles.badges, { flexDirection: 'row' }]}>
          {call.duration > 0 ? (
            <View style={[itemStyles.durPill, { backgroundColor: themeColors.surfaceVariant }]}>
              <MaterialCommunityIcons name="timer-outline" size={12} color={themeColors.onSurfaceVariant} />
              <Text style={[itemStyles.durText, { color: themeColors.onSurfaceVariant }]}>{formatDuration(call.duration)}</Text>
            </View>
          ) : null}
          {call.recordingUrl ? <MaterialCommunityIcons name="microphone" size={15} color="#FF6B35" /> : null}
          {call.transcription ? <MaterialCommunityIcons name="brain" size={15} color="#7B2D8E" /> : null}
        </View>

        <Pressable
          onPress={() => onDial(call.phoneNumber)}
          hitSlop={8}
          style={[itemStyles.dialBtn, { backgroundColor: BRAND_COLOR + '18' }]}
        >
          <MaterialCommunityIcons name="phone" size={17} color={BRAND_COLOR} />
        </Pressable>
      </Pressable>

      {expanded && (
        <View style={itemStyles.detail}>
          <Divider style={{ marginBottom: 12 }} />

          <View style={[itemStyles.detailRow, { flexDirection: 'row' }]}>
            <Text variant="labelMedium" style={{ color: themeColors.onSurfaceVariant }}>
              {t('phoneCalls.status')}:
            </Text>
            <Chip
              compact
              mode="flat"
              style={{ marginHorizontal: 8, backgroundColor: call.status === 'answered' ? '#2A9D8F20' : '#E6394620' }}
              textStyle={{ fontSize: 11, color: call.status === 'answered' ? '#2A9D8F' : '#E63946' }}
            >
              {t(`phoneCalls.${call.status}`)}
            </Chip>
          </View>

          {call.duration > 0 && (
            <View style={[itemStyles.detailRow, { flexDirection: 'row' }]}>
              <Text variant="labelMedium" style={{ color: themeColors.onSurfaceVariant }}>
                {t('phoneCalls.duration')}:
              </Text>
              <Text variant="bodyMedium" style={{ marginHorizontal: 8, color: themeColors.onSurface }}>
                {formatDuration(call.duration)}
              </Text>
            </View>
          )}
          {call.agentName && !/^gambot$/i.test(call.agentName) ? (
            <View style={[itemStyles.detailRow, { flexDirection: 'row' }]}>
              <Text variant="labelMedium" style={{ color: themeColors.onSurfaceVariant }}>
                {t('phoneCalls.agent')}:
              </Text>
              <Text variant="bodyMedium" style={{ marginHorizontal: 8, color: themeColors.onSurface }}>
                {call.agentName}
              </Text>
            </View>
          ) : null}

          <CallDetailPanel call={call} org={org} isRTL={isRTL} t={t as any} themeColors={themeColors} />

          <Divider style={{ marginVertical: 8 }} />

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[itemStyles.quickActions, { flexDirection: 'row' }]}
          >
            <Button
              icon="account-edit"
              mode="contained-tonal"
              compact
              style={itemStyles.quickBtn}
              labelStyle={itemStyles.quickBtnLabel}
              onPress={() => onQuickAction('updateLead', call)}
            >
              {t('phoneCalls.updateLead')}
            </Button>
            <Button
              icon="swap-horizontal"
              mode="contained-tonal"
              compact
              style={itemStyles.quickBtn}
              labelStyle={itemStyles.quickBtnLabel}
              onPress={() => onQuickAction('moveStage', call)}
            >
              {t('phoneCalls.moveStage')}
            </Button>
          </ScrollView>
        </View>
      )}
    </Surface>
  );
}

const itemStyles = StyleSheet.create({
  card: { borderRadius: 12, marginHorizontal: 12, marginVertical: 3, overflow: 'hidden' },
  row: { paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center' },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, marginHorizontal: 10 },
  meta: { writingDirection: 'ltr', fontSize: 12, marginTop: 1 },
  dialBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginStart: 8 },
  badges: { alignItems: 'center', gap: 6 },
  durPill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  durText: { fontSize: 11, fontWeight: '600', writingDirection: 'ltr' },
  detail: { paddingHorizontal: 14, paddingBottom: 14 },
  detailRow: { alignItems: 'center', marginBottom: 8 },
  actionBtn: { alignSelf: 'flex-start', marginVertical: 8, borderColor: BRAND_COLOR },
  section: { marginTop: 10, padding: 10, backgroundColor: '#F8F9FA', borderRadius: 10 },
  sectionHeader: { alignItems: 'center' },
  actionItem: { marginTop: 4, alignItems: 'flex-start' },
  quickActions: { gap: 8, paddingVertical: 4 },
  quickBtn: { borderRadius: 20 },
  quickBtnLabel: { fontSize: 11 },
});

interface RuleItemProps {
  rule: CallRule;
  isRTL: boolean;
  t: (key: string) => string;
  themeColors: MD3Theme['colors'];
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (rule: CallRule) => void;
}

function CallRuleItem({ rule, isRTL, t, themeColors, onToggle, onEdit }: RuleItemProps) {
  return (
    <Surface style={[ruleStyles.card, { backgroundColor: themeColors.surface }]} elevation={1}>
      <Pressable
        onPress={() => onEdit(rule)}
        style={[ruleStyles.row, { flexDirection: 'row' }]}
      >
        <View style={[ruleStyles.content, { alignItems: 'flex-start' }]}>
          <Text variant="titleSmall" style={{ color: themeColors.onSurface }}>
            {rule.name}
          </Text>
          <View style={[ruleStyles.conditionRow, { flexDirection: 'row' }]}>
            <MaterialCommunityIcons name="lightning-bolt" size={14} color="#FF6B35" />
            <Text variant="bodySmall" style={{ color: themeColors.onSurfaceVariant, marginHorizontal: 4, flex: 1, textAlign: isRTL ? 'right' : 'left' }}>
              {t(`phoneCalls.condition_${rule.condition.type}`)} {t(`phoneCalls.op_${rule.condition.operator}`)} {rule.condition.value}
            </Text>
          </View>
          <View style={[ruleStyles.conditionRow, { flexDirection: 'row' }]}>
            <MaterialCommunityIcons name="arrow-right-bold" size={14} color={BRAND_COLOR} />
            <Text variant="bodySmall" style={{ color: themeColors.onSurfaceVariant, marginHorizontal: 4, flex: 1, textAlign: isRTL ? 'right' : 'left' }}>
              {t(`phoneCalls.action_${rule.action.type}`)}
              {rule.action.params?.value ? `: ${rule.action.params.value}` : ''}
            </Text>
          </View>
        </View>
        <Switch
          value={rule.enabled}
          onValueChange={(val) => onToggle(rule.id, val)}
          color={BRAND_COLOR}
        />
      </Pressable>
    </Surface>
  );
}

const ruleStyles = StyleSheet.create({
  card: { borderRadius: 14, marginHorizontal: 16, marginVertical: 5, overflow: 'hidden' },
  row: { padding: 14, alignItems: 'center' },
  content: { flex: 1, marginHorizontal: 8 },
  conditionRow: { alignItems: 'center', marginTop: 4 },
});

interface RuleModalProps {
  visible: boolean;
  rule: Partial<CallRule> | null;
  onDismiss: () => void;
  onSave: (rule: Partial<CallRule>) => void;
  isRTL: boolean;
  t: (key: string) => string;
  themeColors: MD3Theme['colors'];
}

function RuleEditModal({ visible, rule, onDismiss, onSave, isRTL, t, themeColors }: RuleModalProps) {
  const [form, setForm] = useState<Partial<CallRule>>(rule || EMPTY_RULE);
  const [conditionMenuOpen, setConditionMenuOpen] = useState(false);
  const [operatorMenuOpen, setOperatorMenuOpen] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);

  useEffect(() => {
    if (rule) setForm(rule);
    else setForm({ ...EMPTY_RULE });
  }, [rule, visible]);

  const updateCondition = (field: string, value: string) => {
    setForm((prev: Partial<CallRule>) => ({
      ...prev,
      condition: { ...prev.condition!, [field]: value } as CallRule['condition'],
    }));
  };

  const updateAction = (field: string, value: string) => {
    setForm((prev: Partial<CallRule>) => ({
      ...prev,
      action: { ...prev.action!, [field]: value } as CallRule['action'],
    }));
  };

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        contentContainerStyle={[modalStyles.container, { backgroundColor: themeColors.surface }]}
      >
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text variant="titleLarge" style={{ color: themeColors.onSurface, textAlign: isRTL ? 'right' : 'left', marginBottom: 16 }}>
            {form.id ? t('phoneCalls.editRule') : t('phoneCalls.addRule')}
          </Text>

          <TextInput
            label={t('phoneCalls.ruleName')}
            value={form.name || ''}
            onChangeText={(v) => setForm((p: Partial<CallRule>) => ({ ...p, name: v }))}
            mode="outlined"
            style={modalStyles.input}
            outlineColor={BRAND_COLOR + '40'}
            activeOutlineColor={BRAND_COLOR}
            textAlign={isRTL ? 'right' : 'left'}
          />

          <Text variant="labelLarge" style={[modalStyles.sectionLabel, { color: BRAND_COLOR, textAlign: isRTL ? 'right' : 'left' }]}>
            {t('phoneCalls.condition')}
          </Text>

          <Menu
            visible={conditionMenuOpen}
            onDismiss={() => setConditionMenuOpen(false)}
            anchor={
              <Pressable onPress={() => setConditionMenuOpen(true)}>
                <TextInput
                  label={t('phoneCalls.conditionType')}
                  value={t(`phoneCalls.condition_${form.condition?.type || 'call_status'}`)}
                  mode="outlined"
                  editable={false}
                  right={<TextInput.Icon icon="menu-down" />}
                  style={modalStyles.input}
                  outlineColor={BRAND_COLOR + '40'}
                  textAlign={isRTL ? 'right' : 'left'}
                />
              </Pressable>
            }
          >
            {CONDITION_TYPES.map((ct) => (
              <Menu.Item
                key={ct.value}
                title={t(ct.labelKey)}
                onPress={() => { updateCondition('type', ct.value); setConditionMenuOpen(false); }}
              />
            ))}
          </Menu>

          <Menu
            visible={operatorMenuOpen}
            onDismiss={() => setOperatorMenuOpen(false)}
            anchor={
              <Pressable onPress={() => setOperatorMenuOpen(true)}>
                <TextInput
                  label={t('phoneCalls.operator')}
                  value={t(`phoneCalls.op_${form.condition?.operator || 'equals'}`)}
                  mode="outlined"
                  editable={false}
                  right={<TextInput.Icon icon="menu-down" />}
                  style={modalStyles.input}
                  outlineColor={BRAND_COLOR + '40'}
                  textAlign={isRTL ? 'right' : 'left'}
                />
              </Pressable>
            }
          >
            {OPERATORS.map((op) => (
              <Menu.Item
                key={op.value}
                title={t(op.labelKey)}
                onPress={() => { updateCondition('operator', op.value); setOperatorMenuOpen(false); }}
              />
            ))}
          </Menu>

          <TextInput
            label={t('phoneCalls.value')}
            value={form.condition?.value || ''}
            onChangeText={(v) => updateCondition('value', v)}
            mode="outlined"
            style={modalStyles.input}
            outlineColor={BRAND_COLOR + '40'}
            activeOutlineColor={BRAND_COLOR}
            textAlign={isRTL ? 'right' : 'left'}
          />

          <Text variant="labelLarge" style={[modalStyles.sectionLabel, { color: BRAND_COLOR, textAlign: isRTL ? 'right' : 'left' }]}>
            {t('phoneCalls.action')}
          </Text>

          <Menu
            visible={actionMenuOpen}
            onDismiss={() => setActionMenuOpen(false)}
            anchor={
              <Pressable onPress={() => setActionMenuOpen(true)}>
                <TextInput
                  label={t('phoneCalls.actionType')}
                  value={t(`phoneCalls.action_${form.action?.type || 'move_stage'}`)}
                  mode="outlined"
                  editable={false}
                  right={<TextInput.Icon icon="menu-down" />}
                  style={modalStyles.input}
                  outlineColor={BRAND_COLOR + '40'}
                  textAlign={isRTL ? 'right' : 'left'}
                />
              </Pressable>
            }
          >
            {ACTION_TYPES.map((at) => (
              <Menu.Item
                key={at.value}
                title={t(at.labelKey)}
                onPress={() => { updateAction('type', at.value); setActionMenuOpen(false); }}
              />
            ))}
          </Menu>

          <TextInput
            label={t('phoneCalls.actionValue')}
            value={form.action?.params?.value || ''}
            onChangeText={(v) => setForm((p: Partial<CallRule>) => ({ ...p, action: { ...p.action!, params: { ...p.action?.params, value: v } } as CallRule['action'] }))}
            mode="outlined"
            style={modalStyles.input}
            outlineColor={BRAND_COLOR + '40'}
            activeOutlineColor={BRAND_COLOR}
            textAlign={isRTL ? 'right' : 'left'}
          />

          <View style={[modalStyles.footer, { flexDirection: 'row' }]}>
            <Button mode="outlined" onPress={onDismiss} style={modalStyles.footerBtn} textColor={themeColors.onSurfaceVariant}>
              {t('common.cancel')}
            </Button>
            <Button mode="contained" onPress={() => onSave(form)} style={modalStyles.footerBtn} buttonColor={BRAND_COLOR}>
              {t('common.save')}
            </Button>
          </View>
        </ScrollView>
      </Modal>
    </Portal>
  );
}

const modalStyles = StyleSheet.create({
  container: { margin: 20, borderRadius: 20, padding: 24, maxHeight: '85%' },
  input: { marginBottom: 12 },
  sectionLabel: { fontWeight: '700', marginTop: 8, marginBottom: 8 },
  footer: { marginTop: 20, gap: 12 },
  footerBtn: { flex: 1, borderRadius: 12 },
});

export default function PhoneCallsTabScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { isRTL } = useRTL();
  const { t } = useTranslation();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<TabKey>('history');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [callsScope, setCallsScope] = useState<CallsScopeKey>('my');
  const [scopeMenuVisible, setScopeMenuVisible] = useState(false);
  const [dateRange, setDateRange] = useState<DateRangeKey>('all');
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);
  const [orgUsers, setOrgUsers] = useState<Array<{ id: string; name: string }>>([]);
  const [calls, setCalls] = useState<PhoneCall[]>([]);
  const [rules, setRules] = useState<CallRule[]>([]);
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [callsError, setCallsError] = useState<string | null>(null);
  const [ruleModalVisible, setRuleModalVisible] = useState(false);
  const [editingRule, setEditingRule] = useState<CallRule | null>(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dialerVisible, setDialerVisible] = useState(false);
  const [dialNumber, setDialNumber] = useState('');
  const [gambotCallActive, setGambotCallActive] = useState(false);
  const [gambotCallStatus, setGambotCallStatus] = useState<string | null>(null);
  // A usable calling solution (SIP trunk; Twilio only for the master login). Without it the dialer only opens the phone's own dialer.
  const solutionAvailable = useSettingsStore((s) => s.telephonySolutionAvailable);

  const user = useAuthStore((s) => s.user);
  const org = user?.organization || '';
  const dataVisibility = getDataVisibility(
    user?.DataVisibility ?? (user as any)?.dataVisibility,
    user?.SecurityRole ?? (user as any)?.securityRole,
    'phoneCalls'
  );
  const canSeeAllCalls = dataVisibility === 'all';
  const effectiveScope: CallsScopeKey = canSeeAllCalls ? callsScope : 'my';

  const fetchCalls = useCallback(async () => {
    try {
      // my calls -> the signed-in user; all calls -> everyone, or the one user picked in the filter (managers only).
      const options: { userId?: string; agentId?: string; pageSize: number; dateFrom?: string; dateTo?: string } = { pageSize: 300 };
      if (effectiveScope === 'my') {
        const uid = user?.uID || user?.userId;
        if (uid) options.userId = uid;
      } else if (agentFilter) {
        options.agentId = agentFilter;
      }
      const bounds = rangeBounds(dateRange);
      if (bounds.from) options.dateFrom = bounds.from.toISOString();
      if (bounds.to) options.dateTo = new Date(bounds.to.getTime() - 1).toISOString();
      // Office-number call log (same source as the web page: inbound + outbound) merged with calls logged from the phone's own dialer.
      let appError: any = null;
      let pbxFailed = false;
      const [pbx, app] = await Promise.all([
        phoneCallsApi.getPbxCalls(org, options).catch(() => { pbxFailed = true; return [] as PhoneCall[]; }),
        phoneCallsApi.getAppCalls(org, { userId: options.userId || options.agentId, pageSize: options.pageSize }).catch((e) => { appError = e; return [] as PhoneCall[]; }),
      ]);
      if (pbxFailed && appError) throw appError;
      const seen = new Set<string>();
      const fromMs = bounds.from?.getTime() ?? 0;
      const toMs = bounds.to?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const merged = [...pbx, ...app.map((c) => ({ ...c, source: 'app' as const }))].filter((c) => {
        if (!c.id || seen.has(c.id)) return false;
        seen.add(c.id);
        const ts = callTime(c.createdAt);
        return !bounds.from || (ts >= fromMs && ts < toMs);
      });
      merged.sort((a, b) => callTime(b.createdAt) - callTime(a.createdAt));
      setCalls(merged);
      setCallsError(null);
    } catch (err: any) {
      setCalls([]);
      setCallsError(err.message || t('errors.generic'));
    }
  }, [org, effectiveScope, agentFilter, dateRange, user?.uID, user?.userId, t]);

  // The user filter (managers who can see everyone's calls) needs the org's users.
  useEffect(() => {
    if (!canSeeAllCalls || !org) return;
    usersApi.getAll(org)
      .then((list) => setOrgUsers(list.map((u) => ({ id: u.uID || u.userId || u.id, name: u.fullname || u.userName || u.name || '' })).filter((u) => u.id && u.name)))
      .catch(() => setOrgUsers([]));
  }, [canSeeAllCalls, org]);

  const fetchRules = useCallback(async () => {
    try {
      const data = await phoneCallsApi.getCallRules(org);
      setRules(data);
    } catch {
      setRules([]);
    }
  }, [org]);

  const loadData = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchCalls(), fetchRules()]);
    setLoading(false);
  }, [fetchCalls, fetchRules]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      fetchCalls();
      // Opening the screen with unanswered calls waiting: show them first, then clear the "More" badge.
      const missedStore = useMissedCallsStore.getState();
      if (missedStore.unseen > 0) setFilter('missed');
      missedStore.markSeen();
    }, [fetchCalls])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setCallsError(null);
    await Promise.all([fetchCalls(), fetchRules()]);
    setRefreshing(false);
  }, [fetchCalls, fetchRules]);

  // Debounce search so the list re-filters once typing pauses (no per-keystroke flicker).
  const debouncedSearch = useDebouncedValue(searchQuery, 350);

  const filteredCalls = useMemo(() => {
    let result = calls;
    if (filter === 'answered') result = result.filter((c) => c.status === 'answered');
    else if (filter === 'missed') result = result.filter((c) => c.status === 'missed');

    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter(
        (c) =>
          c.contactName?.toLowerCase().includes(q) ||
          c.phoneNumber?.includes(q)
      );
    }
    return result;
  }, [calls, filter, debouncedSearch]);

  // Client-side pagination over the filtered list (search still spans everything).
  const { visible: visibleCalls, hasMore: callsHasMore, loadMore: callsLoadMore, loadAll: callsLoadAll, count: callsCount } = useWindowedList(filteredCalls, {
    pageSize: 30,
    resetKey: `${filter}|${debouncedSearch}`,
  });

  const handleExpandCall = useCallback((id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedCallId((prev) => (prev === id ? null : id));
  }, []);

  const handleToggleRule = useCallback(async (id: string, enabled: boolean) => {
    const updated = rules.map((r) => (r.id === id ? { ...r, enabled } : r));
    setRules(updated);
    try {
      await phoneCallsApi.updateCallRules(org, updated);
    } catch {
      setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !enabled } : r)));
    }
  }, [org, rules]);

  const handleSaveRule = useCallback(async (rule: Partial<CallRule>) => {
    try {
      let newRules: CallRule[];
      if (rule.id) {
        newRules = rules.map((r) => (r.id === rule.id ? { ...r, ...rule } as CallRule : r));
      } else {
        const newRule = { ...rule, id: Date.now().toString() } as CallRule;
        newRules = [...rules, newRule];
      }
      await phoneCallsApi.updateCallRules(org, newRules);
      setRules(newRules);
      setRuleModalVisible(false);
      setEditingRule(null);
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
    }
  }, [org, rules, t]);

  const myExtension = useSettingsStore((s) => s.myExtension);
  const setMyOutboundCallerId = useSettingsStore((s) => s.setMyOutboundCallerId);
  const handleCallerIdChange = useCallback(async (value: 'did' | 'mobile') => {
    const phone = (user as any)?.phoneNumber || (user as any)?.PhoneNumber || (user as any)?.phone || myExtension?.mobilePhone || '';
    if (value === 'mobile' && !phone) {
      Alert.alert(t('phoneCalls.gambotCallTitle'), t('phoneCalls.noAgentPhone'));
      return;
    }
    const res = await setMyOutboundCallerId(org, value, phone);
    if (!res.ok) Alert.alert(t('common.error'), t('phoneCalls.callerIdFailed'));
  }, [user, myExtension?.mobilePhone, setMyOutboundCallerId, org, t]);

  const handleDial = useCallback((phone?: string) => {
    if (phone) {
      makeAppCall({
        phoneNumber: phone,
        organization: org,
        callerUserId: user?.uID || user?.userId,
        callerUserName: user?.fullname,
      });
    }
  }, [org, user]);

  // The call button on a row of the calls list: same as every other Call button in the app (the user's default dialer: the
  // organization's line / in-app phone, or the phone's own dialer when chosen in Settings).
  const handleRowDial = useCallback((phone?: string) => {
    if (!phone) return;
    placeSmartCall({ phoneNumber: phone, organization: org, user });
  }, [org, user]);

  const handleGambotDial = useCallback(async (phone?: string) => {
    if (!phone?.trim()) return;
    // Caller IDs come from the settings store, which already drops Twilio numbers for everyone but the master login.
    const tel = useSettingsStore.getState();
    const agentPhone = (user as any)?.phoneNumber || (user as any)?.PhoneNumber || (user as any)?.phone || tel.myExtension?.mobilePhone;
    const fromNumber = tel.defaultCallerId || tel.usableCallerNumbers?.[0]?.number || '';
    const isSip = tel.telephonyProvider === 'sip';

    // In-app phone (internet call, like the web phone): no "ring my phone first" and no mobile number needed.
    if (isSip && sipPhone.isSupported()) {
      setGambotCallActive(true);
      setGambotCallStatus('connecting');
      const started = await tryInAppSipCall({ phoneNumber: phone.trim(), organization: org, user });
      if (started) {
        setTimeout(() => {
          setGambotCallActive(false);
          setGambotCallStatus(null);
          setDialerVisible(false);
          setDialNumber('');
          fetchCalls();
        }, 2000);
        return;
      }
      setGambotCallActive(false);
      setGambotCallStatus(null);
    }

    if (!agentPhone) {
      Alert.alert(
        t('phoneCalls.gambotCallTitle'),
        t('phoneCalls.noAgentPhone'),
        [
          { text: t('common.cancel', 'Cancel'), style: 'cancel' },
          { text: t('phoneCalls.openSettings', isRTL ? 'להגדרות' : 'Settings'), onPress: () => router.push('/(tabs)/more/settings' as any) },
        ],
      );
      return;
    }
    if (!fromNumber && !isSip) {
      Alert.alert(
        t('phoneCalls.gambotCallTitle'),
        t('phoneCalls.noGambotNumber'),
      );
      return;
    }

    setGambotCallActive(true);
    setGambotCallStatus('calling_agent');

    const result = await makeGambotCall({
      phoneNumber: phone.trim(),
      organization: org,
      agentPhone,
      fromPhoneNumber: fromNumber,
      allowEmptyFrom: isSip,
      agentId: user?.uID || user?.userId || '',
      agentName: user?.fullname || (user as any)?.FullName || '',
    });

    if (result.success) {
      setGambotCallStatus('connecting');
      setTimeout(() => {
        setGambotCallActive(false);
        setGambotCallStatus(null);
        setDialerVisible(false);
        setDialNumber('');
        fetchCalls();
      }, 5000);
    } else {
      setGambotCallActive(false);
      setGambotCallStatus(null);
      Alert.alert(t('common.error'), t('phoneCalls.gambotCallFailed'));
    }
  }, [org, user, t, fetchCalls, isRTL, router]);

  const handleQuickAction = useCallback((action: string, call: PhoneCall) => {
    switch (action) {
      case 'playRecording':
        // Recordings play inside the app (RecordingPlayer in the expanded call card) - never open the browser.
        break;
      case 'createFollowUp':
        router.push({
          pathname: '/(tabs)/tasks',
          params: {
            prefillTitle: `${t('phoneCalls.followUp')} - ${call.contactName || call.phoneNumber}`,
            prefillPhone: call.phoneNumber,
            prefillType: 'phone_call',
          },
        });
        break;
      case 'updateLead':
        if (call.relatedTo?.type === 'lead' && call.relatedTo?.entityId) {
          router.push({
            pathname: '/(tabs)/leads/[id]',
            params: { id: call.relatedTo.entityId },
          });
        }
        break;
      case 'moveStage':
        if (call.relatedTo?.type === 'lead' && call.relatedTo?.entityId) {
          router.push({
            pathname: '/(tabs)/leads/[id]',
            params: { id: call.relatedTo.entityId },
          });
        }
        break;
    }
  }, [router, t]);

  const openAddRule = useCallback(() => {
    setEditingRule(null);
    setRuleModalVisible(true);
  }, []);

  const openEditRule = useCallback((rule: CallRule) => {
    setEditingRule(rule);
    setRuleModalVisible(true);
  }, []);

  const renderCallItem = useCallback(
    ({ item }: { item: PhoneCall }) => (
      <CallHistoryItem
        call={item}
        expanded={expandedCallId === item.id}
        onPress={() => handleExpandCall(item.id)}
        isRTL={isRTL}
        t={t}
        themeColors={theme.colors}
        onQuickAction={handleQuickAction}
        onDial={handleRowDial}
        org={org}
      />
    ),
    [expandedCallId, isRTL, t, theme.colors, handleExpandCall, handleQuickAction, handleRowDial, org],
  );

  const renderRuleItem = useCallback(
    ({ item }: { item: CallRule }) => (
      <CallRuleItem
        rule={item}
        isRTL={isRTL}
        t={t}
        themeColors={theme.colors}
        onToggle={handleToggleRule}
        onEdit={openEditRule}
      />
    ),
    [isRTL, t, theme.colors, handleToggleRule, openEditRule],
  );

  const callKeyExtractor = useCallback((item: PhoneCall) => item.id, []);
  const ruleKeyExtractor = useCallback((item: CallRule) => item.id, []);

  const EmptyState = ({ icon, message }: { icon: string; message: string }) => (
    <View style={styles.empty}>
      <MaterialCommunityIcons name={icon as any} size={56} color={theme.colors.onSurfaceVariant + '60'} />
      <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant, marginTop: 12, textAlign: 'center' }}>
        {message}
      </Text>
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={BRAND_COLOR} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{t('phoneCalls.appCalls')}</Text>
          <Text style={styles.headerSubtitle}>{t('phoneCalls.appCallsDescription')}</Text>
        </View>
        {activeTab === 'history' && (
          <Pressable onPress={() => setFilterSheetVisible(true)} hitSlop={8} style={{ padding: 4, marginHorizontal: 6 }}>
            <MaterialCommunityIcons name="filter-variant" size={24} color="#FFF" />
            {(dateRange !== 'all' || (effectiveScope === 'all' && !!agentFilter)) && <View style={styles.filterDot} />}
          </Pressable>
        )}
        <Pressable onPress={() => setSearchVisible(!searchVisible)} hitSlop={8} style={{ padding: 4 }}>
          <MaterialCommunityIcons
            name={searchVisible ? 'close' : 'magnify'}
            size={24}
            color="#FFF"
          />
        </Pressable>
      </View>

      {searchVisible && (
        <View style={[styles.searchWrap, { backgroundColor: BRAND_COLOR }]}>
          <Searchbar
            placeholder={t('phoneCalls.searchPlaceholder')}
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={[styles.searchbar, { backgroundColor: theme.colors.surface }]}
            inputStyle={{ fontSize: 14, textAlign: isRTL ? 'right' : 'left' }}
            iconColor={theme.colors.onSurfaceVariant}
            autoFocus
          />
        </View>
      )}

      <Portal>
        <Modal
          visible={filterSheetVisible}
          onDismiss={() => setFilterSheetVisible(false)}
          contentContainerStyle={[modalStyles.container, { backgroundColor: theme.colors.surface }]}
        >
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={[modalStyles.sectionLabel, { marginTop: 0, textAlign: isRTL ? 'right' : 'left' }]}>{t('phoneCalls.filterByDate')}</Text>
            <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 8 }}>
              {DATE_RANGE_KEYS.map((k) => (
                <Chip key={k} selected={dateRange === k} showSelectedCheck={false} onPress={() => setDateRange(k)}>
                  {t(`phoneCalls.range_${k}`)}
                </Chip>
              ))}
            </View>
            {effectiveScope === 'all' && orgUsers.length > 0 && (
              <>
                <Text style={[modalStyles.sectionLabel, { marginTop: 20, textAlign: isRTL ? 'right' : 'left' }]}>{t('phoneCalls.filterByUser')}</Text>
                <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Chip selected={!agentFilter} showSelectedCheck={false} onPress={() => setAgentFilter(null)}>{t('phoneCalls.allUsers')}</Chip>
                  {orgUsers.map((u) => (
                    <Chip key={u.id} selected={agentFilter === u.id} showSelectedCheck={false} onPress={() => setAgentFilter(u.id)}>{u.name}</Chip>
                  ))}
                </View>
              </>
            )}
          </ScrollView>
          <View style={[modalStyles.footer, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
            <Button mode="outlined" style={modalStyles.footerBtn} onPress={() => { setDateRange('all'); setAgentFilter(null); }}>
              {t('phoneCalls.clearFilters')}
            </Button>
            <Button mode="contained" buttonColor={BRAND_COLOR} style={modalStyles.footerBtn} onPress={() => setFilterSheetVisible(false)}>
              {t('phoneCalls.showResults')}
            </Button>
          </View>
        </Modal>
      </Portal>

      {activeTab === 'history' && (
        <>
          {/* One slim row: whose calls (tap to switch) + status segmented control */}
          <View style={[styles.filterBar, { flexDirection: 'row' }]}>
            {canSeeAllCalls ? (
              <Menu
                visible={scopeMenuVisible}
                onDismiss={() => setScopeMenuVisible(false)}
                anchor={
                  <Pressable
                    onPress={() => setScopeMenuVisible(true)}
                    hitSlop={6}
                    style={[styles.scopePill, { borderColor: theme.colors.outlineVariant }]}
                  >
                    <MaterialCommunityIcons name={callsScope === 'my' ? 'account' : 'account-group'} size={15} color={BRAND_COLOR} />
                    <Text style={styles.scopePillText}>{callsScope === 'my' ? t('phoneCalls.myCalls') : t('phoneCalls.allCalls')}</Text>
                    <MaterialCommunityIcons name="chevron-down" size={16} color={theme.colors.onSurfaceVariant} />
                  </Pressable>
                }
              >
                <Menu.Item
                  leadingIcon="account"
                  title={t('phoneCalls.myCalls')}
                  onPress={() => { setCallsScope('my'); setAgentFilter(null); setScopeMenuVisible(false); }}
                />
                <Menu.Item
                  leadingIcon="account-group"
                  title={t('phoneCalls.allCalls')}
                  onPress={() => { setCallsScope('all'); setScopeMenuVisible(false); }}
                />
              </Menu>
            ) : <View />}
            <View style={[styles.seg, { backgroundColor: theme.colors.surface, flexDirection: 'row' }]}>
              {(['all', 'answered', 'missed'] as FilterKey[]).map((f) => {
                const on = filter === f;
                return (
                  <Pressable
                    key={f}
                    onPress={() => setFilter(f)}
                    style={[styles.segItem, on && { backgroundColor: f === 'missed' ? '#E63946' : BRAND_COLOR }]}
                  >
                    <Text style={[styles.segText, { color: on ? '#FFF' : theme.colors.onSurfaceVariant }, on && { fontWeight: '700' }]}>
                      {t(`phoneCalls.${f === 'all' ? 'all' : f}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <FlatList
            data={visibleCalls}
            renderItem={renderCallItem}
            keyExtractor={callKeyExtractor}
            contentContainerStyle={styles.list}
            ListFooterComponent={
              <ListPaginationFooter
                count={callsCount}
                total={filteredCalls.length}
                hasMore={callsHasMore}
                onLoadMore={callsLoadMore}
                onLoadAll={callsLoadAll}
              />
            }
            onEndReached={callsHasMore ? callsLoadMore : undefined}
            onEndReachedThreshold={0.4}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[BRAND_COLOR]} tintColor={BRAND_COLOR} />
            }
            ListEmptyComponent={
              callsError
                ? <EmptyState icon="alert-circle-outline" message={callsError} />
                : <EmptyState icon="phone-off" message={t('phoneCalls.noCalls')} />
            }
          />
        </>
      )}

      <FAB
        icon="phone-plus"
        label={t('phoneCalls.makeCall')}
        onPress={() => setDialerVisible(true)}
        style={[styles.fab, { backgroundColor: BRAND_COLOR }]}
        color="#FFF"
      />

      <Portal>
        <Modal
          visible={dialerVisible}
          onDismiss={() => { if (!gambotCallActive) { setDialerVisible(false); setDialNumber(''); } }}
          contentContainerStyle={[styles.dialerModal, { backgroundColor: theme.colors.surface }]}
        >
          {/* In-call status screen */}
          {gambotCallActive ? (
            <View style={styles.inCallScreen}>
              <View style={styles.inCallAvatarWrap}>
                <MaterialCommunityIcons name="phone-in-talk" size={48} color="#FFF" />
              </View>
              <Text variant="headlineSmall" style={{ color: theme.colors.onSurface, fontWeight: '700', textAlign: 'center', marginTop: 16 }}>
                {dialNumber || t('phoneCalls.unknownNumber')}
              </Text>
              <View style={styles.inCallStatusRow}>
                <ActivityIndicator size="small" color="#059669" />
                <Text variant="bodyMedium" style={{ color: '#059669', fontWeight: '600', marginStart: 8 }}>
                  {gambotCallStatus === 'calling_agent'
                    ? t('phoneCalls.callingYourPhone')
                    : t('phoneCalls.connectingCustomer')
                  }
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  const live = useActiveCallStore.getState().call;
                  if (live) phoneCallsApi.sipCallControl(live.organization, live.callId, 'hangup').catch(() => {});
                  useActiveCallStore.getState().clear();
                  setGambotCallActive(false);
                  setGambotCallStatus(null);
                  setDialerVisible(false);
                  setDialNumber('');
                }}
                style={styles.inCallEndBtn}
              >
                <MaterialCommunityIcons name="phone-hangup" size={28} color="#FFF" />
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.dialerHeader}>
                <Text variant="titleLarge" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
                  {t('phoneCalls.makeCall')}
                </Text>
                <IconButton
                  icon="close"
                  size={22}
                  onPress={() => { setDialerVisible(false); setDialNumber(''); }}
                  style={{ margin: 0 }}
                />
              </View>

              {/* Number display */}
              <View style={styles.dialNumberDisplay}>
                <Text style={[styles.dialNumberText, { color: dialNumber ? theme.colors.onSurface : theme.colors.onSurfaceVariant }]}>
                  {dialNumber || t('phoneCalls.enterPhoneNumber')}
                </Text>
                {dialNumber.length > 0 && (
                  <IconButton
                    icon="backspace-outline"
                    size={22}
                    onPress={() => setDialNumber(prev => prev.slice(0, -1))}
                    onLongPress={() => setDialNumber('')}
                    iconColor={theme.colors.onSurfaceVariant}
                    style={{ margin: 0 }}
                  />
                )}
              </View>

              <Divider style={{ marginBottom: 8 }} />

              {/* Keypad - force LTR so numbers are always 1-2-3 left-to-right */}
              <View style={[styles.dialPad, { direction: 'ltr' }]}>
                {[
                  [{ d: '1', sub: '' }, { d: '2', sub: 'ABC' }, { d: '3', sub: 'DEF' }],
                  [{ d: '4', sub: 'GHI' }, { d: '5', sub: 'JKL' }, { d: '6', sub: 'MNO' }],
                  [{ d: '7', sub: 'PQRS' }, { d: '8', sub: 'TUV' }, { d: '9', sub: 'WXYZ' }],
                  [{ d: '*', sub: '' }, { d: '0', sub: '+' }, { d: '#', sub: '' }],
                ].map((row, ri) => (
                  <View key={ri} style={styles.dialRow}>
                    {row.map(({ d, sub }) => (
                      <Pressable
                        key={d}
                        onPress={() => setDialNumber(prev => prev + d)}
                        onLongPress={d === '0' ? () => setDialNumber(prev => prev + '+') : undefined}
                        style={({ pressed }) => [
                          styles.dialKey,
                          { backgroundColor: pressed ? BRAND_COLOR + '18' : 'transparent' },
                        ]}
                      >
                        <Text style={{ fontSize: 28, fontWeight: '400', color: theme.colors.onSurface }}>
                          {d}
                        </Text>
                        {sub ? (
                          <Text style={{ fontSize: 10, color: theme.colors.onSurfaceVariant, letterSpacing: 2, marginTop: -2 }}>
                            {sub}
                          </Text>
                        ) : null}
                      </Pressable>
                    ))}
                  </View>
                ))}
              </View>

              {/* Which number the customer sees on Gambot calls: the organization number (DID) or my own mobile - saved per user, same as Settings */}
              {solutionAvailable && myExtension ? (
                <View style={styles.callerIdRow}>
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginBottom: 6 }}>
                    {t('phoneCalls.callerIdTitle')}
                  </Text>
                  <SegmentedButtons
                    density="small"
                    value={myExtension.outboundCallerId === 'mobile' ? 'mobile' : 'did'}
                    onValueChange={(v) => handleCallerIdChange(v as 'did' | 'mobile')}
                    buttons={[
                      { value: 'did', label: t('phoneCalls.callerIdDid'), icon: 'office-building' },
                      { value: 'mobile', label: t('phoneCalls.callerIdMobile'), icon: 'cellphone' },
                    ]}
                    theme={{ colors: { secondaryContainer: BRAND_COLOR + '20', onSecondaryContainer: BRAND_COLOR } }}
                  />
                </View>
              ) : null}

              {/* Office number -> Gambot only (a plain phone call could never show the office number).
                  My mobile -> both: the phone's own dialer (the customer sees my mobile anyway) and Gambot (recorded + CRM).
                  No calling solution at all -> only the phone's own dialer. */}
              <View style={styles.dialActions}>
                {(!solutionAvailable || myExtension?.outboundCallerId === 'mobile') ? (
                  <Pressable
                    onPress={() => {
                      if (dialNumber.trim()) {
                        handleDial(dialNumber.trim());
                        setDialerVisible(false);
                        setDialNumber('');
                      }
                    }}
                    disabled={!dialNumber.trim()}
                    style={[
                      styles.dialCallBtn,
                      { backgroundColor: dialNumber.trim() ? BRAND_COLOR : theme.colors.surfaceVariant },
                    ]}
                  >
                    <MaterialCommunityIcons name="phone" size={28} color={dialNumber.trim() ? '#FFF' : theme.colors.onSurfaceVariant} />
                  </Pressable>
                ) : null}

                {solutionAvailable ? (
                  <Pressable
                    onPress={() => handleGambotDial(dialNumber)}
                    disabled={!dialNumber.trim() || gambotCallActive}
                    style={[
                      styles.dialCallBtnGambot,
                      { backgroundColor: dialNumber.trim() && !gambotCallActive ? '#059669' : theme.colors.surfaceVariant },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name="phone-in-talk"
                      size={22}
                      color={dialNumber.trim() && !gambotCallActive ? '#FFF' : theme.colors.onSurfaceVariant}
                    />
                    <Text style={{ color: dialNumber.trim() && !gambotCallActive ? '#FFF' : theme.colors.onSurfaceVariant, fontWeight: '700', fontSize: 12, marginStart: 4 }}>
                      Gambot
                    </Text>
                  </Pressable>
                ) : null}
              </View>

              <View style={styles.dialHints}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
                  {!solutionAvailable
                    ? t('phoneCalls.dialHintNative')
                    : (myExtension?.outboundCallerId === 'mobile' ? t('phoneCalls.dialHintFull') : (isRTL ? 'חיוג מגמבוט (מוקלט + CRM)' : 'Gambot dial (recorded + CRM)'))}
                </Text>
              </View>            </>
          )}
        </Modal>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 12,
    backgroundColor: BRAND_COLOR,
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  headerSubtitle: { fontSize: 12, color: '#FFFFFF', opacity: 0.9, marginTop: 2 },
  searchWrap: {
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  searchbar: { height: 40, borderRadius: 20, elevation: 0 },
  filterBar: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6, alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  scopePill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, paddingHorizontal: 10, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  filterDot: { position: 'absolute', top: 2, right: 2, width: 9, height: 9, borderRadius: 5, backgroundColor: '#F4B400', borderWidth: 1, borderColor: BRAND_COLOR },
  scopePillText: { fontSize: 12.5, fontWeight: '600', color: BRAND_COLOR },
  seg: { borderRadius: 16, padding: 2 },
  segItem: { height: 28, paddingHorizontal: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  segText: { fontSize: 12.5 },
  list: { paddingVertical: 8, paddingBottom: 100 },
  addRuleBtn: { marginHorizontal: 16, marginTop: 12, borderColor: BRAND_COLOR, borderRadius: 12 },
  fab: { position: 'absolute', bottom: 24, end: 20, borderRadius: 28 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  dialerModal: {
    margin: 16,
    borderRadius: 28,
    padding: 20,
    maxHeight: '92%',
  },
  dialerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  dialNumberDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 56,
  },
  dialNumberText: {
    fontSize: 28,
    fontWeight: '300',
    textAlign: 'center',
    flex: 1,
    letterSpacing: 1.5,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  dialPad: {
    gap: 4,
    marginBottom: 12,
  },
  dialRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  dialKey: {
    width: 72,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 8,
  },
  dialCallBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  dialCallBtnGambot: {
    height: 44,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  callerIdRow: { paddingHorizontal: 4, paddingTop: 4, paddingBottom: 8 },
  dialHints: {
    paddingTop: 8,
    paddingBottom: 4,
  },
  // In-call screen
  inCallScreen: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  inCallAvatarWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: BRAND_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: BRAND_COLOR,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  inCallStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#ecfdf5',
    borderRadius: 20,
  },
  inCallEndBtn: {
    marginTop: 32,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#ef4444',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
});