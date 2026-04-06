import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { errorWithTs } from '@/lib/logger';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class CrashBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    errorWithTs('[CrashBoundary] Component tree crashed', {
      error: error.message,
      stack: error.stack?.slice(0, 500),
      componentStack: errorInfo.componentStack?.slice(0, 500),
    });
    this.props.onError?.(error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const title = this.props.fallbackTitle ?? 'Something went wrong';
      const message = this.props.fallbackMessage
        ?? 'This feature encountered an error. Tap below to retry.';

      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, backgroundColor: '#0D1117' }}>
          <Text style={{ color: '#E6EDF3', fontSize: 20, fontWeight: '600', marginBottom: 12, textAlign: 'center' }}>
            {title}
          </Text>
          <Text style={{ color: '#8B949E', fontSize: 14, textAlign: 'center', marginBottom: 24, lineHeight: 20 }}>
            {message}
          </Text>
          <TouchableOpacity
            onPress={this.handleRetry}
            accessibilityRole="button"
            accessibilityLabel="Retry"
            style={{
              backgroundColor: '#4C8CFF',
              paddingHorizontal: 24,
              paddingVertical: 12,
              borderRadius: 8,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}
