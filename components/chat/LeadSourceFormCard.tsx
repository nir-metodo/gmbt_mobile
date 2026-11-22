import React from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme } from '../../hooks/useAppTheme';

// Lead-form submission (Facebook / Instagram / website) shown in the chat like an incoming message.
// Mirrors the web LeadSourceFormBubble. Read-only timeline entry (TimelineType "lead_source_form") —
// not a real chat message, so it doesn't open the 24h window or trigger the bot.
const PLATFORM_STYLE = {
  Instagram: { icon: 'instagram', color: '#e1306c', bg: '#fdf2f8' },
  Facebook: { icon: 'facebook', color: '#1877f2', bg: '#eff6ff' },
  Website: { icon: 'web', color: '#2e6155', bg: '#f0fdf4' },
} as const;

interface Props {
  entry: any;
  isRTL: boolean;
}

export default function LeadSourceFormCard({ entry, isRTL }: Props) {
  const theme = useAppTheme();
  const dark = !!theme.dark;

  const isWebForm = entry?.sourceKind === 'web';
  // Click-to-WhatsApp ad: the person messaged us straight from a Facebook / Instagram ad (no form).
  const isCtwa = entry?.sourceKind === 'ctwa';
  const platformName: keyof typeof PLATFORM_STYLE = isWebForm
    ? 'Website'
    : String(entry?.platform || '').toLowerCase() === 'instagram'
      ? 'Instagram'
      : 'Facebook';
  const ps = PLATFORM_STYLE[platformName];

  const answers: any[] = Array.isArray(entry?.formAnswers) ? entry.formAnswers : [];
  const sourceInfo: any[] = Array.isArray(entry?.sourceInfo) ? entry.sourceInfo : [];

  const phone = entry?.phone ? `+${String(entry.phone).replace(/^\+/, '')}` : '';
  const contactRows: [string, string][] = ([
    ['account-outline', entry?.fullName],
    ['phone-outline', phone],
    ['email-outline', entry?.email],
    ['map-marker-outline', entry?.city],
  ] as [string, any][]).filter(([, v]) => !!v) as [string, string][];

  const title = isCtwa
    ? (isRTL ? `הגיע/ה ממודעה ב-${platformName} (CTWA)` : `Came from a ${platformName} ad (CTWA)`)
    : isWebForm
      ? (isRTL ? 'מילא/ה טופס באתר' : 'Filled a website form')
      : (isRTL ? `מילא/ה טופס ב-${platformName}` : `Filled a ${platformName} form`);
  const subtitle = [entry?.formName, entry?.adName].filter(Boolean).join(' · ');

  const textAlign = isRTL ? 'right' : 'left';
  const rowDir = isRTL ? 'row-reverse' : 'row';
  const cardBg = dark ? '#1f2937' : '#ffffff';
  const border = dark ? '#374151' : '#e5e7eb';
  const divider = dark ? '#374151' : '#f3f4f6';
  const textMain = dark ? '#f9fafb' : '#111827';
  const textSub = dark ? '#9ca3af' : '#6b7280';
  const chipBg = dark ? '#374151' : '#f3f4f6';
  const chipText = dark ? '#e5e7eb' : '#374151';

  return (
    <View
      style={{
        width: '100%',
        backgroundColor: cardBg,
        borderWidth: 1,
        borderColor: border,
        ...(isRTL ? { borderRightWidth: 4, borderRightColor: ps.color } : { borderLeftWidth: 4, borderLeftColor: ps.color }),
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      {/* Header: platform + form name */}
      <View
        style={{
          flexDirection: rowDir,
          alignItems: 'center',
          gap: 10,
          paddingVertical: 10,
          paddingHorizontal: 14,
          backgroundColor: dark ? 'rgba(255,255,255,0.05)' : ps.bg,
          borderBottomWidth: 1,
          borderBottomColor: divider,
        }}
      >
        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
          <MaterialCommunityIcons name={ps.icon as any} size={18} color={ps.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13.5, fontWeight: '700', color: textMain, textAlign }}>{title}</Text>
          {subtitle ? <Text style={{ fontSize: 11.5, color: textSub, textAlign }}>{subtitle}</Text> : null}
        </View>
      </View>

      <View style={{ paddingTop: 10, paddingHorizontal: 14, paddingBottom: 12 }}>
        {isCtwa ? (
          <>
            {entry?.headline ? <Text style={{ fontSize: 14, fontWeight: '700', color: textMain, textAlign }}>{entry.headline}</Text> : null}
            {entry?.adBody ? <Text style={{ fontSize: 12.5, color: textSub, textAlign }}>{entry.adBody}</Text> : null}
          </>
        ) : (
          <Text style={{ fontSize: 14, fontWeight: '600', color: textMain, textAlign, marginBottom: answers.length ? 8 : 2 }}>
            {isRTL ? 'היי! השלמתי את הטופס שלך' : 'Hi! I completed your form'}
          </Text>
        )}

        {/* Questions & answers */}
        {answers.map((a, i) => (
          <View
            key={i}
            style={{
              paddingVertical: 6,
              borderTopWidth: 1,
              borderTopColor: divider,
              borderStyle: i === 0 ? 'solid' : 'dashed',
            }}
          >
            <Text style={{ fontSize: 12, color: textSub, textAlign }}>{a?.label}</Text>
            <Text style={{ fontSize: 14, fontWeight: '700', color: textMain, textAlign }}>{String(a?.value ?? '')}</Text>
          </View>
        ))}

        {/* Contact details */}
        {contactRows.length > 0 ? (
          <View
            style={{
              flexDirection: rowDir,
              flexWrap: 'wrap',
              gap: 6,
              marginTop: 8,
              paddingTop: 10,
              borderTopWidth: 1,
              borderTopColor: divider,
            }}
          >
            {contactRows.map(([icon, val], i) => (
              <View
                key={i}
                style={{
                  flexDirection: rowDir,
                  alignItems: 'center',
                  gap: 6,
                  paddingVertical: 4,
                  paddingHorizontal: 10,
                  borderRadius: 999,
                  backgroundColor: chipBg,
                  maxWidth: '100%',
                }}
              >
                <MaterialCommunityIcons name={icon as any} size={13} color={textSub} />
                <Text style={{ fontSize: 12.5, color: chipText, flexShrink: 1 }}>{val}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Source info (website forms: landing page, referrer, UTM...) */}
        {sourceInfo.length > 0 ? (
          <View style={{ marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: border, borderStyle: 'dashed' }}>
            <Text style={{ fontSize: 11, color: textSub, fontWeight: '700', marginBottom: 3, textAlign }}>
              {isRTL ? '📍 מידע על המקור' : '📍 Source info'}
            </Text>
            {sourceInfo.map((s, i) => (
              <Text key={i} style={{ fontSize: 12, color: textSub, textAlign }}>
                {s?.label}: {String(s?.value ?? '')}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}
