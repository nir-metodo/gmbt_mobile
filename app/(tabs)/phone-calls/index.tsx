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
import { phoneCallsApi } from '../../../services/api/phoneCalls';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { useRTL } from '../../../hooks/useRTL';
import { useAuthStore } from '../../../stores/authStore';
import { makeAppCall, makeGambotCall } from '../../../utils/phoneCall';
import { getDataVisibility } from '../../../constants/permissions';
import { PhoneCall, CallRule } from '../../../types';
import {
  formatDate,
  formatDuration,
  formatPhoneNumber,
  formatRelativeTime,
} from '../../../utils/formatters';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const BRAND_COLOR = '#2e6155';

type TabKey = 'history' | 'rules';
type FilterKey = 'all' | 'answered' | 'missed';
type CallsScopeKey = 'my' | 'all';
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
}

function CallHistoryItem({ call, expanded, onPress, isRTL, t, themeColors, onQuickAction, onDial }: CallItemProps) {
  const dirIcon = getDirectionIcon(call.direction, call.status);
  const [showFullTranscript, setShowFullTranscript] = useState(false);

  return (
    <Surface style={[itemStyles.card, { backgroundColor: themeColors.surface }]} elevation={1}>
      <Pressable onPress={onPress} style={[itemStyles.row, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
        <View style={[itemStyles.iconWrap, { backgroundColor: dirIcon.color + '15' }]}>
          <MaterialCommunityIcons name={dirIcon.name} size={22} color={dirIcon.color} />
        </View>

        <View style={[itemStyles.info, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
          <Text variant="titleSmall" style={{ color: themeColors.onSurface }} numberOfLines={1}>
            {call.contactName || formatPhoneNumber(call.phoneNumber)}
          </Text>
          <Text variant="bodySmall" style={{ color: themeColors.onSurfaceVariant }}>
            {formatRelativeTime(call.createdAt)}
            {call.duration > 0 ? ` · ${formatDuration(call.duration)}` : ''}
          </Text>
        </View>

        <Pressable
          onPress={() => onDial(call.phoneNumber)}
          hitSlop={8}
          style={[itemStyles.dialBtn, { backgroundColor: BRAND_COLOR + '15' }]}
        >
          <MaterialCommunityIcons name="phone" size={18} color={BRAND_COLOR} />
        </Pressable>

        <View style={[itemStyles.badges, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
          {call.recordingUrl && (
            <MaterialCommunityIcons name="microphone" size={16} color="#FF6B35" style={{ marginHorizontal: 2 }} />
          )}
          {call.transcription && (
            <MaterialCommunityIcons name="brain" size={16} color="#7B2D8E" style={{ marginHorizontal: 2 }} />
          )}
          <MaterialCommunityIcons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={themeColors.onSurfaceVariant}
          />
        </View>
      </Pressable>

      {expanded && (
        <View style={itemStyles.detail}>
          <Divider style={{ marginBottom: 12 }} />

          <View style={[itemStyles.detailRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
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
            <View style={[itemStyles.detailRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
              <Text variant="labelMedium" style={{ color: themeColors.onSurfaceVariant }}>
                {t('phoneCalls.duration')}:
              </Text>
              <Text variant="bodyMedium" style={{ marginHorizontal: 8, color: themeColors.onSurface }}>
                {formatDuration(call.duration)}
              </Text>
            </View>
          )}

          {call.recordingUrl && (
            <Button
              icon="play-circle-outline"
              mode="outlined"
              compact
              style={itemStyles.actionBtn}
              onPress={() => onQuickAction('playRecording', call)}
            >
              {t('phoneCalls.playRecording')}
            </Button>
          )}

          {call.transcription && (
            <View style={itemStyles.section}>
              <Pressable
                onPress={() => setShowFullTranscript(!showFullTranscript)}
                style={[itemStyles.sectionHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
              >
                <MaterialCommunityIcons name="text-box-outline" size={16} color={BRAND_COLOR} />
                <Text variant="labelMedium" style={{ color: BRAND_COLOR, marginHorizontal: 6, flex: 1, textAlign: isRTL ? 'right' : 'left' }}>
                  {t('phoneCalls.transcription')}
                </Text>
                <MaterialCommunityIcons
                  name={showFullTranscript ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={BRAND_COLOR}
                />
              </Pressable>
              <Text
                variant="bodySmall"
                numberOfLines={showFullTranscript ? undefined : 3}
                style={{ color: themeColors.onSurfaceVariant, textAlign: isRTL ? 'right' : 'left', marginTop: 4 }}
              >
                {call.transcription}
              </Text>
            </View>
          )}

          {call.aiSummary && (
            <View style={itemStyles.section}>
              <View style={[itemStyles.sectionHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                <MaterialCommunityIcons name="brain" size={16} color="#7B2D8E" />
                <Text variant="labelMedium" style={{ color: '#7B2D8E', marginHorizontal: 6 }}>
                  {t('phoneCalls.aiSummary')}
                </Text>
              </View>
              <Text variant="bodySmall" style={{ color: themeColors.onSurfaceVariant, textAlign: isRTL ? 'right' : 'left', marginTop: 4 }}>
                {call.aiSummary}
              </Text>
            </View>
          )}

          {call.aiActionItems && call.aiActionItems.length > 0 && (
            <View style={itemStyles.section}>
              <View style={[itemStyles.sectionHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                <MaterialCommunityIcons name="clipboard-check-outline" size={16} color="#FF6B35" />
                <Text variant="labelMedium" style={{ color: '#FF6B35', marginHorizontal: 6 }}>
                  {t('phoneCalls.actionItems')}
                </Text>
              </View>
              {call.aiActionItems.map((item: string, idx: number) => (
                <View key={idx} style={[itemStyles.actionItem, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                  <Text variant="bodySmall" style={{ color: themeColors.onSurfaceVariant }}>•</Text>
                  <Text variant="bodySmall" style={{ color: themeColors.onSurfaceVariant, flex: 1, marginHorizontal: 6, textAlign: isRTL ? 'right' : 'left' }}>
                    {item}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <Divider style={{ marginVertical: 8 }} />

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[itemStyles.quickActions, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
          >
            <Button
              icon="calendar-plus"
              mode="contained-tonal"
              compact
              style={itemStyles.quickBtn}
              labelStyle={itemStyles.quickBtnLabel}
              onPress={() => onQuickAction('createFollowUp', call)}
            >
              {t('phoneCalls.createFollowUp')}
            </Button>
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
  card: { borderRadius: 14, marginHorizontal: 16, marginVertical: 5, overflow: 'hidden' },
  row: { padding: 14, alignItems: 'center' },
  iconWrap: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, marginHorizontal: 12 },
  dialBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginEnd: 8 },
  badges: { alignItems: 'center', gap: 2 },
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
        style={[ruleStyles.row, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
      >
        <View style={[ruleStyles.content, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
          <Text variant="titleSmall" style={{ color: themeColors.onSurface }}>
            {rule.name}
          </Text>
          <View style={[ruleStyles.conditionRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
            <MaterialCommunityIcons name="lightning-bolt" size={14} color="#FF6B35" />
            <Text variant="bodySmall" style={{ color: themeColors.onSurfaceVariant, marginHorizontal: 4, flex: 1, textAlign: isRTL ? 'right' : 'left' }}>
              {t(`phoneCalls.condition_${rule.condition.type}`)} {t(`phoneCalls.op_${rule.condition.operator}`)} {rule.condition.value}
            </Text>
          </View>
          <View style={[ruleStyles.conditionRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
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

          <View style={[modalStyles.footer, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
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
  const [telSettings, setTelSettings] = useState<{ phoneNumbers?: any[]; defaultCallerId?: string } | null>(null);

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
      const options: { userId?: string } = {};
      if (effectiveScope === 'my') {
        const uid = user?.uID || user?.userId;
        if (uid) options.userId = uid;
      }
      const data = await phoneCallsApi.getAppCalls(org, options);
      setCalls(data);
    } catch (err: any) {
      setCalls([]);
      setCallsError(err.message || t('errors.generic'));
    }
  }, [org, effectiveScope, user?.uID, user?.userId, t]);

  const fetchRules = useCallback(async () => {
    try {
      const data = await phoneCallsApi.getCallRules(org);
      setRules(data);
    } catch {
      setRules([]);
    }
  }, [org]);

  const fetchTelSettings = useCallback(async () => {
    try {
      const data = await phoneCallsApi.getTelephonySettings(org);
      if (data?.phoneNumbers?.length) setTelSettings(data);
    } catch {}
  }, [org]);

  const loadData = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchCalls(), fetchRules(), fetchTelSettings()]);
    setLoading(false);
  }, [fetchCalls, fetchRules, fetchTelSettings]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      fetchCalls();
    }, [fetchCalls])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setCallsError(null);
    await Promise.all([fetchCalls(), fetchRules()]);
    setRefreshing(false);
  }, [fetchCalls, fetchRules]);

  const filteredCalls = useMemo(() => {
    let result = calls;
    if (filter === 'answered') result = result.filter((c) => c.status === 'answered');
    else if (filter === 'missed') result = result.filter((c) => c.status === 'missed');

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.contactName?.toLowerCase().includes(q) ||
          c.phoneNumber?.includes(q)
      );
    }
    return result;
  }, [calls, filter, searchQuery]);

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

  const handleGambotDial = useCallback(async (phone?: string) => {
    if (!phone?.trim()) return;
    const agentPhone = (user as any)?.phoneNumber || (user as any)?.PhoneNumber || (user as any)?.phone;
    const fromNumber = telSettings?.defaultCallerId || telSettings?.phoneNumbers?.[0]?.number;

    if (!agentPhone) {
      Alert.alert(
        t('phoneCalls.gambotCallTitle'),
        t('phoneCalls.noAgentPhone'),
      );
      return;
    }
    if (!fromNumber) {
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
      agentId: user?.uID || user?.userId || '',
      agentName: user?.fullname || user?.FullName || '',
    });

    if (result.success) {
      setGambotCallStatus('connecting');
      setDialerVisible(false);
      setDialNumber('');
      setTimeout(() => {
        setGambotCallActive(false);
        setGambotCallStatus(null);
        fetchCalls();
      }, 5000);
    } else {
      setGambotCallActive(false);
      setGambotCallStatus(null);
      Alert.alert(t('common.error'), t('phoneCalls.gambotCallFailed'));
    }
  }, [org, user, telSettings, t, fetchCalls]);

  const handleQuickAction = useCallback((action: string, call: PhoneCall) => {
    switch (action) {
      case 'playRecording':
        if (call.recordingUrl) Linking.openURL(call.recordingUrl);
        break;
      case 'createFollowUp':
        router.push({
          pathname: '/(tabs)/more/tasks',
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
        onDial={handleDial}
      />
    ),
    [expandedCallId, isRTL, t, theme.colors, handleExpandCall, handleQuickAction, handleDial],
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

      <SegmentedButtons
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabKey)}
        buttons={[
          { value: 'history', label: t('phoneCalls.callHistory'), icon: 'phone-log' },
          { value: 'rules', label: t('phoneCalls.callRules'), icon: 'auto-fix' },
        ]}
        style={styles.tabs}
        theme={{ colors: { secondaryContainer: BRAND_COLOR + '20', onSecondaryContainer: BRAND_COLOR } }}
      />

      {activeTab === 'history' && (
        <>
          {canSeeAllCalls && (
            <View style={[styles.scopeRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
              <Chip
                selected={callsScope === 'my'}
                onPress={() => setCallsScope('my')}
                mode="flat"
                compact
                style={[styles.filterChip, callsScope === 'my' && { backgroundColor: BRAND_COLOR + '20' }]}
                textStyle={[styles.filterChipText, callsScope === 'my' ? { color: BRAND_COLOR, fontWeight: '600' } : undefined]}
                showSelectedOverlay={false}
              >
                {t('phoneCalls.myCalls')}
              </Chip>
              <Chip
                selected={callsScope === 'all'}
                onPress={() => setCallsScope('all')}
                mode="flat"
                compact
                style={[styles.filterChip, callsScope === 'all' && { backgroundColor: BRAND_COLOR + '20' }]}
                textStyle={[styles.filterChipText, callsScope === 'all' ? { color: BRAND_COLOR, fontWeight: '600' } : undefined]}
                showSelectedOverlay={false}
              >
                {t('phoneCalls.allCalls')}
              </Chip>
            </View>
          )}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.filterRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
          >
            {(['all', 'answered', 'missed'] as FilterKey[]).map((f) => (
              <Chip
                key={f}
                selected={filter === f}
                onPress={() => setFilter(f)}
                mode="flat"
                compact
                style={[
                  styles.filterChip,
                  filter === f && { backgroundColor: BRAND_COLOR + '20' },
                ]}
                textStyle={[styles.filterChipText, filter === f ? { color: BRAND_COLOR, fontWeight: '600' } : undefined]}
                showSelectedOverlay={false}
              >
                {t(`phoneCalls.${f}`)}
              </Chip>
            ))}
          </ScrollView>

          <FlatList
            data={filteredCalls}
            renderItem={renderCallItem}
            keyExtractor={callKeyExtractor}
            contentContainerStyle={styles.list}
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

      {activeTab === 'rules' && (
        <FlatList
          data={rules}
          renderItem={renderRuleItem}
          keyExtractor={ruleKeyExtractor}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[BRAND_COLOR]} tintColor={BRAND_COLOR} />
          }
          ListEmptyComponent={<EmptyState icon="auto-fix" message={t('phoneCalls.noRules')} />}
          ListFooterComponent={
            <Button
              icon="plus"
              mode="outlined"
              onPress={openAddRule}
              style={styles.addRuleBtn}
              textColor={BRAND_COLOR}
            >
              {t('phoneCalls.addRule')}
            </Button>
          }
        />
      )}

      <RuleEditModal
        visible={ruleModalVisible}
        rule={editingRule}
        onDismiss={() => { setRuleModalVisible(false); setEditingRule(null); }}
        onSave={handleSaveRule}
        isRTL={isRTL}
        t={t}
        themeColors={theme.colors}
      />

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
          onDismiss={() => { setDialerVisible(false); setDialNumber(''); }}
          contentContainerStyle={[styles.dialerModal, { backgroundColor: theme.colors.surface }]}
        >
          <Text variant="titleLarge" style={{ textAlign: 'center', color: theme.colors.onSurface, fontWeight: '700', marginBottom: 16 }}>
            {t('phoneCalls.makeCall')}
          </Text>

          <TextInput
            value={dialNumber}
            onChangeText={setDialNumber}
            mode="outlined"
            placeholder={t('phoneCalls.enterPhoneNumber')}
            keyboardType="phone-pad"
            style={styles.dialInput}
            outlineColor={BRAND_COLOR + '40'}
            activeOutlineColor={BRAND_COLOR}
            left={<TextInput.Icon icon="phone" />}
            right={dialNumber ? <TextInput.Icon icon="close" onPress={() => setDialNumber('')} /> : undefined}
          />

          <View style={styles.dialPad}>
            {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['*', '0', '#']].map((row, ri) => (
              <View key={ri} style={styles.dialRow}>
                {row.map((digit) => (
                  <Pressable
                    key={digit}
                    onPress={() => setDialNumber((prev) => prev + digit)}
                    style={({ pressed }) => [
                      styles.dialKey,
                      { backgroundColor: pressed ? BRAND_COLOR + '20' : theme.colors.surfaceVariant },
                    ]}
                  >
                    <Text variant="headlineSmall" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>
                      {digit}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </View>

          <View style={styles.dialActions}>
            <Pressable
              onPress={() => setDialNumber((prev) => prev.slice(0, -1))}
              style={styles.dialBackspace}
            >
              <MaterialCommunityIcons name="backspace-outline" size={24} color={theme.colors.onSurfaceVariant} />
            </Pressable>

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

            {telSettings?.phoneNumbers?.length ? (
              <Pressable
                onPress={() => handleGambotDial(dialNumber)}
                disabled={!dialNumber.trim() || gambotCallActive}
                style={[
                  styles.dialCallBtn,
                  { backgroundColor: dialNumber.trim() && !gambotCallActive ? '#059669' : theme.colors.surfaceVariant },
                ]}
              >
                <MaterialCommunityIcons
                  name={gambotCallActive ? 'phone-ring' : 'phone-in-talk'}
                  size={28}
                  color={dialNumber.trim() && !gambotCallActive ? '#FFF' : theme.colors.onSurfaceVariant}
                />
              </Pressable>
            ) : (
              <View style={{ width: 48 }} />
            )}
          </View>

          {/* Call type labels */}
          {telSettings?.phoneNumbers?.length ? (
            <View style={styles.dialLabels}>
              <View style={{ width: 48 }} />
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', width: 64 }}>
                {t('phoneCalls.regularCall')}
              </Text>
              <Text variant="labelSmall" style={{ color: '#059669', textAlign: 'center', width: 64, fontWeight: '600' }}>
                {t('phoneCalls.gambotCall')}
              </Text>
            </View>
          ) : null}

          {/* Gambot call status indicator */}
          {gambotCallActive && (
            <View style={styles.gambotCallStatus}>
              <ActivityIndicator size="small" color="#059669" />
              <Text variant="bodySmall" style={{ color: '#059669', fontWeight: '600', marginStart: 8 }}>
                {gambotCallStatus === 'calling_agent'
                  ? t('phoneCalls.callingYourPhone')
                  : t('phoneCalls.connectingCustomer')
                }
              </Text>
            </View>
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
  tabs: { marginHorizontal: 16, marginTop: 12, marginBottom: 4 },
  scopeRow: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 8 },
  filterRow: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  filterChip: { borderRadius: 20, height: 32 },
  filterChipText: { fontSize: 13 },
  list: { paddingVertical: 8, paddingBottom: 100 },
  addRuleBtn: { marginHorizontal: 16, marginTop: 12, borderColor: BRAND_COLOR, borderRadius: 12 },
  fab: { position: 'absolute', bottom: 24, end: 20, borderRadius: 28 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  dialerModal: {
    margin: 20,
    borderRadius: 24,
    padding: 24,
    maxHeight: '90%',
  },
  dialInput: {
    marginBottom: 16,
    fontSize: 20,
    textAlign: 'center',
  },
  dialPad: {
    gap: 10,
    marginBottom: 16,
  },
  dialRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  dialKey: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
  },
  dialBackspace: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialCallBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialLabels: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
    marginTop: 6,
  },
  gambotCallStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#ecfdf5',
    borderRadius: 12,
  },
});
