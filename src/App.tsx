import * as React from 'react';
import { auth, db } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import { Toaster } from 'react-hot-toast';
import { doc, getDocFromServer } from 'firebase/firestore';

class ErrorBoundary extends (React.Component as any) {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[var(--color-leather-white)] flex items-center justify-center p-4">
          <div className="bg-white border-2 border-stitch p-8 rounded-2xl max-w-lg w-full shadow-xl">
            <h2 className="text-2xl font-varsity text-[var(--color-stitch-red)] mb-4 uppercase tracking-wider">Something went wrong</h2>
            <p className="text-slate-600 mb-6 font-scorebook">
              The application encountered an error. If this is a permission issue, the details have been logged to the console.
            </p>
            <pre className="bg-slate-100 p-4 rounded-xl text-xs text-slate-800 overflow-auto max-h-40 mb-6 border border-slate-200">
              {this.state.error?.message || "Unknown error"}
            </pre>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-field hover:bg-emerald-800 text-white font-varsity uppercase tracking-widest rounded-xl transition-colors shadow-lg"
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

export default function App() {
  const [user, setUser] = React.useState<User | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    }
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-leather-white)] flex flex-col items-center justify-center">
        <div className="relative w-24 h-24">
          <div className="absolute inset-0 border-4 border-[var(--color-stitch-red)] border-dashed rounded-full animate-spin-slow" />
          <div className="absolute inset-2 bg-white rounded-full flex items-center justify-center shadow-inner">
            <span className="text-3xl">⚾</span>
          </div>
        </div>
        <p className="mt-4 font-varsity text-slate-600 uppercase tracking-widest animate-pulse">Loading Ballpark...</p>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <Toaster position="top-right" toastOptions={{
        style: {
          background: '#fff',
          color: '#1e293b',
          border: '2px dashed var(--color-stitch-red)',
          fontFamily: 'var(--font-varsity)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        },
      }} />
      {user ? <Dashboard /> : <Auth />}
    </ErrorBoundary>
  );
}
