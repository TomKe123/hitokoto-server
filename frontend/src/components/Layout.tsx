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
  OrderedListOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ReadOutlined,
  BellOutlined,
  KeyOutlined,
  CrownOutlined,
  UnorderedListOutlined,
  UnlockOutlined,
  ToolOutlined,
  ExperimentOutlined,
  BookOutlined,
  FolderOutlined,
  TagsOutlined,
  CodeOutlined,
  TeamOutlined,
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
  if (pathname === '/quotes') return '/quotes';
  if (pathname.startsWith('/quotes/')) return '/quotes';
  if (userId && pathname === `/profile/${userId}`) return `/profile/${userId}`;
  if (pathname === '/admin/quotes') return '/admin/quotes';
  if (pathname === '/admin/users') return '/admin/users';
  if (pathname === '/admin/categories') return '/admin/categories';
  if (pathname === '/admin/lists') return '/admin/lists';
  if (pathname === '/admin/settings') return '/admin/settings';
  if (pathname.startsWith('/admin')) return '/admin/quotes';
  if (pathname === '/notifications') return '/notifications';
  if (pathname === '/invite-codes') return '/invite-codes';
  if (pathname === '/invites') return '/invites';
  if (pathname === '/playground') return '/playground';
  if (pathname === '/docs') return '/docs';
  if (pathname === '/leaderboard') return '/leaderboard';
  if (pathname === '/lists') return '/lists';
  if (pathname.startsWith('/lists/')) return '/lists';
  if (pathname === '/public-lists') return '/public-lists';
  if (pathname.startsWith('/shared/')) return '/public-lists';
  if (pathname === '/organizations') return '/organizations';
  if (pathname.startsWith('/organizations/')) return '/organizations';
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
  const [openKeys, setOpenKeys] = useState<string[]>(() => {
    const keys: string[] = [];
    if (selectedKey.startsWith('/admin/')) keys.push('admin-group');
    if (selectedKey === '/playground' || selectedKey === '/docs') keys.push('api-group');
    if (selectedKey === '/quotes' || selectedKey.startsWith('/quotes/') || selectedKey === '/leaderboard') keys.push('browse-group');
    if (selectedKey === '/quotes/new' || selectedKey === '/lists' || selectedKey.startsWith('/lists/') || selectedKey === '/public-lists' || selectedKey.startsWith('/shared/')) {
      keys.push('create-group');
      keys.push('lists-group');
    }
    if (selectedKey === '/organizations' || selectedKey.startsWith('/organizations/') || selectedKey === '/invites' || selectedKey === '/invite-codes') keys.push('social-group');
    if (user && (selectedKey === `/profile/${user.id}` || selectedKey === '/notifications')) keys.push('me-group');
    return keys;
  });

  useEffect(() => {
    const add = (k: string) => setOpenKeys((prev) => prev.includes(k) ? prev : [...prev, k]);
    if (selectedKey.startsWith('/admin/')) add('admin-group');
    if (selectedKey === '/playground' || selectedKey === '/docs') add('api-group');
    if (selectedKey === '/quotes' || selectedKey.startsWith('/quotes/') || selectedKey === '/leaderboard') add('browse-group');
    if (selectedKey === '/quotes/new' || selectedKey === '/lists' || selectedKey.startsWith('/lists/') || selectedKey === '/public-lists' || selectedKey.startsWith('/shared/')) {
      add('create-group');
      add('lists-group');
    }
    if (selectedKey === '/organizations' || selectedKey.startsWith('/organizations/') || selectedKey === '/invites' || selectedKey === '/invite-codes') add('social-group');
    if (user && (selectedKey === `/profile/${user.id}` || selectedKey === '/notifications')) add('me-group');
  }, [selectedKey, user?.id]);

  const menuItems = [
    { key: '/', icon: <HomeOutlined />, label: '一言' },
    { type: 'divider' as const },
    {
      key: 'browse-group',
      icon: <ReadOutlined />,
      label: '浏览',
      children: [
        { key: '/quotes', icon: <ReadOutlined />, label: '语录' },
        { key: '/leaderboard', icon: <CrownOutlined />, label: '排行榜' },
      ],
    },
    {
      key: 'api-group',
      icon: <CodeOutlined />,
      label: 'API',
      children: [
        { key: '/playground', icon: <ExperimentOutlined />, label: 'Playground' },
        { key: '/docs', icon: <BookOutlined />, label: '文档' },
      ],
    },
    ...(user
      ? [
          {
            key: 'create-group',
            icon: <PlusOutlined />,
            label: '创作',
            children: [
              { key: '/quotes/new', icon: <PlusOutlined />, label: '发布' },
              {
                key: 'lists-group',
                icon: <FolderOutlined />,
                label: '列表',
                children: [
                  { key: '/lists', icon: <UnorderedListOutlined />, label: '我的列表' },
                  { key: '/public-lists', icon: <UnlockOutlined />, label: '公共列表' },
                ],
              },
            ],
          },
          {
            key: 'social-group',
            icon: <TeamOutlined />,
            label: '社交',
            children: [
              { key: '/organizations', icon: <TeamOutlined />, label: '组织' },
              { key: '/invites', icon: <BellOutlined />, label: '邀请' },
              { key: '/invite-codes', icon: <KeyOutlined />, label: '邀请码' },
            ],
          },
          {
            key: 'me-group',
            icon: <UserOutlined />,
            label: '个人',
            children: [
              { key: `/profile/${user.id}`, icon: <UserOutlined />, label: '我的' },
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
            ],
          },
          ...(user.role === 'admin' || (user.permissions ?? 0) & 32 || (user.permissions ?? 0) & 1 || (user.permissions ?? 0) & 2 || (user.permissions ?? 0) & 16
            ? [
                {
                  key: 'admin-group',
                  icon: <SettingOutlined />,
                  label: '管理',
                  children: [
                    ...((user.role === 'admin' || (user.permissions ?? 0) & 32 || (user.permissions ?? 0) & 1) ? [{ key: '/admin/quotes', icon: <OrderedListOutlined />, label: '语录管理' }] : []),
                    ...(user.role === 'admin' || (user.permissions ?? 0) & 32 ? [{ key: '/admin/users', icon: <UserOutlined />, label: '用户管理' }] : []),
                    ...((user.role === 'admin' || (user.permissions ?? 0) & 32 || (user.permissions ?? 0) & 2) ? [{ key: '/admin/categories', icon: <TagsOutlined />, label: '分类管理' }] : []),
                    ...((user.role === 'admin' || (user.permissions ?? 0) & 32 || (user.permissions ?? 0) & 16) ? [{ key: '/admin/lists', icon: <FolderOutlined />, label: '列表管理' }] : []),
                    ...(user.role === 'admin' || (user.permissions ?? 0) & 32 ? [{ key: '/admin/settings', icon: <ToolOutlined />, label: '系统设置' }] : []),
                  ],
                },
              ]
            : []),
        ]
      : anonUpload
        ? [{ key: '/quotes/new', icon: <PlusOutlined />, label: '发布' }]
        : []),
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
        openKeys={openKeys}
        onOpenChange={setOpenKeys}
        items={menuItems}
        onClick={onMenuClick}
        style={{ border: 'none', marginTop: 8, paddingBottom: 48 }}
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
