import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { lazy, Suspense, type ReactNode } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Spin } from 'antd';

const BasicLayout = lazy(() => import('./layouts/BasicLayout'));
const CommandCenter = lazy(() => import('./pages/CommandCenter'));
const Workforce = lazy(() => import('./pages/Workforce'));
const Recruit = lazy(() => import('./pages/Recruit'));
const DismissPage = lazy(() => import('./pages/DismissPage'));
const EmployeeDetail = lazy(() => import('./pages/EmployeeDetail'));
const Evidence = lazy(() => import('./pages/Evidence'));
const Audit = lazy(() => import('./pages/Audit'));
const Settings = lazy(() => import('./pages/Settings'));
const History = lazy(() => import('./pages/History'));
const Knowledge = lazy(() => import('./pages/Knowledge'));
const Solutions = lazy(() => import('./pages/Solutions'));
const Admin = lazy(() => import('./pages/Admin'));
const IdentityAdmin = lazy(() => import('./pages/IdentityAdmin'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const Jobs = lazy(() => import('./pages/Jobs'));
const Skills = lazy(() => import('./pages/Skills'));
const SkillMarket = lazy(() => import('./pages/SkillMarket'));
const MemoryCenter = lazy(() => import('./pages/MemoryCenter'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Whiteboard = lazy(() => import('./pages/Whiteboard'));
const ContractReview = lazy(() => import('./pages/ContractReview'));
const OfficialWriting = lazy(() => import('./pages/OfficialWriting'));
const PresentationCanvas = lazy(() => import('./pages/PresentationCanvas'));
const PresentationDesigner = lazy(() => import('./pages/PresentationDesigner'));
const AipptOfflineDemo = lazy(() => import('./pages/AipptOfflineDemo'));

/* ── Protected Route ── */

function PageFallback() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-primary, #F5F5F7)',
    }}>
      <Spin size="large" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1a1a2e',
      }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!isAuthenticated) {
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }

  return <>{children}</>;
}

/* ── Guest Route (redirect to /overview if already logged in) ── */

function GuestRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1a1a2e',
      }}>
        <Spin size="large" />
      </div>
    );
  }

  if (isAuthenticated) {
    const from = typeof location.state?.from === 'string' ? location.state.from : '/overview';
    return <Navigate to={from} replace />;
  }

  return <>{children}</>;
}

function AdminRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) return <PageFallback />;
  if (!user?.is_admin) return <Navigate to="/overview" replace />;
  return <>{children}</>;
}

/* ── App ── */

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ErrorBoundary>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/aippt-offline-demo" element={<AipptOfflineDemo />} />
              <Route
                path="/login"
                element={
                  <GuestRoute>
                    <LoginPage />
                  </GuestRoute>
                }
              />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <BasicLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Navigate to="/overview" replace />} />
                <Route path="overview" element={<CommandCenter />} />
                <Route path="workforce" element={<Workforce />} />
                <Route path="whiteboard" element={<Whiteboard />} />
                <Route path="presentation-canvas" element={<PresentationCanvas />} />
                <Route path="presentation-canvas/designer/:deckId" element={<PresentationDesigner />} />
                <Route path="official-writing" element={<OfficialWriting />} />
                <Route path="contract-review" element={<ContractReview />} />
                <Route path="workforce/recruit" element={<Recruit />} />
                <Route path="workforce/dismiss/:id" element={<AdminRoute><DismissPage /></AdminRoute>} />
                <Route path="employee/:id" element={<EmployeeDetail />} />
                <Route path="solutions" element={<AdminRoute><Solutions /></AdminRoute>} />
                <Route path="knowledge" element={<AdminRoute><Knowledge /></AdminRoute>} />
                <Route path="evidence" element={<AdminRoute><Evidence /></AdminRoute>} />
                <Route path="audit" element={<AdminRoute><Audit /></AdminRoute>} />
                <Route path="history" element={<History />} />
                <Route path="settings" element={<AdminRoute><Settings /></AdminRoute>} />
                <Route path="identity" element={<AdminRoute><IdentityAdmin /></AdminRoute>} />
                <Route path="admin" element={<AdminRoute><Admin /></AdminRoute>} />
                <Route path="dashboard" element={<AdminRoute><Dashboard /></AdminRoute>} />
                <Route path="jobs" element={<AdminRoute><Jobs /></AdminRoute>} />
                <Route path="skills" element={<Skills />} />
                <Route path="skill-market" element={<SkillMarket />} />
                <Route path="memory" element={<AdminRoute><MemoryCenter /></AdminRoute>} />
              </Route>
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  );
}
