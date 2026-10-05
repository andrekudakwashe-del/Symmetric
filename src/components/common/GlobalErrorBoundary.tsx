import React, { Component, ReactNode, ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class GlobalErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  constructor(props: ErrorBoundaryProps) {
    super(props);
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Unhandled Application Exception caught by GlobalErrorBoundary:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleResetState = () => {
    try {
      // Clear non-critical transient session caches if needed, keeping database safe
      sessionStorage.clear();
    } catch {}
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const errorMessage = this.state.error?.message || 'An unexpected runtime error occurred.';
      const isIllegalConstructor = errorMessage.toLowerCase().includes('illegal constructor');

      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 select-none">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
            <div className="flex items-center space-x-3 text-amber-400">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-amber-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">System Notice</h2>
                <p className="text-xs text-slate-400">
                  {isIllegalConstructor
                    ? 'Browser Environment Compatibility Notice'
                    : 'A client-side operation encountered an unexpected condition.'}
                </p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800/80 font-mono text-xs text-slate-300 overflow-x-auto space-y-1">
              <div className="text-rose-400 font-semibold">{errorMessage}</div>
              {this.state.error?.stack && (
                <div className="text-[11px] text-slate-500 max-h-36 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                  {this.state.error.stack}
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleReload}
                className="flex-1 flex items-center justify-center space-x-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-[#6A4DFF] to-[#8065FF] hover:from-[#5839EE] hover:to-[#6A4DFF] text-white text-xs font-bold transition shadow-lg shadow-purple-900/30 cursor-pointer active:scale-95"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Reload Application</span>
              </button>
              <button
                type="button"
                onClick={this.handleResetState}
                className="flex items-center justify-center space-x-2 px-4 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer active:scale-95"
              >
                <Home className="w-4 h-4" />
                <span>Reset & Resume</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
