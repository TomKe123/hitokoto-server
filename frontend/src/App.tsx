import { lazy, Suspense, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ConfigProvider, Spin, theme as antdTheme } from 'antd';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SiteConfigProvider } from './contexts/SiteConfigContext';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
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
const AIChangesPage = lazy(() => import('./pages/AIChangesPage'));
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
const MyInvitationsPage = lazy(() => import('./pages/MyInvitationsPage'));
const OrganizationPage = lazy(() => import('./pages/OrganizationPage'));
const OrganizationDetailPage = lazy(() => import('./pages/OrganizationDetailPage'));
const OrganizationSettingsPage = lazy(() => import('./pages/OrganizationSettingsPage'));
const AppGalleryPage = lazy(() => import('./pages/AppGalleryPage'));
const WallpaperPage = lazy(() => import('./apps/wallpaper/WallpaperApp'));

const PageLoader = () => (
  <Spin size="large" style={{ display: 'block', margin: '100px auto', color: '#C4956A' }} />
);

/** Gate a route behind authentication, redirecting to login with a return path. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return <PageLoader />;
  }
  if (!user) {
    return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return <>{children}</>;
}

/** Warm "yellowed book page" palette for both light and dark modes. */
const lightTokens = {
  colorPrimary: '#8B6D3F',
  colorBgContainer: '#FFFEF8',
  colorBgElevated: '#FFF9EE',
  colorBgLayout: '#F8F0E0',
  colorText: '#3D3528',
  colorTextSecondary: '#6B5D49',
  colorBorder: '#D8C8AC',
  colorBorderSecondary: '#E6DCC8',
};

const darkTokens = {
  colorPrimary: '#D9BC8A',
  colorBgContainer: '#2A2620',
  colorBgElevated: '#332E26',
  colorBgLayout: '#1F1C17',
  colorText: '#ECE3D2',
  colorTextSecondary: '#BCB09A',
  colorBorder: '#4A4338',
  colorBorderSecondary: '#3A352C',
};

/** The main themed shell — reads the current mode and feeds Ant Design's ConfigProvider. */
function ThemedApp() {
  const { mode } = useTheme();
  const isDark = mode === 'dark';
  const palette = isDark ? darkTokens : lightTokens;

  return (
    <ErrorBoundary>
      <ConfigProvider
        theme={{
          algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: {
            ...palette,
            fontFamily: "'Times New Roman', '仿宋', 'FangSong', 'Noto Serif SC', 'STSong', 'SimSun', 'Microsoft YaHei', '微软雅黑', serif",
            borderRadius: 4,
            fontSize: 15,
            lineHeight: 1.8,
          },
          components: {
            Card: {
              colorBgContainer: palette.colorBgContainer,
              colorBorderSecondary: palette.colorBorderSecondary,
            },
            Button: {
              colorPrimary: palette.colorPrimary,
              algorithm: true,
              borderRadius: 4,
            },
            Input: {
              colorBgContainer: palette.colorBgContainer,
              colorBorder: palette.colorBorder,
            },
            Select: {
              colorBgContainer: palette.colorBgContainer,
              colorBorder: palette.colorBorder,
            },
            Table: {
              colorBgContainer: palette.colorBgContainer,
            },
            Menu: {
              colorItemBg: 'transparent',
              colorSubItemBg: 'transparent',
            },
            Layout: {
              headerBg: palette.colorBgContainer,
              siderBg: palette.colorBgContainer,
              bodyBg: palette.colorBgLayout,
            },
            Modal: {
              contentBg: palette.colorBgContainer,
              headerBg: palette.colorBgContainer,
            },
            Popover: {
              colorBgElevated: palette.colorBgContainer,
            },
            Tooltip: {
              colorBgSpotlight: palette.colorBgLayout,
              colorTextLightSolid: palette.colorText,
            },
          },
        }}
      >
        <BrowserRouter>
          <AuthProvider>
            <SiteConfigProvider>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                {/* Full-screen preset app — rendered outside the platform Layout. */}
                <Route
                  path="/apps/wallpaper"
                  element={
                    <RequireAuth>
                      <WallpaperPage />
                    </RequireAuth>
                  }
                />
                {/* Everything else renders inside the platform Layout. */}
                <Route
                  path="*"
                  element={
                    <Layout>
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
                          <Route path="/admin/ai-changes" element={<RequireAuth><AIChangesPage /></RequireAuth>} />
                          <Route path="/notifications" element={<NotificationsPage />} />
                          <Route path="/invite-codes" element={<InviteCodesPage />} />
                          <Route path="/invites" element={<MyInvitationsPage />} />
                          <Route path="/docs" element={<ApiDocsPage />} />
                          <Route path="/leaderboard" element={<LeaderboardPage />} />
                          <Route path="/lists" element={<MyListsPage />} />
                          <Route path="/lists/:id" element={<ListDetailPage />} />
                          <Route path="/public-lists" element={<PublicListsPage />} />
                          <Route path="/shared/:uuid" element={<PublicListPage />} />
                          <Route path="/organizations" element={<OrganizationPage />} />
                          <Route path="/organizations/:id" element={<OrganizationDetailPage />} />
                          <Route path="/organizations/:id/settings" element={<OrganizationSettingsPage />} />
                          <Route path="/apps" element={<AppGalleryPage />} />
                        </Routes>
                      </PageTransition>
                    </Layout>
                  }
                />
              </Routes>
            </Suspense>
            </SiteConfigProvider>
          </AuthProvider>
        </BrowserRouter>
      </ConfigProvider>
    </ErrorBoundary>
  );
}

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
          background: 'linear-gradient(135deg, #FDF6E3 0%, #F5DEB3 50%, #E8D5B7 100%)',
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
            colorPrimary: '#C4956A',
            colorBgContainer: '#FDF6E3',
            colorText: '#5D4E37',
            fontFamily: "'Times New Roman', '仿宋', 'FangSong', 'Noto Serif SC', 'STSong', 'SimSun', 'Microsoft YaHei', '微软雅黑', serif",
          },
        }}
      >
        <SetupWizard />
      </ConfigProvider>
    );
  }

  return (
    <ThemeProvider>
      <ThemedApp />
    </ThemeProvider>
  );
}

export default App;
