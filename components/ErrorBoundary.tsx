import React, { Component, ReactNode } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import i18n from '../i18n';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(_error: Error, _info: React.ErrorInfo) {
    // Error reported to state via getDerivedStateFromError
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <ScrollView contentContainerStyle={styles.content}>
            <MaterialCommunityIcons name="alert-circle-outline" size={72} color="#E63946" style={styles.icon} />
            <Text variant="headlineSmall" style={styles.title}>
              {i18n.t('errors.somethingWentWrong', 'Something went wrong')}
            </Text>
            <Text variant="bodyMedium" style={styles.subtitle}>
              {i18n.t('errors.unexpectedError', 'An unexpected error occurred. Please try again.')}
            </Text>
            {this.state.error?.message ? (
              <View style={styles.errorBox}>
                <Text variant="bodySmall" style={styles.errorText} numberOfLines={5}>
                  {this.state.error.message}
                </Text>
              </View>
            ) : null}
            <Button
              mode="contained"
              onPress={this.handleReset}
              style={styles.button}
              buttonColor="#2e6155"
              textColor="#fff"
            >
              {i18n.t('common.retry', 'Try Again')}
            </Button>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  icon: {
    opacity: 0.8,
  },
  title: {
    fontWeight: '700',
    color: '#1a1a1a',
    textAlign: 'center',
  },
  subtitle: {
    color: '#666',
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: '#fff5f5',
    borderRadius: 8,
    padding: 12,
    width: '100%',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errorText: {
    color: '#dc2626',
    fontFamily: 'monospace',
  },
  button: {
    marginTop: 8,
    borderRadius: 12,
    minWidth: 160,
  },
});
