'use client';

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  /** Nome opcional do módulo, exibido no fallback para facilitar o diagnóstico. */
  label?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary de classe: captura erros de render dos módulos pesados e
 * mostra um fallback estilizado em vez de derrubar a página inteira.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', this.props.label ?? '', error, info.componentStack);
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex flex-col items-center justify-center h-full min-h-[320px] gap-5 p-8 text-center"
          style={{ backgroundColor: '#0a0a0f' }}
          role="alert"
        >
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center border"
            style={{ borderColor: 'rgba(201,169,110,0.25)', backgroundColor: 'rgba(201,169,110,0.08)' }}
          >
            <AlertTriangle className="w-8 h-8" style={{ color: '#c9a96e' }} />
          </div>
          <div>
            <h3 className="font-cormorant text-2xl text-white">
              Algo deu errado{this.props.label ? ` em ${this.props.label}` : ''}
            </h3>
            <p className="text-sm text-white/40 mt-2 max-w-md mx-auto break-words">
              {this.state.error?.message ?? 'Erro inesperado ao renderizar este módulo.'}
            </p>
          </div>
          <button
            onClick={this.reset}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium border transition-colors focus:outline-none focus:ring-2 focus:ring-gold/40"
            style={{
              color: '#c9a96e',
              borderColor: 'rgba(201,169,110,0.3)',
              backgroundColor: 'rgba(201,169,110,0.12)',
            }}
          >
            <RefreshCw className="w-4 h-4" /> Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
