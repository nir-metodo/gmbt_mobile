import React, { useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, Pressable, Platform } from 'react-native';
import { Text, TextInput, IconButton, Button, Chip, Menu, Portal, Modal, ActivityIndicator, useTheme, Divider } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuthStore } from '../../../../stores/authStore';
import { emailApi, EmailTemplate } from '../../../../services/api/email';
import { calendarApi, Connection } from '../../../../services/api/calendar';

const BRAND_COLOR = '#2e6155';

export default function EmailScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const { user } = useAuthStore();
  const isRTL = i18n.language === 'he';
  const textAlign = isRTL ? 'right' as const : 'left' as const;

  const [connections, setConnections] = useState<Connection[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  // Form
  const [connectionId, setConnectionId] = useState('');
  const [toEmails, setToEmails] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  // Menus
  const [showConnectionMenu, setShowConnectionMenu] = useState(false);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);

  const org = user?.organization || '';

  const loadData = useCallback(async () => {
    if (!org) return;
    try {
      const [conns, tmpls] = await Promise.all([
        calendarApi.getConnections(org),
        emailApi.getTemplates(org),
      ]);
      setConnections(conns);
      setTemplates(tmpls);
      if (conns.length > 0 && !connectionId) {
        setConnectionId(conns[0].id);
      }
    } catch (e) {
      console.error('Email load error:', e);
    } finally {
      setLoading(false);
    }
  }, [org]);

  useEffect(() => { loadData(); }, [loadData]);

  const getConnectionLabel = (connId: string) => {
    const c = connections.find(cn => cn.id === connId);
    return c ? `${c.provider === 'google' ? 'Google' : 'Microsoft'} — ${c.email}` : (isRTL ? 'בחר חיבור' : 'Select connection');
  };

  const handleSend = async () => {
    if (!connectionId) {
      Alert.alert(isRTL ? 'שגיאה' : 'Error', isRTL ? 'יש לבחור חיבור (Google/Microsoft)' : 'Please select a connection');
      return;
    }
    const emails = toEmails.split(',').map(e => e.trim()).filter(Boolean);
    if (emails.length === 0) {
      Alert.alert(isRTL ? 'שגיאה' : 'Error', isRTL ? 'יש למלא כתובת מייל' : 'Please enter email address');
      return;
    }
    if (!subject.trim()) {
      Alert.alert(isRTL ? 'שגיאה' : 'Error', isRTL ? 'יש למלא נושא' : 'Please enter subject');
      return;
    }

    setSending(true);
    try {
      await emailApi.send({
        organizationName: org,
        connectionId,
        toEmails: emails,
        subject: subject.trim(),
        message: message.trim(),
      });
      Alert.alert(
        isRTL ? 'נשלח בהצלחה' : 'Sent Successfully',
        isRTL ? 'המייל נשלח' : 'Email has been sent',
        [{ text: 'OK', onPress: () => { resetForm(); } }]
      );
    } catch (e: any) {
      Alert.alert(isRTL ? 'שגיאה' : 'Error', e?.message || 'Failed to send email');
    } finally {
      setSending(false);
    }
  };

  const resetForm = () => {
    setToEmails('');
    setSubject('');
    setMessage('');
  };

  const applyTemplate = (template: EmailTemplate) => {
    setSubject(template.subject || '');
    const body = template.body || '';
    const plainText = body.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    setMessage(plainText);
    setShowTemplateMenu(false);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={BRAND_COLOR} />
      </View>
    );
  }

  if (connections.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <IconButton icon="arrow-right" onPress={() => router.back()} />
          <Text style={styles.headerTitle}>{isRTL ? 'שליחת מייל' : 'Send Email'}</Text>
          <View style={{ width: 48 }} />
        </View>
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="email-off-outline" size={48} color="#9ca3af" />
          <Text style={styles.emptyText}>
            {isRTL ? 'אין חיבורי מייל (Google / Microsoft).\nיש להגדיר חיבור באזור האישי.' : 'No email connections (Google / Microsoft).\nPlease set up a connection in settings.'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <IconButton icon="arrow-right" onPress={() => router.back()} />
        <Text style={styles.headerTitle}>{isRTL ? 'שליחת מייל' : 'Send Email'}</Text>
        <IconButton icon="send" iconColor={BRAND_COLOR} onPress={handleSend} disabled={sending} />
      </View>

      <ScrollView style={styles.form} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Connection */}
        <Menu
          visible={showConnectionMenu}
          onDismiss={() => setShowConnectionMenu(false)}
          anchor={
            <Pressable onPress={() => setShowConnectionMenu(true)}>
              <View pointerEvents="none">
                <TextInput
                  label={isRTL ? 'שולח (חיבור)' : 'From (Connection)'}
                  value={getConnectionLabel(connectionId)}
                  mode="outlined"
                  editable={false}
                  style={[styles.formInput, { textAlign }]}
                  outlineColor={theme.colors.outline}
                  activeOutlineColor={BRAND_COLOR}
                  right={<TextInput.Icon icon="chevron-down" />}
                  left={<TextInput.Icon icon="email-outline" />}
                />
              </View>
            </Pressable>
          }
        >
          {connections.map(conn => (
            <Menu.Item
              key={conn.id}
              title={`${conn.provider === 'google' ? 'Google' : 'Microsoft'} — ${conn.email}`}
              onPress={() => { setConnectionId(conn.id); setShowConnectionMenu(false); }}
            />
          ))}
        </Menu>

        {/* To */}
        <TextInput
          label={isRTL ? 'אל (מיילים, מופרדים בפסיק)' : 'To (emails, comma-separated)'}
          value={toEmails}
          onChangeText={setToEmails}
          mode="outlined"
          keyboardType="email-address"
          autoCapitalize="none"
          style={[styles.formInput, { textAlign }]}
          outlineColor={theme.colors.outline}
          activeOutlineColor={BRAND_COLOR}
          left={<TextInput.Icon icon="account-outline" />}
        />

        {/* Subject */}
        <TextInput
          label={isRTL ? 'נושא' : 'Subject'}
          value={subject}
          onChangeText={setSubject}
          mode="outlined"
          style={[styles.formInput, { textAlign }]}
          outlineColor={theme.colors.outline}
          activeOutlineColor={BRAND_COLOR}
        />

        {/* Template selector */}
        {templates.length > 0 && (
          <Menu
            visible={showTemplateMenu}
            onDismiss={() => setShowTemplateMenu(false)}
            anchor={
              <Button
                mode="outlined"
                onPress={() => setShowTemplateMenu(true)}
                icon="file-document-outline"
                textColor={BRAND_COLOR}
                style={styles.templateBtn}
              >
                {isRTL ? 'בחר תבנית' : 'Use Template'}
              </Button>
            }
          >
            {templates.map(tmpl => (
              <Menu.Item
                key={tmpl.id}
                title={tmpl.name}
                onPress={() => applyTemplate(tmpl)}
              />
            ))}
          </Menu>
        )}

        {/* Message body */}
        <TextInput
          label={isRTL ? 'תוכן ההודעה' : 'Message'}
          value={message}
          onChangeText={setMessage}
          mode="outlined"
          multiline
          numberOfLines={8}
          style={[styles.formInput, { textAlign, minHeight: 200 }]}
          outlineColor={theme.colors.outline}
          activeOutlineColor={BRAND_COLOR}
        />

        {/* Send button */}
        <Button
          mode="contained"
          onPress={handleSend}
          loading={sending}
          disabled={sending}
          buttonColor={BRAND_COLOR}
          textColor="white"
          icon="send"
          style={styles.sendBtn}
          contentStyle={{ flexDirection: isRTL ? 'row-reverse' : 'row' }}
        >
          {isRTL ? 'שלח מייל' : 'Send Email'}
        </Button>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    paddingHorizontal: 8,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: '700', color: '#1f2937', textAlign: 'center' },
  form: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
  formInput: { marginBottom: 12, backgroundColor: 'white' },
  templateBtn: { marginBottom: 12, borderColor: BRAND_COLOR, borderRadius: 8, alignSelf: 'flex-start' },
  sendBtn: { marginTop: 8, borderRadius: 8, paddingVertical: 4 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyText: { fontSize: 15, color: '#9ca3af', marginTop: 12, textAlign: 'center', lineHeight: 22 },
});
