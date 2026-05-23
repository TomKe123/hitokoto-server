import type { ReactNode } from 'react';
import { Layout as AntLayout, Menu, Button, Typography } from 'antd';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  HomeOutlined,
  PlusOutlined,
  UserOutlined,
  LoginOutlined,
  LogoutOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';

const { Header, Content, Footer } = AntLayout;
const { Title } = Typography;

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [
    { key: '/', icon: <HomeOutlined />, label: '语录' },
    ...(user
      ? [
          { key: '/quotes/new', icon: <PlusOutlined />, label: '发布' },
          { key: `/profile/${user.id}`, icon: <UserOutlined />, label: '我的' },
          ...(user.role === 'admin' ? [{ key: '/admin', icon: <SettingOutlined />, label: '管理' }] : []),
        ]
      : []),
  ];

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
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <Title level={4} style={{ margin: 0, cursor: 'pointer' }} onClick={() => navigate('/')}>
            一言
          </Title>
          <Menu
            mode="horizontal"
            selectedKeys={[location.pathname]}
            items={menuItems}
            onClick={({ key }) => navigate(key)}
            style={{ border: 'none', flex: 1 }}
          />
        </div>
        <div>
          {user ? (
            <Button type="text" icon={<LogoutOutlined />} onClick={logout}>
              退出
            </Button>
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
      <Footer style={{ textAlign: 'center', color: '#999' }}>
        一言 Hitokoto Server
      </Footer>
    </AntLayout>
  );
}
