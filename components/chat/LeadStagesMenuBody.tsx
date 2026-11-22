import React, { useMemo, useState } from 'react';
import { View, Pressable, ScrollView } from 'react-native';
import { Text, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme } from '../../hooks/useAppTheme';

// Body of the chat-header lead-stage menu. A contact can have several leads: the ACTIVE one (first still-open lead)
// is expanded by default, the previous ones are collapsed rows under "לידים קודמים". Only ONE lead is expanded at a
// time — opening another one collapses the current — and the whole list is height-limited and scrolls, so the menu
// never grows past the screen no matter how many leads there are. With a single lead it is just that lead's stages.
interface Props {
  leads: any[];
  activeLeadId: string;
  stages: any[];
  // Same helper the screen uses: stage id/name → the stage's configured display name.
  resolveStageName: (stages: any[], rec: any) => string;
  isRTL: boolean;
  onPickStage: (stage: any, lead: any) => void;
  onOpen: (lead: any) => void;
}

const stageId = (s: any) => String(s?.id || s?.Id || '');
const stageName = (s: any) => String(s?.name || s?.Name || s?.stageName || '');

export default function LeadStagesMenuBody({ leads, activeLeadId, stages, resolveStageName, isRTL, onPickStage, onOpen }: Props) {
  const theme = useAppTheme();
  const [expandedId, setExpandedId] = useState<string>(activeLeadId);

  const active = leads.find((l) => l.id === activeLeadId) || leads[0];
  const previous = useMemo(
    () => leads
      .filter((l) => l.id !== (active?.id))
      .sort((a, b) => String(b.createdOn || b.CreatedOn || '').localeCompare(String(a.createdOn || a.CreatedOn || ''))),
    [leads, active?.id],
  );
  if (!active) return null;

  const renderStages = (lead: any) => {
    const current = String(lead.stageId || lead.StageId || '').toLowerCase();
    return (
      <View>
        {stages.map((s) => {
          const sid = stageId(s);
          const isCurrent = sid.toLowerCase() === current;
          return (
            <Pressable
              key={sid}
              onPress={() => onPickStage(s, lead)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingVertical: 10,
                paddingHorizontal: 16,
                backgroundColor: pressed ? theme.colors.surfaceVariant : (isCurrent ? (theme.dark ? '#1e3a32' : '#f0fdf4') : 'transparent'),
              })}
            >
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s?.color || s?.Color || '#9ca3af' }} />
              <Text style={{ flex: 1, fontSize: 14, color: theme.colors.onSurface, fontWeight: isCurrent ? '700' : '400' }} numberOfLines={1}>
                {stageName(s)}
              </Text>
              {isCurrent ? <MaterialCommunityIcons name="check" size={16} color={theme.colors.primary} /> : null}
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => onOpen(lead)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingVertical: 10,
            paddingHorizontal: 16,
            backgroundColor: pressed ? theme.colors.surfaceVariant : 'transparent',
          })}
        >
          <MaterialCommunityIcons name="open-in-new" size={16} color={theme.colors.onSurfaceVariant} />
          <Text style={{ fontSize: 13, color: theme.colors.onSurfaceVariant }}>{isRTL ? 'פתח רשומת ליד' : 'Open lead'}</Text>
        </Pressable>
      </View>
    );
  };

  // Single lead: exactly the old menu (stages + open), no accordion chrome.
  if (previous.length === 0) {
    return (
      <ScrollView style={{ maxHeight: 340 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {renderStages(active)}
      </ScrollView>
    );
  }

  const renderLeadRow = (lead: any, isActive: boolean) => {
    const open = expandedId === lead.id;
    const label = resolveStageName(stages, lead) || lead.stageName || lead.stage || '';
    const st = stages.find((s) => stageId(s).toLowerCase() === String(lead.stageId || '').toLowerCase());
    const color = st?.color || st?.Color || '#6b7280';
    return (
      <View key={lead.id}>
        <Pressable
          onPress={() => setExpandedId(open ? '' : lead.id)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingVertical: 10,
            paddingHorizontal: 16,
            backgroundColor: pressed ? theme.colors.surfaceVariant : (open ? (theme.dark ? 'rgba(255,255,255,0.05)' : '#f9fafb') : 'transparent'),
          })}
        >
          <MaterialCommunityIcons
            name={open ? 'chevron-down' : (isRTL ? 'chevron-left' : 'chevron-right')}
            size={18}
            color={theme.colors.onSurfaceVariant}
          />
          <Text style={{ flex: 1, fontSize: 13.5, color: theme.colors.onSurface, fontWeight: isActive ? '700' : '400' }} numberOfLines={1}>
            {lead.title || (isRTL ? 'ליד' : 'Lead')}
          </Text>
          {label ? (
            <View style={{ backgroundColor: `${color}22`, borderColor: `${color}66`, borderWidth: 1, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1, maxWidth: 120 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color }} numberOfLines={1}>{label}</Text>
            </View>
          ) : null}
        </Pressable>
        {open ? (
          <View style={{ backgroundColor: theme.dark ? 'rgba(255,255,255,0.03)' : '#fafafa' }}>{renderStages(lead)}</View>
        ) : null}
      </View>
    );
  };

  return (
    <ScrollView style={{ maxHeight: 340 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
      {renderLeadRow(active, true)}
      <Divider />
      <Text style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 2, fontSize: 11, fontWeight: '700', color: theme.colors.onSurfaceVariant }}>
        {isRTL ? `לידים קודמים (${previous.length})` : `Previous leads (${previous.length})`}
      </Text>
      {previous.map((l) => renderLeadRow(l, false))}
    </ScrollView>
  );
}
