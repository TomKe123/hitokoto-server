import type { ReactNode } from 'react';
import { useState } from 'react';
import { Layout as AntLayout, Menu, Button, Typography, Drawer, Grid } from 'antd';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  HomeOutlined,
  PlusOutlined,
  UserOutlined,
  LoginOutlined,
  LogoutOutlined,
  SettingOutlined,
  MenuOutlined,
} from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';

const { Header, Content, Footer } = AntLayout;
const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

function getSelectedKey(pathname: string, userId?: number): string {
  if (pathname === '/') return '/';
  if (pathname === '/quotes/new') return '/quotes/new';
  if (pathname.startsWith('/quotes/') && pathname.endsWith('/edit')) return '/quotes/new';
  if (pathname.startsWith('/quotes/')) return '/';
  if (userId && pathname === `/profile/${userId}`) return `/profile/${userId}`;
  if (pathname === '/admin') return '/admin';
  return '';
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const selectedKey = getSelectedKey(location.pathname, user?.id);

  const menuItems = [
    { key: '/', icon: <HomeOutlined />, label: '语录' },
    ...(user
      ? [
          { key: '/quotes/new', icon: <PlusOutlined />, label: '发布' },
          { key: `/profile/${user.id}`, icon: <UserOutlined />, label: '我的' },
          ...(user.role === 'admin' || user.role === 'collaborator'
            ? [{ key: '/admin', icon: <SettingOutlined />, label: '管理' }]
            : []),
        ]
      : []),
  ];

  const onMenuClick = ({ key }: { key: string }) => {
    navigate(key);
    setMobileMenuOpen(false);
  };

  const menuNode = (
    <Menu
      mode={isMobile ? 'vertical' : 'horizontal'}
      selectedKeys={selectedKey ? [selectedKey] : []}
      items={menuItems}
      onClick={onMenuClick}
      style={{ border: 'none', flex: 1, minWidth: isMobile ? undefined : 300 }}
    />
  );

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#fff',
          borderBottom: '1px solid #f0f0f0',
          padding: '0 24px',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <Title
            level={4}
            style={{ margin: 0, cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8 }}
            onClick={() => navigate('/')}>
            <img src="/favicon.svg" alt="logo" style={{ width: 28, height: 26 }} />
            一言
          </Title>
          {isMobile ? (
            <>
              <Button type="text" icon={<MenuOutlined />} onClick={() => setMobileMenuOpen(true)} />
              <Drawer
                title="导航"
                placement="left"
                open={mobileMenuOpen}
                onClose={() => setMobileMenuOpen(false)}
                width={240}>
                {menuNode}
              </Drawer>
            </>
          ) : (
            menuNode
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {user ? (
            <>
              <Text type="secondary" style={{ fontSize: 13 }}>
                {user.username}
              </Text>
              <Button type="text" icon={<LogoutOutlined />} onClick={logout}>
                退出
              </Button>
            </>
          ) : (
            <Button type="primary" icon={<LoginOutlined />} onClick={() => navigate('/login')}>
              登录
            </Button>
          )}
        </div>
      </Header>
      <Content style={{ padding: '24px', maxWidth: 960, width: '100%', margin: '0 auto' }}>
        {children}
      </Content>
      <Footer style={{ textAlign: 'center', color: '#999' }}>一言 Hitokoto Server</Footer>
    </AntLayout>
  );
}
