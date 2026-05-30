import type { ReactNode } from 'react';
import { useState, useEffect } from 'react';
import { Layout as AntLayout, Menu, Button, Typography, Drawer, Grid, Badge } from 'antd';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  HomeOutlined,
  PlusOutlined,
  UserOutlined,
  LoginOutlined,
  LogoutOutlined,
  SettingOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  CodeOutlined,
  BellOutlined,
  KeyOutlined,
} from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import { useSiteConfig } from '../contexts/SiteConfigContext';
import api from '../utils/api';

const { Sider, Content, Footer } = AntLayout;
const { Text } = Typography;
const { useBreakpoint } = Grid;

function getSelectedKey(pathname: string, userId?: number): string {
  if (pathname === '/') return '/';
  if (pathname === '/quotes/new') return '/quotes/new';
  if (pathname.startsWith('/quotes/') && pathname.endsWith('/edit')) return '/quotes/new';
  if (pathname.startsWith('/quotes/')) return '/';
  if (userId && pathname === `/profile/${userId}`) return `/profile/${userId}`;
  if (pathname === '/admin') return '/admin';
  if (pathname === '/notifications') return '/notifications';
  if (pathname === '/invite-codes') return '/invite-codes';
  if (pathname === '/docs') return '/docs';
  return '';
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { anonymous_upload: anonUpload } = useSiteConfig();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const screens = useBreakpoint();
  const isMobile = !screens.lg;
  const isSmall = !screens.sm;
  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }
    api.get('/notifications', { params: { page: 1, page_size: 1 } })
      .then((res) => {
        setUnreadCount(res.data.unread_count || 0);
      })
      .catch(() => {});
    const interval = setInterval(() => {
      api.get('/notifications', { params: { page: 1, page_size: 1 } })
        .then((res) => setUnreadCount(res.data.unread_count || 0))
        .catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [user]);

  const contentMaxWidth = screens.xxl ? 1400 : screens.xl ? 1100 : screens.lg ? 900 : undefined;

  const selectedKey = getSelectedKey(location.pathname, user?.id);

  const menuItems = [
    { key: '/', icon: <HomeOutlined />, label: '语录' },
    ...(user
      ? [
          { key: '/quotes/new', icon: <PlusOutlined />, label: '发布' },
          { key: `/profile/${user.id}`, icon: <UserOutlined />, label: '我的' },
          { key: '/invite-codes', icon: <KeyOutlined />, label: '邀请码' },
          {
            key: '/notifications',
            icon: <BellOutlined />,
            label: (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                消息
                {unreadCount > 0 && (
                  <Badge count={unreadCount} size="small" style={{ marginLeft: 8 }} />
                )}
              </span>
            ),
          },
          ...(user.role === 'admin' || user.role === 'collaborator'
            ? [{ key: '/admin', icon: <SettingOutlined />, label: '管理' }]
            : []),
        ]
      : anonUpload
        ? [{ key: '/quotes/new', icon: <PlusOutlined />, label: '发布' }]
        : []),
    { key: '/docs', icon: <CodeOutlined />, label: 'API' },
  ];

  const onMenuClick = ({ key }: { key: string }) => {
    navigate(key);
    if (isMobile) setMobileOpen(false);
  };

  const siderMenu = (
    <>
      <div
        style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          borderBottom: '1px solid #f0f0f0',
          cursor: 'pointer',
        }}
        onClick={() => {
          navigate('/');
          if (isMobile) setMobileOpen(false);
        }}>
        <img src="/favicon.svg" alt="logo" style={{ width: 28, height: 26, flexShrink: 0 }} />
        {(!collapsed || isMobile) && (
          <Text strong style={{ fontSize: 16, whiteSpace: 'nowrap' }}>
            一言
          </Text>
        )}
      </div>
      <Menu
        mode="inline"
        selectedKeys={selectedKey ? [selectedKey] : []}
        items={menuItems}
        onClick={onMenuClick}
        style={{ border: 'none', marginTop: 8 }}
      />
    </>
  );

  return (
    <AntLayout style={{ minHeight: '100vh' }} hasSider>
      {isMobile ? (
        <Drawer
          placement="left"
          width={240}
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          styles={{ body: { padding: 0 } }}
          closeIcon={null}>
          {siderMenu}
        </Drawer>
      ) : (
        <Sider
          theme="light"
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          trigger={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          style={{
            overflow: 'auto',
            height: '100vh',
            position: 'sticky',
            top: 0,
            left: 0,
            background: '#fff',
            borderRight: '1px solid #f0f0f0',
          }}>
          {siderMenu}
        </Sider>
      )}

      <AntLayout>
        <AntLayout.Header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: isMobile ? 'space-between' : 'flex-end',
            background: '#fff',
            borderBottom: '1px solid #f0f0f0',
            padding: isMobile ? '0 16px' : '0 24px',
            height: 64,
            position: 'sticky',
            top: 0,
            zIndex: 100,
          }}>
          {isMobile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button type="text" icon={<MenuUnfoldOutlined />} onClick={() => setMobileOpen(true)} />
              <img src="/favicon.svg" alt="logo" style={{ width: 22, height: 20 }} />
              <Text strong>一言</Text>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {user ? (
              <>
                {!isSmall && (
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    {user.username}
                  </Text>
                )}
                <Button type="text" icon={<LogoutOutlined />} onClick={logout}>
                  {isSmall ? '' : '退出'}
                </Button>
              </>
            ) : (
              <Button type="primary" icon={<LoginOutlined />} onClick={() => navigate('/login')}>
                {isSmall ? '' : '登录'}
              </Button>
            )}
          </div>
        </AntLayout.Header>
        <Content
          style={{
            padding: isMobile ? '16px' : '24px',
            maxWidth: contentMaxWidth,
            width: '100%',
            margin: '0 auto',
          }}>
          {children}
        </Content>
        <Footer
          style={{
            textAlign: 'center',
            color: '#999',
            fontSize: isMobile ? 12 : 14,
          }}>
          一言 Hitokoto Server
        </Footer>
      </AntLayout>
    </AntLayout>
  );
}
