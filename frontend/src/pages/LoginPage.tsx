import { useState } from 'react';
import { Form, Input, Button, Card, Typography, message, Tabs, Alert, Grid } from 'antd';
import { UserOutlined, MailOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

const { Title } = Typography;
const { useBreakpoint } = Grid;

const ERROR_MAP: Record<string, string> = {
  'invalid credentials': '用户名或密码错误',
  'user not found': '用户不存在',
  'account is banned': '账号已被封禁',
  'invalid request': '请求参数有误',
};

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isBanned = searchParams.get('banned') === '1';
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const getErrorMessage = (err: any): string => {
    const msg: string = err.response?.data?.error || '';
    return ERROR_MAP[msg.toLowerCase()] || msg || '登录失败，请重试';
  };

  const onFinish = async (values: { username?: string; email?: string; password: string }) => {
    setError(null);
    setLoading(true);
    try {
      const res = await api.post('/auth/login', values);
      login(res.data.access_token, res.data.refresh_token, res.data.user);
      message.success('登录成功');
      const redirect = searchParams.get('redirect');
      navigate(redirect || '/');
    } catch (err: any) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: isMobile ? '24px auto' : '60px auto', padding: isMobile ? '0 16px' : 0 }}>
      <Card>
        <Title level={3} style={{ textAlign: 'center' }}>
          登录
        </Title>

        {isBanned && (
          <Alert
            message="账号已被封禁"
            description="您的账号因违反社区规则已被封禁，如有疑问请联系管理员。"
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        {error && !isBanned && (
          <Alert
            message={error}
            type="error"
            showIcon
            closable
            onClose={() => setError(null)}
            style={{ marginBottom: 16 }}
          />
        )}

        <Form onFinish={onFinish} layout="vertical" size="large" onValuesChange={() => setError(null)}>
          <Tabs
            items={[
              {
                key: 'username',
                label: '用户名登录',
                children: (
                  <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
                    <Input prefix={<UserOutlined />} placeholder="用户名" />
                  </Form.Item>
                ),
              },
              {
                key: 'email',
                label: '邮箱登录',
                children: (
                  <Form.Item name="email" rules={[{ required: true, type: 'email', message: '请输入有效邮箱' }]}>
                    <Input prefix={<MailOutlined />} placeholder="邮箱" />
                  </Form.Item>
                ),
              },
            ]}
          />
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              登录
            </Button>
          </Form.Item>
          <div style={{ textAlign: 'center' }}>
            还没有账号？<Link to="/register">立即注册</Link>
          </div>
        </Form>
      </Card>
    </div>
  );
}
