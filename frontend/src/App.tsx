import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ConfigProvider, Spin } from 'antd';
import { AuthProvider } from './contexts/AuthContext';
import { SiteConfigProvider } from './contexts/SiteConfigContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import Layout from './components/Layout';
import PageTransition from './components/PageTransition';

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
const ApiDocsPage = lazy(() => import('./pages/ApiDocsPage'));

const PageLoader = () => (
  <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />
);

function App() {
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
                    <Route path="/" element={<QuoteListPage />} />
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/register" element={<RegisterPage />} />
                    <Route path="/quotes/new" element={<CreateQuotePage />} />
                    <Route path="/quotes/:id" element={<QuoteDetailPage />} />
                    <Route path="/quotes/:id/edit" element={<EditQuotePage />} />
                    <Route path="/profile/:id" element={<ProfilePage />} />
                    <Route path="/admin" element={<AdminPage />} />
                    <Route path="/notifications" element={<NotificationsPage />} />
                    <Route path="/invite-codes" element={<InviteCodesPage />} />
                    <Route path="/docs" element={<ApiDocsPage />} />
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
