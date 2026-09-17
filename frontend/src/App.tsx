import type { ReactNode } from 'react';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { theme } from './theme/theme';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { TrackingProvider } from './hooks/useFieldTracking';
import { OfflineProvider } from './offline/OfflineProvider';
import { Layout } from './components/Layout';
import { UpdateBanner } from './components/UpdateBanner';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { TowersPage } from './pages/TowersPage';
import { TowerDetailPage } from './pages/TowerDetailPage';
import { VisitDetailPage } from './pages/VisitDetailPage';
import { ArchivePage } from './pages/ArchivePage';
import { ReportsPage } from './pages/ReportsPage';
import { FieldTrackerPage } from './pages/FieldTrackerPage';
import { TeamProgressPage } from './pages/TeamProgressPage';
import { TeamsPage } from './pages/TeamsPage';
import { TeamDetailPage } from './pages/TeamDetailPage';
import { HelpPage } from './pages/HelpPage';
import { SettingsPage } from './pages/SettingsPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      networkMode: 'offlineFirst',
      gcTime: 24 * 60 * 60 * 1000,
    },
    mutations: { networkMode: 'offlineFirst' },
  },
});

function ProtectedLayout({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}



function AppRoutes() {
  const { isAuthenticated } = useAuth();

  return (
    <TrackingProvider active={isAuthenticated}>
      <AppRoutesInner isAuthenticated={isAuthenticated} />
    </TrackingProvider>
  );
}

function AppRoutesInner({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedLayout>
            <DashboardPage />
          </ProtectedLayout>
        }
      />
      <Route
        path="/towers"
        element={
          <ProtectedLayout>
            <TowersPage />
          </ProtectedLayout>
        }
      />
      <Route
        path="/towers/:towerId"
        element={
          <ProtectedLayout>
            <TowerDetailPage />
          </ProtectedLayout>
        }
      />
      <Route
        path="/visits/:visitId"
        element={
          <ProtectedLayout>
            <VisitDetailPage />
          </ProtectedLayout>
        }
      />
      <Route
        path="/archive"
        element={
          <ProtectedLayout>
            <ArchivePage />
          </ProtectedLayout>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedLayout>
            <ReportsPage />
          </ProtectedLayout>
        }
      />
      <Route
        path="/field-tracker"
        element={
          <ProtectedLayout>
            <FieldTrackerPage />
          </ProtectedLayout>
        }
      />
      <Route
        path="/team-progress"
        element={
          <ProtectedLayout>
            <TeamProgressPage />
          </ProtectedLayout>
        }
      />
      <Route
        path="/teams"
        element={
          <ProtectedLayout>
            <TeamsPage />
          </ProtectedLayout>
        }
      />
      <Route
        path="/teams/:teamId"
        element={
          <ProtectedLayout>
            <TeamDetailPage />
          </ProtectedLayout>
        }
      />
      <Route
        path="/help"
        element={
          <ProtectedLayout>
            <HelpPage />
          </ProtectedLayout>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedLayout>
            <SettingsPage />
          </ProtectedLayout>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <UpdateBanner />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <OfflineProvider>
              <AppRoutes />
            </OfflineProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
