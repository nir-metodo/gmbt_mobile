import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Linking,
  Share,
  Image,
} from 'react-native';
import {
  Text,
  Chip,
  ActivityIndicator,
  Button,
  IconButton,
  Divider,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { esignatureApi } from '../../../../services/api/esignature';
import { formatDate } from '../../../../utils/formatters';
import { borderRadius } from '../../../../constants/theme';
import type { ESignatureDocument, ESignatureSigner } from '../../../../types';

const STATUS_COLORS: Record<string, string> = {
  pending: '#FF9800',
  partiallySigned: '#2196F3',
  signed: '#4CAF50',
  expired: '#F44336',
  cancelled: '#9E9E9E',
};

const STATUS_ICONS: Record<string, string> = {
  pending: 'clock-outline',
  partiallySigned: 'progress-check',
  signed: 'check-decagram',
  expired: 'clock-alert-outline',
  cancelled: 'close-circle-outline',
};

function getStatusColor(status: string): string {
  return STATUS_COLORS[status] || '#9E9E9E';
}

export default function ESignatureDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t } = useTranslation();

  const user = useAuthStore((s) => s.user);

  const [document, setDocument] = useState<ESignatureDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchDocument = useCallback(async () => {
    if (!user?.organization || !id) return;
    try {
      setError(null);
      const result = await esignatureApi.getDocumentById(user.organization, id);
      if (result) {
        setDocument(result);
      } else {
        const all = await esignatureApi.getDocuments(user.organization);
        const found = (Array.isArray(all) ? all : []).find((d) => d.id === id);
        if (found) setDocument(found);
        else setError(t('common.noResults'));
      }
    } catch (err: any) {
      try {
        const all = await esignatureApi.getDocuments(user.organization);
        const found = (Array.isArray(all) ? all : []).find((d) => d.id === id);
        if (found) setDocument(found);
        else setError(err.message || t('errors.generic'));
      } catch {
        setError(err.message || t('errors.generic'));
      }
    } finally {
      setLoading(false);
    }
  }, [user?.organization, id, t]);

  useEffect(() => {
    fetchDocument();
  }, [fetchDocument]);

  const orgName = user?.organization || '';

  const getSigningUrl = (signer: ESignatureSigner) => {
    if (signer.signingToken) {
      return `https://gambot.co.il/${orgName}/esignature/${id}/sign/${signer.signingToken}`;
    }
    if (document?.token) {
      return `https://app.gambot.io/sign/${document.token}`;
    }
    return null;
  };

  const handleCopyLink = useCallback(async (url: string) => {
    try {
      await Clipboard.setStringAsync(url);
      Alert.alert(t('common.success'), t('esignature.linkCopied'));
    } catch {
      await Share.share({ message: url });
    }
  }, [t]);

  const handleSendWhatsApp = useCallback(async (phone: string, signerName: string, url: string) => {
    try {
      const message = encodeURIComponent(
        `${t('esignature.title')}: ${document?.documentName || document?.title}\n${t('esignature.signHere')}: ${url}`
      );
      const cleanPhone = phone.replace(/\D/g, '');
      await Linking.openURL(`whatsapp://send?phone=${cleanPhone}&text=${message}`);
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
    }
  }, [document, t]);

  const handleShareDocument = useCallback(async () => {
    if (!document) return;
    try {
      const link = document.token
        ? `https://app.gambot.io/sign/${document.token}`
        : document.documentName || document.title;
      await Share.share({ message: `${document.documentName || document.title}\n${link}` });
    } catch {
      // cancelled
    }
  }, [document]);

  const handleViewDocument = useCallback(async () => {
    const url = document?.documentUrl || document?.originalFileUrl;
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(t('common.error'), t('errors.generic'));
    }
  }, [document, t]);

  const handleDownloadSigned = useCallback(async () => {
    const url = document?.signedFileUrl || document?.documentUrl;
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(t('common.error'), t('errors.generic'));
    }
  }, [document, t]);

  const handleSendReminder = useCallback(async () => {
    if (!user?.organization || !id) return;
    Alert.alert(
      t('esignature.sendReminder'),
      t('esignature.sendReminderConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.send'),
          onPress: async () => {
            setActionLoading('reminder');
            try {
              await esignatureApi.sendReminder(user.organization, id);
              Alert.alert(t('common.success'), t('esignature.reminderSent'));
            } catch (err: any) {
              Alert.alert(t('common.error'), err.message || t('errors.generic'));
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]
    );
  }, [user?.organization, id, t]);

  const handleCancelDocument = useCallback(async () => {
    if (!user?.organization || !id) return;
    Alert.alert(
      t('esignature.cancelDocument'),
      t('esignature.cancelDocumentConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          style: 'destructive',
          onPress: async () => {
            setActionLoading('cancel');
            try {
              await esignatureApi.deleteDocument(user.organization, id);
              router.back();
            } catch (err: any) {
              Alert.alert(t('common.error'), err.message || t('errors.generic'));
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]
    );
  }, [user?.organization, id, t, router]);

  const handleDeleteDocument = useCallback(async () => {
    if (!user?.organization || !id) return;
    Alert.alert(
      t('esignature.deleteDocument'),
      t('esignature.deleteDocumentConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            setActionLoading('delete');
            try {
              await esignatureApi.deleteDocument(user.organization, id);
              router.back();
            } catch (err: any) {
              Alert.alert(t('common.error'), err.message || t('errors.generic'));
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]
    );
  }, [user?.organization, id, t, router]);

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (error || !document) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.errorHeader, { paddingTop: insets.top + 8, backgroundColor: theme.custom.headerBackground }]}>
          <IconButton icon={isRTL ? 'arrow-right' : 'arrow-left'} iconColor={theme.custom.headerText} onPress={() => router.back()} />
        </View>
        <MaterialCommunityIcons
          name="alert-circle-outline"
          size={64}
          color={theme.colors.onSurfaceVariant}
          style={{ opacity: 0.4 }}
        />
        <Text variant="titleMedium" style={{ color: theme.colors.onSurface, marginTop: 12 }}>
          {error || t('common.noResults')}
        </Text>
        <Button mode="text" onPress={fetchDocument} style={{ marginTop: 8 }}>
          {t('common.retry')}
        </Button>
      </View>
    );
  }

  const statusColor = getStatusColor(document.status);
  const statusIcon = STATUS_ICONS[document.status] || 'file-document';
  const isSigned = document.status === 'signed';
  const isPending = document.status === 'pending' || document.status === 'partiallySigned';
  const isExpired = document.status === 'expired';
  const signers: ESignatureSigner[] = document.signers && document.signers.length > 0
    ? document.signers
    : document.contactName
      ? [{ signerRole: 'signer1', signerName: document.contactName, signerPhone: document.phoneNumber, status: isSigned ? 'signed' : 'pending', signingToken: document.token, signedAt: document.signedAt }]
      : [];

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { backgroundColor: theme.custom.headerBackground, paddingTop: insets.top + 4 },
        ]}
      >
        <View style={[styles.headerRow, { flexDirection }]}>
          <IconButton
            icon={isRTL ? 'arrow-right' : 'arrow-left'}
            iconColor={theme.custom.headerText}
            size={24}
            onPress={() => router.back()}
          />
          <Text
            variant="titleMedium"
            numberOfLines={1}
            style={[styles.headerTitleText, { flex: 1, textAlign }]}
          >
            {document.documentName || document.title}
          </Text>
          <IconButton
            icon="share-variant"
            iconColor={theme.custom.headerText}
            size={22}
            onPress={handleShareDocument}
          />
        </View>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Status Banner */}
        <View
          style={[
            styles.statusBanner,
            { backgroundColor: `${statusColor}12`, borderColor: `${statusColor}40` },
          ]}
        >
          <View style={styles.statusBannerContent}>
            <View style={[styles.statusIconWrap, { backgroundColor: `${statusColor}20` }]}>
              <MaterialCommunityIcons name={statusIcon as any} size={36} color={statusColor} />
            </View>
            <Chip
              textStyle={[styles.statusBadgeText, { color: statusColor }]}
              style={[styles.statusBadge, { backgroundColor: `${statusColor}20` }]}
              icon={() => (
                <MaterialCommunityIcons name={statusIcon as any} size={16} color={statusColor} />
              )}
            >
              {t(`esignature.${document.status}`)}
            </Chip>
            <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', textAlign: 'center' }}>
              {document.documentName || document.title}
            </Text>
          </View>
        </View>

        {/* Document Info */}
        <View
          style={[
            styles.sectionCard,
            { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
          ]}
        >
          <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface, textAlign }]}>
            {t('esignature.documentInfo')}
          </Text>

          {/* Created date */}
          <View style={[styles.infoRow, { flexDirection }]}>
            <View style={[styles.detailIcon, { backgroundColor: '#2196F318' }]}>
              <MaterialCommunityIcons name="calendar-plus" size={20} color="#2196F3" />
            </View>
            <View style={[styles.detailContent, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {t('esignature.createdDate')}
              </Text>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '500' }}>
                {formatDate(document.createdAt)}
              </Text>
            </View>
          </View>

          {/* Expires date */}
          {document.expiresAt ? (
            <>
              <Divider style={{ marginVertical: 10, backgroundColor: theme.colors.outlineVariant }} />
              <View style={[styles.infoRow, { flexDirection }]}>
                <View style={[styles.detailIcon, { backgroundColor: isExpired ? '#F4433618' : '#FF980018' }]}>
                  <MaterialCommunityIcons
                    name="calendar-clock"
                    size={20}
                    color={isExpired ? '#F44336' : '#FF9800'}
                  />
                </View>
                <View style={[styles.detailContent, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {t('esignature.expiresDate')}
                  </Text>
                  <Text
                    variant="bodyMedium"
                    style={{
                      color: isExpired ? '#F44336' : theme.colors.onSurface,
                      fontWeight: '500',
                    }}
                  >
                    {formatDate(document.expiresAt)}
                    {isExpired ? ` (${t('esignature.expired')})` : ''}
                  </Text>
                </View>
              </View>
            </>
          ) : null}

          {/* Status */}
          <Divider style={{ marginVertical: 10, backgroundColor: theme.colors.outlineVariant }} />
          <View style={[styles.infoRow, { flexDirection }]}>
            <View style={[styles.detailIcon, { backgroundColor: `${statusColor}18` }]}>
              <MaterialCommunityIcons name={statusIcon as any} size={20} color={statusColor} />
            </View>
            <View style={[styles.detailContent, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {t('esignature.status')}
              </Text>
              <Text variant="bodyMedium" style={{ color: statusColor, fontWeight: '600' }}>
                {t(`esignature.${document.status}`)}
              </Text>
            </View>
          </View>
        </View>

        {/* Signers List */}
        {signers.length > 0 && (
          <View
            style={[
              styles.sectionCard,
              { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
            ]}
          >
            <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface, textAlign }]}>
              {t('esignature.signerInfo')} ({signers.filter(s => s.status === 'signed').length}/{signers.length})
            </Text>

            {signers.map((signer, index) => {
              const signerStatusColor = signer.status === 'signed' ? '#4CAF50' : '#FF9800';
              const signerUrl = getSigningUrl(signer);

              return (
                <View key={index}>
                  {index > 0 && (
                    <Divider style={{ marginVertical: 12, backgroundColor: theme.colors.outlineVariant }} />
                  )}

                  {/* Signer info */}
                  <View style={[styles.signerRow, { flexDirection }]}>
                    <View style={[styles.signerAvatar, { backgroundColor: `${signerStatusColor}18` }]}>
                      <MaterialCommunityIcons
                        name={signer.status === 'signed' ? 'check-decagram' : 'account'}
                        size={20}
                        color={signerStatusColor}
                      />
                    </View>
                    <View style={[styles.detailContent, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
                      <View style={[{ flexDirection, alignItems: 'center', gap: 8 }]}>
                        <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600', flex: 1, textAlign }}>
                          {signer.signerName}
                        </Text>
                        <Chip
                          compact
                          textStyle={{ fontSize: 10, fontWeight: '600', color: signerStatusColor }}
                          style={{ height: 22, backgroundColor: `${signerStatusColor}18` }}
                        >
                          {t(`esignature.signer_${signer.status}`)}
                        </Chip>
                      </View>
                      {signer.signerEmail ? (
                        <View style={[styles.signerMeta, { flexDirection }]}>
                          <MaterialCommunityIcons name="email-outline" size={13} color={theme.colors.onSurfaceVariant} />
                          <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>{signer.signerEmail}</Text>
                        </View>
                      ) : null}
                      {signer.signerPhone ? (
                        <View style={[styles.signerMeta, { flexDirection }]}>
                          <MaterialCommunityIcons name="phone-outline" size={13} color={theme.colors.onSurfaceVariant} />
                          <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>{signer.signerPhone}</Text>
                        </View>
                      ) : null}
                      {signer.signedAt ? (
                        <View style={[styles.signerMeta, { flexDirection }]}>
                          <MaterialCommunityIcons name="calendar-check" size={13} color="#4CAF50" />
                          <Text variant="labelSmall" style={{ color: '#4CAF50', fontWeight: '500' }}>
                            {formatDate(signer.signedAt)}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>

                  {/* Signing links for pending signers */}
                  {signer.status === 'pending' && signerUrl && isPending && (
                    <View style={[styles.signerActions, { flexDirection }]}>
                      <Button
                        mode="outlined"
                        icon="content-copy"
                        compact
                        onPress={() => handleCopyLink(signerUrl)}
                        style={[styles.signerActionBtn, { borderColor: theme.colors.primary }]}
                        textColor={theme.colors.primary}
                        labelStyle={{ fontSize: 12 }}
                      >
                        {t('esignature.copyLink')}
                      </Button>
                      {signer.signerPhone && (
                        <Button
                          mode="contained"
                          icon="whatsapp"
                          compact
                          onPress={() => handleSendWhatsApp(signer.signerPhone!, signer.signerName, signerUrl)}
                          style={[styles.signerActionBtn, { backgroundColor: '#25D366' }]}
                          textColor="#FFFFFF"
                          labelStyle={{ fontSize: 12 }}
                        >
                          WhatsApp
                        </Button>
                      )}
                    </View>
                  )}

                  {/* Show signature image if signed */}
                  {signer.status === 'signed' && signer.signatureUrl && (
                    <View style={[styles.signatureImageWrap, { borderColor: theme.colors.outlineVariant, marginTop: 8 }]}>
                      <Image
                        source={{ uri: signer.signatureUrl }}
                        style={styles.signatureImage}
                        resizeMode="contain"
                      />
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* Document preview */}
        {(document.documentUrl || document.originalFileUrl) ? (
          <Pressable
            onPress={handleViewDocument}
            style={[
              styles.previewCard,
              { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
            ]}
          >
            <View style={[styles.previewInner, { flexDirection }]}>
              <View style={[styles.previewIcon, { backgroundColor: `${theme.colors.primary}15` }]}>
                <MaterialCommunityIcons name="file-document-outline" size={28} color={theme.colors.primary} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="titleSmall" style={{ color: theme.colors.onSurface, fontWeight: '600', textAlign }}>
                  {t('esignature.viewDocument')}
                </Text>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
                  {t('esignature.tapToOpen')}
                </Text>
              </View>
              <MaterialCommunityIcons
                name={isRTL ? 'chevron-left' : 'chevron-right'}
                size={22}
                color={theme.colors.onSurfaceVariant}
              />
            </View>
          </Pressable>
        ) : null}

        {/* Download signed document */}
        {isSigned && document.signedFileUrl ? (
          <Pressable
            onPress={handleDownloadSigned}
            style={[
              styles.previewCard,
              { backgroundColor: theme.custom.cardBackground, borderColor: '#4CAF5040' },
            ]}
          >
            <View style={[styles.previewInner, { flexDirection }]}>
              <View style={[styles.previewIcon, { backgroundColor: '#4CAF5015' }]}>
                <MaterialCommunityIcons name="download" size={28} color="#4CAF50" />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="titleSmall" style={{ color: '#4CAF50', fontWeight: '600', textAlign }}>
                  {t('esignature.downloadSigned')}
                </Text>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
                  {t('esignature.downloadSignedDesc')}
                </Text>
              </View>
              <MaterialCommunityIcons
                name="download"
                size={22}
                color="#4CAF50"
              />
            </View>
          </Pressable>
        ) : null}

        {/* Actions */}
        <View style={styles.actionsContainer}>
          {isPending && (
            <Button
              mode="contained"
              icon="bell-ring"
              onPress={handleSendReminder}
              loading={actionLoading === 'reminder'}
              disabled={!!actionLoading}
              style={[styles.actionButton, { backgroundColor: '#FF9800' }]}
              textColor="#FFFFFF"
              contentStyle={styles.actionButtonContent}
            >
              {t('esignature.sendReminder')}
            </Button>
          )}

          {isPending && (
            <Button
              mode="outlined"
              icon="cancel"
              onPress={handleCancelDocument}
              loading={actionLoading === 'cancel'}
              disabled={!!actionLoading}
              style={[styles.actionButton, { borderColor: '#F44336' }]}
              textColor="#F44336"
              contentStyle={styles.actionButtonContent}
            >
              {t('esignature.cancelDocument')}
            </Button>
          )}

          <Button
            mode="outlined"
            icon="delete"
            onPress={handleDeleteDocument}
            loading={actionLoading === 'delete'}
            disabled={!!actionLoading}
            style={[styles.actionButton, { borderColor: theme.colors.error }]}
            textColor={theme.colors.error}
            contentStyle={styles.actionButtonContent}
          >
            {t('esignature.deleteDocument')}
          </Button>
        </View>

        <View style={{ height: insets.bottom + 24 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 8,
  },
  header: {
    paddingBottom: 4,
  },
  headerRow: {
    alignItems: 'center',
  },
  headerTitleText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 17,
  },
  body: { flex: 1 },
  bodyContent: {
    padding: 16,
    gap: 12,
  },
  statusBanner: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: 20,
  },
  statusBannerContent: {
    alignItems: 'center',
    gap: 12,
  },
  statusIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadge: {
    height: 32,
    borderRadius: 16,
  },
  statusBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  sectionCard: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: 16,
  },
  sectionTitle: {
    fontWeight: '700',
    marginBottom: 12,
  },
  infoRow: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 2,
  },
  detailIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailContent: {
    flex: 1,
    gap: 2,
  },
  signerRow: {
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 2,
  },
  signerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  signerMeta: {
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  signerActions: {
    gap: 8,
    marginTop: 10,
    marginLeft: 52,
  },
  signatureImageWrap: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    marginLeft: 52,
  },
  signatureImage: {
    width: '100%',
    height: 80,
  },
  previewCard: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  previewInner: {
    padding: 16,
    alignItems: 'center',
    gap: 12,
  },
  previewIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionsContainer: {
    gap: 10,
    marginTop: 4,
  },
  actionButton: {
    borderRadius: borderRadius.md,
  },
  actionButtonContent: {
    paddingVertical: 6,
  },
});
