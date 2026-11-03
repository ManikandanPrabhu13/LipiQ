import { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class GlobalErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('LipiQ UI Error Boundary caught an unhandled exception:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: '#f9f8fc',
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          color: '#252238'
        }}>
          <div style={{
            maxWidth: '520px',
            width: '100%',
            background: '#ffffff',
            borderRadius: '16px',
            padding: '32px',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.08)',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '40px', marginBottom: '16px' }}>⚠️</div>
            <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '8px', color: '#1f1d2b' }}>
              Something went wrong
            </h2>
            <p style={{ fontSize: '14px', color: '#67667a', marginBottom: '20px', lineHeight: 1.5 }}>
              LipiQ encountered a temporary rendering issue. Your document progress is safe.
            </p>
            {this.state.error?.message && (
              <pre style={{
                background: '#f4f1fa',
                padding: '12px',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#b91c1c',
                overflowX: 'auto',
                marginBottom: '20px',
                textAlign: 'left'
              }}>
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              style={{
                background: '#725cde',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 24px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <GlobalErrorBoundary>
      <App />
    </GlobalErrorBoundary>
  </StrictMode>,
)
