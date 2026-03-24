import React from 'react';

type Props = { children: React.ReactNode; title?: string };

type State = { error?: Error; info?: React.ErrorInfo };

export default class ErrorBoundary extends React.Component<Props, State> {
  // Compatibility declarations for current React typings in this repo.
  declare props: Props;
  declare setState: (state: Partial<State>) => void;
  state: State = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ error, info });
    console.error('ErrorBoundary caught error:', error, info);
  }

  render() {
    const { error, info } = this.state;
    if (error) {
      return (
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="text-red-700 font-semibold mb-2">{this.props.title || 'Something went wrong'}</div>
            <div className="text-sm text-red-600">{error.message}</div>
            {info?.componentStack && (
              <pre className="mt-3 text-xs bg-white border border-red-100 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">
                {info.componentStack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children as React.ReactElement;
  }
}
