import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Linking,
  Share,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from 'react-native';
import {
  Text,
  TextInput,
  Button,
  IconButton,
  Chip,
  Divider,
  ActivityIndicator,
  SegmentedButtons,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { esignatureApi } from '../../../../services/api/esignature';
import { borderRadius } from '../../../../constants/theme';
import { withAlpha } from '../../../../utils/formatters';

interface Signer {
  signerRole: string;
  signerName: string;
  signerEmail: string;
  signerPhone: string;
}

interface CreatedSigner {
  signerName: string;
  signerEmail?: string;
  signerPhone?: string;
  signingToken?: string;
  status: string;
}

export default function CreateESignatureScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t } = useTranslation();

  const user = useAuthStore((s) => s.user);

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1 - Document Details
  const [documentName, setDocumentName] = useState('');
  const [contactName, setContactName] = useState('');
  const [uploadedFile, setUploadedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [language, setLanguage] = useState<string>(user?.language === 'he' ? 'he' : 'en');
  const [expiresInDays, setExpiresInDays] = useState('30');

  // Step 2 - Signers
  const [signers, setSigners] = useState<Signer[]>([
    { signerRole: 'signer1', signerName: '', signerEmail: '', signerPhone: '' },
  ]);
  const [sequentialSigning, setSequentialSigning] = useState(false);

  // Step 3 - Result
  const [createdDocument, setCreatedDocument] = useState<any>(null);

  const handlePickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        setUploadedFile(file);
        if (!documentName) {
          const name = file.name?.replace(/\.[^.]+$/, '') || '';
          setDocumentName(name);
        }
      }
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
    }
  }, [documentName, t]);

  const handleAddSigner = useCallback(() => {
    setSigners((prev) => [
      ...prev,
      {
        signerRole: `signer${prev.length + 1}`,
        signerName: '',
        signerEmail: '',
        signerPhone: '',
      },
    ]);
  }, []);

  const handleRemoveSigner = useCallback((index: number) => {
    setSigners((prev) => {
      if (prev.length <= 1) {
        Alert.alert(t('esignature.needAtLeastOneSigner'));
        return prev;
      }
      return prev.filter((_, i) => i !== index);
    });
  }, [t]);

  const handleUpdateSigner = useCallback((index: number, field: keyof Signer, value: string) => {
    setSigners((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  }, []);

  const canProceedStep1 = useMemo(() => {
    return documentName.trim().length > 0 && uploadedFile !== null;
  }, [documentName, uploadedFile]);

  const canProceedStep2 = useMemo(() => {
    return signers.every((s) => s.signerName.trim().length > 0);
  }, [signers]);

  const handleGoToStep2 = useCallback(() => {
    if (!canProceedStep1) {
      Alert.alert(t('common.error'), t('esignature.fillRequiredFields'));
      return;
    }
    setStep(2);
  }, [canProceedStep1, t]);

  const handleSubmit = useCallback(async () => {
    if (!user?.organization || !uploadedFile) return;
    if (!canProceedStep2) {
      Alert.alert(t('common.error'), t('esignature.fillSignerName'));
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', {
        uri: uploadedFile.uri,
        name: uploadedFile.name || 'document.pdf',
        type: uploadedFile.mimeType || 'application/pdf',
      } as any);
      formData.append('organizationName', user.organization);
      formData.append('documentName', documentName.trim());
      formData.append('uploadedBy', user.uID || user.userId);
      formData.append('uploadedByName', user.fullname);
      formData.append('expiresInDays', expiresInDays || '30');
      formData.append('requiresSequentialSigning', String(sequentialSigning));
      formData.append('signers', JSON.stringify(signers));
      formData.append('language', language);

      if (contactName.trim()) {
        formData.append('contact', JSON.stringify({ name: contactName.trim() }));
      }

      const result = await esignatureApi.createDocumentWithFile(formData);
      setCreatedDocument(result);
      setStep(3);
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [user, uploadedFile, documentName, expiresInDays, sequentialSigning, signers, language, contactName, canProceedStep2, t]);

  const orgName = user?.organization || '';

  const getSigningLinks = (): CreatedSigner[] => {
    if (!createdDocument) return [];
    const docSigners = createdDocument.signers || createdDocument.data?.signers || [];
    if (docSigners.length > 0) return docSigners;
    if (createdDocument.signingToken || createdDocument.token) {
      return [{
        signerName: signers[0]?.signerName || '',
        signingToken: createdDocument.signingToken || createdDocument.token,
        status: 'pending',
      }];
    }
    return [];
  };

  const handleCopyLink = useCallback(async (url: string) => {
    try {
      await Clipboard.setStringAsync(url);
      Alert.alert(t('common.success'), t('esignature.linkCopied'));
    } catch {
      await Share.share({ message: url });
    }
  }, [t]);

  const handleSendWhatsApp = useCallback(async (phone: string, url: string) => {
    try {
      const message = encodeURIComponent(
        `${t('esignature.title')}: ${documentName}\n${t('esignature.signHere')}: ${url}`
      );
      const cleanPhone = phone.replace(/\D/g, '');
      await Linking.openURL(`whatsapp://send?phone=${cleanPhone}&text=${message}`);
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
    }
  }, [documentName, t]);

  const handleShareLink = useCallback(async (url: string) => {
    try {
      await Share.share({ message: `${documentName}\n${url}` });
    } catch {
      // cancelled
    }
  }, [documentName]);

  const renderStepIndicator = () => {
    const steps = [
      { num: 1, label: t('esignature.stepDetails') },
      { num: 2, label: t('esignature.stepSigners') },
      { num: 3, label: t('esignature.stepDone') },
    ];

    return (
      <View style={[styles.stepIndicator, { flexDirection }]}>
        {steps.map((s, i) => {
          const isActive = s.num === step;
          const isCompleted = s.num < step;
          const color = isActive ? theme.colors.primary : isCompleted ? '#4CAF50' : theme.colors.onSurfaceVariant;

          return (
            <React.Fragment key={s.num}>
              {i > 0 && (
                <View style={[styles.stepLine, { backgroundColor: isCompleted ? '#4CAF50' : theme.colors.outlineVariant }]} />
              )}
              <View style={styles.stepItem}>
                <View style={[styles.stepCircle, {
                  backgroundColor: isActive ? theme.colors.primary : isCompleted ? '#4CAF50' : theme.colors.surfaceVariant,
                  borderColor: color,
                }]}>
                  {isCompleted ? (
                    <MaterialCommunityIcons name="check" size={14} color="#FFFFFF" />
                  ) : (
                    <Text style={[styles.stepNum, { color: isActive ? '#FFFFFF' : theme.colors.onSurfaceVariant }]}>
                      {s.num}
                    </Text>
                  )}
                </View>
                <Text variant="labelSmall" style={{ color, fontWeight: isActive ? '600' : '400', textAlign: 'center' }}>
                  {s.label}
                </Text>
              </View>
            </React.Fragment>
          );
        })}
      </View>
    );
  };

  const renderStep1 = () => (
    <View style={styles.stepContent}>
      <TextInput
        label={t('esignature.documentTitle') + ' *'}
        value={documentName}
        onChangeText={setDocumentName}
        mode="outlined"
        style={[styles.formInput, { textAlign }]}
        outlineColor={theme.colors.outline}
        activeOutlineColor={theme.colors.primary}
      />

      <TextInput
        label={t('esignature.contact')}
        value={contactName}
        onChangeText={setContactName}
        mode="outlined"
        style={[styles.formInput, { textAlign }]}
        outlineColor={theme.colors.outline}
        activeOutlineColor={theme.colors.primary}
        right={<TextInput.Icon icon="account" />}
      />

      {/* File upload */}
      <Pressable
        onPress={handlePickFile}
        style={[styles.uploadArea, {
          borderColor: uploadedFile ? '#4CAF50' : theme.colors.outline,
          backgroundColor: uploadedFile ? '#4CAF5008' : theme.colors.surfaceVariant + '30',
        }]}
      >
        {uploadedFile ? (
          <View style={[styles.uploadedRow, { flexDirection }]}>
            <MaterialCommunityIcons name="file-check" size={24} color="#4CAF50" />
            <View style={{ flex: 1 }}>
              <Text variant="bodyMedium" numberOfLines={1} style={{ color: theme.colors.onSurface, fontWeight: '500', textAlign }}>
                {uploadedFile.name}
              </Text>
              {uploadedFile.size ? (
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
                  {(uploadedFile.size / 1024).toFixed(0)} KB
                </Text>
              ) : null}
            </View>
            <IconButton icon="close" size={18} onPress={() => setUploadedFile(null)} />
          </View>
        ) : (
          <View style={styles.uploadPlaceholder}>
            <MaterialCommunityIcons name="cloud-upload" size={36} color={theme.colors.onSurfaceVariant} />
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, fontWeight: '500' }}>
              {t('esignature.uploadFile')}
            </Text>
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
              PDF, PNG, JPG
            </Text>
          </View>
        )}
      </Pressable>

      {/* Language selector */}
      <View style={styles.formGroup}>
        <Text variant="labelLarge" style={{ color: theme.colors.onSurface, marginBottom: 8, textAlign }}>
          {t('esignature.documentLanguage')}
        </Text>
        <SegmentedButtons
          value={language}
          onValueChange={setLanguage}
          buttons={[
            { value: 'en', label: 'English' },
            { value: 'he', label: 'עברית' },
          ]}
          style={styles.segmented}
        />
      </View>

      {/* Expires in */}
      <TextInput
        label={t('esignature.expiresInDays')}
        value={expiresInDays}
        onChangeText={setExpiresInDays}
        mode="outlined"
        keyboardType="numeric"
        style={[styles.formInput, { textAlign }]}
        outlineColor={theme.colors.outline}
        activeOutlineColor={theme.colors.primary}
        right={<TextInput.Icon icon="calendar-clock" />}
      />

      <Button
        mode="contained"
        onPress={handleGoToStep2}
        disabled={!canProceedStep1}
        style={[styles.nextButton, { backgroundColor: theme.colors.primary }]}
        textColor="#FFFFFF"
        contentStyle={styles.nextButtonContent}
        icon="arrow-right"
      >
        {t('esignature.next')}
      </Button>
    </View>
  );

  const renderStep2 = () => (
    <View style={styles.stepContent}>
      <Text variant="titleSmall" style={{ color: theme.colors.onSurface, fontWeight: '700', marginBottom: 12, textAlign }}>
        {t('esignature.addSigners')}
      </Text>

      {signers.map((signer, index) => (
        <View
          key={index}
          style={[styles.signerCard, { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant }]}
        >
          <View style={[styles.signerCardHeader, { flexDirection }]}>
            <Text variant="titleSmall" style={{ color: theme.colors.primary, fontWeight: '600' }}>
              {t('esignature.signer')} {index + 1}
            </Text>
            {signers.length > 1 && (
              <IconButton
                icon="close"
                size={18}
                iconColor={theme.colors.error}
                onPress={() => handleRemoveSigner(index)}
                style={{ margin: -4 }}
              />
            )}
          </View>

          <TextInput
            label={t('esignature.signerNameLabel') + ' *'}
            value={signer.signerName}
            onChangeText={(v) => handleUpdateSigner(index, 'signerName', v)}
            mode="outlined"
            style={[styles.formInputSmall, { textAlign }]}
            outlineColor={theme.colors.outline}
            activeOutlineColor={theme.colors.primary}
            dense
          />

          <TextInput
            label={t('esignature.signerEmail')}
            value={signer.signerEmail}
            onChangeText={(v) => handleUpdateSigner(index, 'signerEmail', v)}
            mode="outlined"
            keyboardType="email-address"
            style={[styles.formInputSmall, { textAlign }]}
            outlineColor={theme.colors.outline}
            activeOutlineColor={theme.colors.primary}
            right={<TextInput.Icon icon="email-outline" />}
            dense
          />

          <TextInput
            label={t('esignature.signerPhoneLabel')}
            value={signer.signerPhone}
            onChangeText={(v) => handleUpdateSigner(index, 'signerPhone', v)}
            mode="outlined"
            keyboardType="phone-pad"
            style={[styles.formInputSmall, { textAlign }]}
            outlineColor={theme.colors.outline}
            activeOutlineColor={theme.colors.primary}
            right={<TextInput.Icon icon="phone-outline" />}
            dense
          />
        </View>
      ))}

      <Button
        mode="outlined"
        icon="plus"
        onPress={handleAddSigner}
        style={[styles.addSignerBtn, { borderColor: theme.colors.primary }]}
        textColor={theme.colors.primary}
      >
        {t('esignature.addSigner')}
      </Button>

      <Divider style={{ marginVertical: 16, backgroundColor: theme.colors.outlineVariant }} />

      {/* Sequential signing toggle */}
      <View style={[styles.toggleRow, { flexDirection }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '500', textAlign }}>
            {t('esignature.sequentialSigning')}
          </Text>
          <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
            {t('esignature.sequentialSigningDesc')}
          </Text>
        </View>
        <Switch
          value={sequentialSigning}
          onValueChange={setSequentialSigning}
          trackColor={{ false: theme.colors.surfaceVariant, true: withAlpha(theme.colors.primary, 0.5) }}
          thumbColor={sequentialSigning ? theme.colors.primary : '#f4f3f4'}
        />
      </View>

      <View style={[styles.step2Actions, { flexDirection }]}>
        <Button
          mode="outlined"
          onPress={() => setStep(1)}
          style={styles.backButton}
          textColor={theme.colors.onSurface}
        >
          {t('esignature.back')}
        </Button>
        <Button
          mode="contained"
          onPress={handleSubmit}
          disabled={!canProceedStep2 || loading}
          loading={loading}
          style={[styles.nextButton, { flex: 1, backgroundColor: theme.colors.primary }]}
          textColor="#FFFFFF"
          contentStyle={styles.nextButtonContent}
          icon="check"
        >
          {t('esignature.createAndSend')}
        </Button>
      </View>
    </View>
  );

  const renderStep3 = () => {
    const signingLinks = getSigningLinks();
    const docId = createdDocument?.id || createdDocument?.data?.id || createdDocument?.documentId;

    return (
      <View style={styles.stepContent}>
        <View style={styles.successContainer}>
          <View style={[styles.successIcon, { backgroundColor: '#4CAF5018' }]}>
            <MaterialCommunityIcons name="check-decagram" size={48} color="#4CAF50" />
          </View>
          <Text variant="titleLarge" style={{ color: theme.colors.onSurface, fontWeight: '700', textAlign: 'center' }}>
            {t('esignature.documentCreated')}
          </Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
            {t('esignature.documentCreatedDesc')}
          </Text>
        </View>

        {signingLinks.length > 0 && (
          <View style={[styles.sectionCard, { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant }]}>
            <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface, textAlign }]}>
              {t('esignature.signingLinks')}
            </Text>

            {signingLinks.map((signer: CreatedSigner, index: number) => {
              const signerUrl = signer.signingToken
                ? `https://gambot.co.il/${orgName}/esignature/${docId}/sign/${signer.signingToken}`
                : '';

              return (
                <View key={index}>
                  {index > 0 && (
                    <Divider style={{ marginVertical: 12, backgroundColor: theme.colors.outlineVariant }} />
                  )}
                  <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600', marginBottom: 8, textAlign }}>
                    {signer.signerName}
                  </Text>

                  {signerUrl ? (
                    <View style={[styles.linkActions, { flexDirection }]}>
                      <Button
                        mode="outlined"
                        icon="content-copy"
                        compact
                        onPress={() => handleCopyLink(signerUrl)}
                        style={[styles.linkBtn, { borderColor: theme.colors.primary }]}
                        textColor={theme.colors.primary}
                        labelStyle={{ fontSize: 12 }}
                      >
                        {t('esignature.copyLink')}
                      </Button>
                      <Button
                        mode="outlined"
                        icon="share-variant"
                        compact
                        onPress={() => handleShareLink(signerUrl)}
                        style={[styles.linkBtn, { borderColor: theme.colors.outline }]}
                        textColor={theme.colors.onSurface}
                        labelStyle={{ fontSize: 12 }}
                      >
                        {t('common.send')}
                      </Button>
                      {signer.signerPhone && (
                        <Button
                          mode="contained"
                          icon="whatsapp"
                          compact
                          onPress={() => handleSendWhatsApp(signer.signerPhone!, signerUrl)}
                          style={[styles.linkBtn, { backgroundColor: '#25D366' }]}
                          textColor="#FFFFFF"
                          labelStyle={{ fontSize: 12 }}
                        >
                          WhatsApp
                        </Button>
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}

        <Button
          mode="contained"
          onPress={() => router.back()}
          style={[styles.nextButton, { backgroundColor: theme.colors.primary }]}
          textColor="#FFFFFF"
          contentStyle={styles.nextButtonContent}
        >
          {t('esignature.backToList')}
        </Button>

        {docId && (
          <Button
            mode="outlined"
            icon="eye"
            onPress={() => {
              router.replace({ pathname: '/(tabs)/more/esignature/[id]', params: { id: docId } });
            }}
            style={[styles.nextButton, { borderColor: theme.colors.primary }]}
            textColor={theme.colors.primary}
            contentStyle={styles.nextButtonContent}
          >
            {t('esignature.viewDocument')}
          </Button>
        )}
      </View>
    );
  };

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
            onPress={() => {
              if (step === 2) setStep(1);
              else router.back();
            }}
          />
          <Text
            variant="titleMedium"
            numberOfLines={1}
            style={[styles.headerTitleText, { flex: 1, textAlign }]}
          >
            {t('esignature.addDocument')}
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.body}
          contentContainerStyle={[styles.bodyContent, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {renderStepIndicator()}

          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
        </ScrollView>
      </KeyboardAvoidingView>

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
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
  },
  stepIndicator: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    gap: 0,
  },
  stepItem: {
    alignItems: 'center',
    gap: 4,
    width: 70,
  },
  stepCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNum: {
    fontSize: 12,
    fontWeight: '700',
  },
  stepLine: {
    height: 2,
    flex: 1,
    marginTop: -16,
  },
  stepContent: {
    gap: 14,
  },
  formInput: {
    marginBottom: 2,
  },
  formInputSmall: {
    marginBottom: 6,
  },
  formGroup: {
    marginBottom: 2,
  },
  segmented: {
    borderRadius: borderRadius.md,
  },
  uploadArea: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: borderRadius.lg,
    padding: 20,
    alignItems: 'center',
  },
  uploadPlaceholder: {
    alignItems: 'center',
    gap: 8,
  },
  uploadedRow: {
    alignItems: 'center',
    gap: 12,
    width: '100%',
  },
  nextButton: {
    borderRadius: borderRadius.md,
    marginTop: 4,
  },
  nextButtonContent: {
    paddingVertical: 6,
  },
  backButton: {
    borderRadius: borderRadius.md,
    minWidth: 80,
  },
  signerCard: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  signerCardHeader: {
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  addSignerBtn: {
    borderRadius: borderRadius.md,
  },
  toggleRow: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  step2Actions: {
    gap: 10,
    marginTop: 8,
  },
  successContainer: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 24,
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
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
  linkActions: {
    gap: 8,
    flexWrap: 'wrap',
  },
  linkBtn: {
    borderRadius: borderRadius.md,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
