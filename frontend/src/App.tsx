import { lazy, Suspense, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ConfigProvider, Spin } from 'antd';
import { AuthProvider } from './contexts/AuthContext';
import { SiteConfigProvider } from './contexts/SiteConfigContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import Layout from './components/Layout';
import PageTransition from './components/PageTransition';
import SetupWizard from './pages/SetupWizard';
import api from './utils/api';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const QuoteListPage = lazy(() => import('./pages/QuoteListPage'));
const QuoteDetailPage = lazy(() => import('./pages/QuoteDetailPage'));
const CreateQuotePage = lazy(() => import('./pages/CreateQuotePage'));
const EditQuotePage = lazy(() => import('./pages/EditQuotePage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const InviteCodesPage = lazy(() => import('./pages/InviteCodesPage'));
const HomePage = lazy(() => import('./pages/HomePage'));
const PlaygroundPage = lazy(() => import('./pages/PlaygroundPage'));
const ApiDocsPage = lazy(() => import('./pages/ApiDocsPage'));
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage'));
const MyListsPage = lazy(() => import('./pages/MyListsPage'));
const ListDetailPage = lazy(() => import('./pages/ListDetailPage'));
const PublicListPage = lazy(() => import('./pages/PublicListPage'));
const PublicListsPage = lazy(() => import('./pages/PublicListsPage'));

const PageLoader = () => (
  <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />
);

function App() {
  const [setupStatus, setSetupStatus] = useState<'loading' | 'setup' | 'ready'>('loading');

  useEffect(() => {
    api.get('/setup/status')
      .then((res) => setSetupStatus(res.data.needed ? 'setup' : 'ready'))
      .catch(() => setSetupStatus('ready'));
  }, []);

  if (setupStatus === 'loading') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f5f5f5',
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  if (setupStatus === 'setup') {
    return (
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: '#863bff',
          },
        }}
      >
        <SetupWizard />
      </ConfigProvider>
    );
  }

  return (
    <ErrorBoundary>
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: '#863bff',
          },
        }}
      >
        <BrowserRouter>
          <AuthProvider>
            <SiteConfigProvider>
            <Layout>
              <Suspense fallback={<PageLoader />}>
                <PageTransition>
                  <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/playground" element={<PlaygroundPage />} />
                    <Route path="/quotes" element={<QuoteListPage />} />
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/register" element={<RegisterPage />} />
                    <Route path="/quotes/new" element={<CreateQuotePage />} />
                    <Route path="/quotes/:id" element={<QuoteDetailPage />} />
                    <Route path="/quotes/:id/edit" element={<EditQuotePage />} />
                    <Route path="/profile/:id" element={<ProfilePage />} />
                    <Route path="/admin" element={<AdminPage />} />
                    <Route path="/admin/:section" element={<AdminPage />} />
                    <Route path="/notifications" element={<NotificationsPage />} />
                    <Route path="/invite-codes" element={<InviteCodesPage />} />
                    <Route path="/docs" element={<ApiDocsPage />} />
                    <Route path="/leaderboard" element={<LeaderboardPage />} />
                    <Route path="/lists" element={<MyListsPage />} />
                    <Route path="/lists/:id" element={<ListDetailPage />} />
                    <Route path="/public-lists" element={<PublicListsPage />} />
                    <Route path="/shared/:uuid" element={<PublicListPage />} />
                  </Routes>
                </PageTransition>
              </Suspense>
            </Layout>
            </SiteConfigProvider>
          </AuthProvider>
        </BrowserRouter>
      </ConfigProvider>
    </ErrorBoundary>
  );
}

export default App;
