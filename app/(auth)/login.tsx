import { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
  Dimensions,
  Pressable,
  Image,
} from 'react-native';
import {
  Text,
  TextInput,
  Button,
  Checkbox,
  Portal,
  Modal,
  IconButton,
  useTheme,
} from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';
import { secureStorage } from '../../services/storage';
import { useRTL } from '../../hooks/useRTL';
import { borderRadius, spacing, fontSize } from '../../constants/theme';
import type { AppTheme } from '../../constants/theme';

const { width } = Dimensions.get('window');

export default function LoginScreen() {
  const { t } = useTranslation();
  const theme = useTheme<AppTheme>();
  const { isRTL, textAlign, flexDirection, writingDirection } = useRTL();

  const login = useAuthStore((s) => s.login);
  const forgotPassword = useAuthStore((s) => s.forgotPassword);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organization, setOrganization] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoverySuccess, setRecoverySuccess] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const passwordRef = useRef<any>(null);
  const orgRef = useRef<any>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const errorAnim = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.8)).current;

  const showOrgField = email.toLowerCase() === 'info@gambot.co.il';

  useEffect(() => {
    secureStorage.getSavedCredentials().then((creds) => {
      if (creds) {
        setEmail(creds.email);
        setPassword(creds.password);
        setRememberMe(true);
      }
    });
  }, []);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 40,
        friction: 8,
        useNativeDriver: true,
      }),
      Animated.spring(logoScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  useEffect(() => {
    if (error) {
      Animated.sequence([
        Animated.timing(errorAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(errorAnim, { toValue: 1, tension: 300, friction: 10, useNativeDriver: true }),
      ]).start();
    } else {
      errorAnim.setValue(0);
    }
  }, [error]);

  const validateEmail = (value: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!value.trim()) {
      setEmailError(t('common.required'));
      return false;
    }
    if (!emailRegex.test(value)) {
      setEmailError(t('login.invalidEmail'));
      return false;
    }
    setEmailError('');
    return true;
  };

  const validatePassword = (value: string): boolean => {
    if (!value.trim()) {
      setPasswordError(t('login.passwordRequired'));
      return false;
    }
    setPasswordError('');
    return true;
  };

  const handleLogin = async () => {
    clearError();
    const isEmailValid = validateEmail(email);
    const isPasswordValid = validatePassword(password);
    if (!isEmailValid || !isPasswordValid) return;

    try {
      await login(email, password, showOrgField ? organization : undefined);
      if (rememberMe) {
        await secureStorage.setSavedCredentials(email, password);
      } else {
        await secureStorage.clearSavedCredentials();
      }
      router.replace('/(tabs)/chats');
    } catch {
      // error displayed via store state
    }
  };

  const handleForgotPassword = async () => {
    if (!recoveryEmail.trim()) return;
    const success = await forgotPassword(recoveryEmail);
    if (success) {
      setRecoverySuccess(true);
    }
  };

  const closeForgotModal = () => {
    setShowForgotModal(false);
    setRecoveryEmail('');
    setRecoverySuccess(false);
    clearError();
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Brand Header */}
          <View style={styles.brandSection}>
            <View style={styles.gradientBackground}>
              <View style={styles.gradientLayer1} />
              <View style={styles.gradientLayer2} />
              <Animated.View
                style={[
                  styles.logoContainer,
                  { transform: [{ scale: logoScale }], opacity: fadeAnim },
                ]}
              >
                <View style={styles.logoImageWrapper}>
                  <Image
                    source={require('../../assets/images/logo.png')}
                    style={styles.logoImage}
                    resizeMode="contain"
                  />
                </View>
                <Text style={styles.brandName}>Gambot</Text>
                <Text style={styles.brandTagline}>CRM & Business Automation</Text>
              </Animated.View>
            </View>
            <View style={styles.curveOverlay}>
              <View style={[styles.curve, { backgroundColor: theme.colors.background }]} />
            </View>
          </View>

          {/* Login Form */}
          <Animated.View
            style={[
              styles.formSection,
              {
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }],
              },
            ]}
          >
            <Text
              style={[
                styles.signInTitle,
                { color: theme.colors.onBackground, textAlign },
              ]}
            >
              {t('login.title')}
            </Text>

            {/* Error Banner */}
            {error && (
              <Animated.View
                style={[
                  styles.errorBanner,
                  {
                    backgroundColor: theme.colors.errorContainer,
                    opacity: errorAnim,
                    transform: [
                      {
                        translateX: errorAnim.interpolate({
                          inputRange: [0, 0.25, 0.5, 0.75, 1],
                          outputRange: [0, -8, 8, -4, 0],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <IconButton
                  icon="alert-circle"
                  iconColor={theme.colors.error}
                  size={20}
                  style={styles.errorIcon}
                />
                <Text
                  style={[
                    styles.errorText,
                    { color: theme.colors.error, textAlign, writingDirection, flex: 1 },
                  ]}
                >
                  {error}
                </Text>
                <IconButton
                  icon="close"
                  iconColor={theme.colors.error}
                  size={16}
                  onPress={clearError}
                />
              </Animated.View>
            )}

            {/* Email */}
            <TextInput
              mode="outlined"
              label={t('login.emailPlaceholder')}
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                if (emailError) validateEmail(v);
                clearError();
              }}
              onBlur={() => email && validateEmail(email)}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              left={<TextInput.Icon icon="email-outline" />}
              error={!!emailError}
              style={[styles.input, { textAlign, writingDirection }]}
              outlineStyle={styles.inputOutline}
              contentStyle={{ writingDirection }}
            />
            {emailError ? (
              <Text style={[styles.fieldError, { color: theme.colors.error, textAlign }]}>
                {emailError}
              </Text>
            ) : null}

            {/* Password */}
            <TextInput
              ref={passwordRef}
              mode="outlined"
              label={t('login.passwordPlaceholder')}
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                if (passwordError) validatePassword(v);
                clearError();
              }}
              onBlur={() => password && validatePassword(password)}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete="password"
              textContentType="password"
              returnKeyType={showOrgField ? 'next' : 'go'}
              onSubmitEditing={showOrgField ? () => orgRef.current?.focus() : handleLogin}
              left={<TextInput.Icon icon="lock-outline" />}
              right={
                <TextInput.Icon
                  icon={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  onPress={() => setShowPassword((v) => !v)}
                />
              }
              error={!!passwordError}
              style={[styles.input, { textAlign, writingDirection }]}
              outlineStyle={styles.inputOutline}
              contentStyle={{ writingDirection }}
            />
            {passwordError ? (
              <Text style={[styles.fieldError, { color: theme.colors.error, textAlign }]}>
                {passwordError}
              </Text>
            ) : null}

            {/* Organization (conditional) */}
            {showOrgField && (
              <TextInput
                ref={orgRef}
                mode="outlined"
                label={t('login.organizationPlaceholder')}
                value={organization}
                onChangeText={setOrganization}
                autoCapitalize="none"
                returnKeyType="go"
                onSubmitEditing={handleLogin}
                left={<TextInput.Icon icon="office-building-outline" />}
                style={[styles.input, { textAlign, writingDirection }]}
                outlineStyle={styles.inputOutline}
                contentStyle={{ writingDirection }}
              />
            )}

            {/* Remember Me & Forgot Password */}
            <View style={[styles.optionsRow, { flexDirection }]}>
              <Pressable
                style={[styles.rememberMe, { flexDirection }]}
                onPress={() => setRememberMe((v) => !v)}
              >
                <Checkbox
                  status={rememberMe ? 'checked' : 'unchecked'}
                  onPress={() => setRememberMe((v) => !v)}
                  color={theme.colors.primary}
                />
                <Text style={[styles.rememberMeText, { color: theme.colors.onSurfaceVariant }]}>
                  {t('login.rememberMe')}
                </Text>
              </Pressable>

              <Pressable onPress={() => setShowForgotModal(true)}>
                <Text style={[styles.forgotText, { color: theme.colors.primary }]}>
                  {t('login.forgotPassword')}
                </Text>
              </Pressable>
            </View>

            {/* Login Button */}
            <Button
              mode="contained"
              onPress={handleLogin}
              loading={isLoading}
              disabled={isLoading}
              style={styles.loginButton}
              contentStyle={styles.loginButtonContent}
              labelStyle={styles.loginButtonLabel}
            >
              {isLoading ? t('login.loggingIn') : t('login.loginButton')}
            </Button>

            {/* Security Badge */}
            <View style={styles.securityBadge}>
              <IconButton
                icon="shield-lock-outline"
                iconColor={theme.colors.onSurfaceVariant}
                size={16}
                style={styles.securityIcon}
              />
              <Text style={[styles.securityText, { color: theme.colors.onSurfaceVariant }]}>
                {t('login.sslSecure')}
              </Text>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Forgot Password Modal */}
      <Portal>
        <Modal
          visible={showForgotModal}
          onDismiss={closeForgotModal}
          contentContainerStyle={[
            styles.modalContent,
            { backgroundColor: theme.colors.surface },
          ]}
        >
          <View style={[styles.modalHeader, { flexDirection }]}>
            <Text style={[styles.modalTitle, { color: theme.colors.onSurface, flex: 1, textAlign }]}>
              {t('login.passwordRecovery')}
            </Text>
            <IconButton icon="close" onPress={closeForgotModal} size={20} />
          </View>

          {recoverySuccess ? (
            <View style={styles.recoverySuccess}>
              <IconButton
                icon="check-circle"
                iconColor={theme.custom.success}
                size={48}
                style={styles.successIcon}
              />
              <Text
                style={[
                  styles.recoverySuccessText,
                  { color: theme.colors.onSurface, textAlign: 'center' },
                ]}
              >
                {t('login.recoveryEmailSent')}
              </Text>
              <Button
                mode="contained"
                onPress={closeForgotModal}
                style={styles.backToLoginButton}
              >
                {t('login.backToLogin')}
              </Button>
            </View>
          ) : (
            <>
              <Text
                style={[
                  styles.recoveryInfo,
                  { color: theme.colors.onSurfaceVariant, textAlign, writingDirection },
                ]}
              >
                {t('login.recoveryInfo')}
              </Text>

              {error && (
                <View style={[styles.modalError, { backgroundColor: theme.colors.errorContainer }]}>
                  <Text style={[styles.modalErrorText, { color: theme.colors.error, textAlign }]}>
                    {error}
                  </Text>
                </View>
              )}

              <TextInput
                mode="outlined"
                label={t('login.emailPlaceholder')}
                value={recoveryEmail}
                onChangeText={(v) => {
                  setRecoveryEmail(v);
                  clearError();
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                left={<TextInput.Icon icon="email-outline" />}
                style={[styles.modalInput, { textAlign, writingDirection }]}
                outlineStyle={styles.inputOutline}
                contentStyle={{ writingDirection }}
              />

              <View style={styles.modalActions}>
                <Button
                  mode="outlined"
                  onPress={closeForgotModal}
                  style={styles.modalCancelButton}
                >
                  {t('login.backToLogin')}
                </Button>
                <Button
                  mode="contained"
                  onPress={handleForgotPassword}
                  loading={isLoading}
                  disabled={isLoading || !recoveryEmail.trim()}
                  style={styles.modalSendButton}
                >
                  {isLoading ? t('login.sending') : t('login.sendRecoveryLink')}
                </Button>
              </View>
            </>
          )}
        </Modal>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  brandSection: {
    position: 'relative',
  },
  gradientBackground: {
    paddingTop: 60,
    paddingBottom: 60,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2e6155',
    overflow: 'hidden',
  },
  gradientLayer1: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1e3a32',
    opacity: 0.6,
    transform: [{ skewY: '-6deg' }, { translateY: 40 }],
  },
  gradientLayer2: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#34d399',
    opacity: 0.15,
    transform: [{ skewY: '4deg' }, { translateY: 80 }],
  },
  logoContainer: {
    alignItems: 'center',
    zIndex: 1,
  },
  logoImageWrapper: {
    width: 90,
    height: 90,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  logoImage: {
    width: 70,
    height: 70,
  },
  brandName: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 2,
  },
  brandTagline: {
    fontSize: fontSize.sm,
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: spacing.xs,
    letterSpacing: 0.5,
  },
  curveOverlay: {
    position: 'absolute',
    bottom: -1,
    left: 0,
    right: 0,
    height: 30,
    overflow: 'hidden',
  },
  curve: {
    flex: 1,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
  },
  formSection: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  signInTitle: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    marginBottom: spacing.lg,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.md,
  },
  errorIcon: {
    margin: 0,
  },
  errorText: {
    fontSize: fontSize.md,
  },
  input: {
    marginBottom: spacing.sm,
  },
  inputOutline: {
    borderRadius: borderRadius.lg,
  },
  fieldError: {
    fontSize: fontSize.xs,
    marginTop: -spacing.xs,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  optionsRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  rememberMe: {
    alignItems: 'center',
  },
  rememberMeText: {
    fontSize: fontSize.md,
  },
  forgotText: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  loginButton: {
    borderRadius: borderRadius.lg,
    elevation: 3,
    shadowColor: '#2e6155',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  loginButtonContent: {
    height: 52,
  },
  loginButtonLabel: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  securityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  securityIcon: {
    margin: 0,
    marginRight: 2,
  },
  securityText: {
    fontSize: fontSize.xs,
  },
  modalContent: {
    margin: spacing.lg,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    maxWidth: 460,
    alignSelf: 'center',
    width: width - spacing.lg * 2,
  },
  modalHeader: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  modalTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  recoveryInfo: {
    fontSize: fontSize.md,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  modalError: {
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  modalErrorText: {
    fontSize: fontSize.sm,
  },
  modalInput: {
    marginBottom: spacing.lg,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  modalCancelButton: {
    flex: 1,
    borderRadius: borderRadius.lg,
  },
  modalSendButton: {
    flex: 1,
    borderRadius: borderRadius.lg,
  },
  recoverySuccess: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  successIcon: {
    margin: 0,
    marginBottom: spacing.md,
  },
  recoverySuccessText: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    marginBottom: spacing.lg,
  },
  backToLoginButton: {
    borderRadius: borderRadius.lg,
    minWidth: 200,
  },
});
