import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

/* ── Guest Route (redirect to /overview if already logged in) ── */

function GuestRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

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
    return <Navigate to="/overview" replace />;
  }

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
                <Route path="workforce/recruit" element={<Recruit />} />
                <Route path="workforce/dismiss/:id" element={<DismissPage />} />
                <Route path="employee/:id" element={<EmployeeDetail />} />
                <Route path="solutions" element={<Solutions />} />
                <Route path="knowledge" element={<Knowledge />} />
                <Route path="evidence" element={<Evidence />} />
                <Route path="audit" element={<Audit />} />
                <Route path="history" element={<History />} />
                <Route path="settings" element={<Settings />} />
                <Route path="identity" element={<IdentityAdmin />} />
                <Route path="admin" element={<Admin />} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="jobs" element={<Jobs />} />
                <Route path="skills" element={<Skills />} />
                <Route path="skill-market" element={<SkillMarket />} />
                <Route path="memory" element={<MemoryCenter />} />
              </Route>
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  );
}
