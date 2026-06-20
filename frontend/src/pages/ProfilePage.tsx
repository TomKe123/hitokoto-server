import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card, Typography, Tabs, List, Tag, Pagination, Spin, Button, Form, Input,
  message, Grid,
} from 'antd';
import { UserOutlined, EditOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import dayjs from 'dayjs';

const { Title } = Typography;
const { useBreakpoint } = Grid;

interface UserProfile {
  id: number;
  username: string;
  email?: string;
  quote_count: number;
  created_at: string;
}

interface Quote {
  uuid: string;
  content: string;
  category: string;
  from: string;
  status: string;
  created_at: string;
}

export default function ProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { user: currentUser } = useAuth();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const isOwner = currentUser?.id === Number(id);
  const isAnonymous = id === '-1';

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get(`/users/${id}`),
      api.get(`/users/${id}/quotes`, { params: { page, page_size: 20 } }),
    ])
      .then(([profileRes, quotesRes]) => {
        setProfile(profileRes.data.user);
        setQuotes(quotesRes.data.quotes);
        setTotal(quotesRes.data.total);
      })
      .catch(() => message.error('用户不存在'))
      .finally(() => setLoading(false));
  }, [id, page]);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!profile) return null;

  if (isAnonymous) {
    return (
      <div style={{ maxWidth: 700, margin: '0 auto' }}>
        <Card>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div
              style={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #52c41a, #b7eb8f)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto',
              }}
            >
              <QuestionCircleOutlined style={{ fontSize: 40, color: '#fff' }} />
            </div>
            <Title level={3} style={{ marginTop: 12, color: '#52c41a' }}>Anonymous</Title>
            <div style={{ color: 'var(--surface-muted-text)', fontSize: 14 }}>
              匿名用户 · 贡献了 {profile.quote_count} 条语录
            </div>
            <Tag color="green" style={{ marginTop: 8 }}>未登录用户通过邀请码提交</Tag>
          </div>
        </Card>

        <Title level={4} style={{ marginTop: 24 }}>贡献的语录</Title>
        <List
          dataSource={quotes}
          renderItem={(q) => (
            <List.Item
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/quotes/${q.uuid}`)}
            >
              <List.Item.Meta
                title={
                  <span>
                    {q.content.length > 60 ? q.content.slice(0, 60) + '...' : q.content}
                    <Tag style={{ marginLeft: 8 }}>{q.category}</Tag>
                  </span>
                }
                description={
                  <span>
                    {q.from && `出自: ${q.from}`}
                    {q.from && ' | '}
                    {dayjs(q.created_at).format('YYYY-MM-DD')}
                  </span>
                }
              />
            </List.Item>
          )}
        />
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Pagination
            current={page}
            total={total}
            pageSize={20}
            onChange={setPage}
            showTotal={(t) => `共 ${t} 条`}
            responsive
            size={isMobile ? 'small' : undefined}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <Card>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <UserOutlined style={{ fontSize: 64, color: '#F59E0B' }} />
          <Title level={3} style={{ marginTop: 8 }}>{profile.username}</Title>
          {isOwner && profile.email && (
            <div style={{ color: 'var(--surface-muted-text)' }}>{profile.email}</div>
          )}
          <div style={{ color: 'var(--surface-muted-text)', fontSize: 14 }}>
            贡献了 {profile.quote_count} 条语录
          </div>
        </div>

        {isOwner && <ProfileSettings />}
      </Card>

      <Title level={4} style={{ marginTop: 24 }}>贡献的语录</Title>
      <List
        dataSource={quotes}
        renderItem={(q) => (
          <List.Item
            style={{ cursor: 'pointer' }}
            onClick={() => navigate(`/quotes/${q.uuid}`)}
            actions={
              q.status === 'rejected'
                ? [
                    <Button
                      type="link"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={(e) => { e.stopPropagation(); navigate(`/quotes/${q.uuid}/edit`); }}
                    >
                      编辑重新提交
                    </Button>,
                  ]
                : undefined
            }
          >
            <List.Item.Meta
              title={
                <span>
                  {q.content.length > 60 ? q.content.slice(0, 60) + '...' : q.content}
                  <Tag style={{ marginLeft: 8 }}>{q.category}</Tag>
                  <Tag
                    color={q.status === 'approved' ? 'green' : q.status === 'rejected' ? 'red' : 'orange'}
                    style={{ marginLeft: 4 }}
                  >
                    {q.status === 'approved' ? '已通过' : q.status === 'rejected' ? '已驳回' : '待审核'}
                  </Tag>
                </span>
              }
              description={
                <span>
                  {q.from && `出自: ${q.from}`}
                  {q.from && ' | '}
                  {dayjs(q.created_at).format('YYYY-MM-DD')}
                </span>
              }
            />
          </List.Item>
        )}
      />
      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <Pagination
          current={page}
          total={total}
          pageSize={20}
          onChange={setPage}
          showTotal={(t) => `共 ${t} 条`}
          responsive
          size={isMobile ? 'small' : undefined}
        />
      </div>
    </div>
  );
}

function ProfileSettings() {
  const { user, fetchUser } = useAuth();
  const [pwForm] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const updateProfile = async (values: { username: string; email: string }) => {
    setSaving(true);
    try {
      await api.put('/users/profile', values);
      message.success('更新成功');
      fetchUser();
    } catch (err: any) {
      message.error(err.response?.data?.error || '更新失败');
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (values: { old_password: string; new_password: string }) => {
    setSaving(true);
    try {
      await api.put('/users/password', values);
      message.success('密码修改成功');
      pwForm.resetFields();
    } catch (err: any) {
      message.error(err.response?.data?.error || '修改失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Tabs
      items={[
        {
          key: 'profile',
          label: '编辑资料',
          children: (
            <Form
              layout="vertical"
              initialValues={{ username: user?.username, email: user?.email }}
              onFinish={updateProfile}
            >
              <Form.Item name="username" label="用户名" rules={[{ min: 3, message: '用户名至少3个字符' }, { pattern: /^[a-zA-Z0-9_]+$/, message: '用户名只能包含字母、数字和下划线' }]}>
                <Input />
              </Form.Item>
              <Form.Item name="email" label="邮箱" rules={[{ type: 'email' }]}>
                <Input />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={saving}>保存</Button>
            </Form>
          ),
        },
        {
          key: 'password',
          label: '修改密码',
          children: (
            <Form layout="vertical" onFinish={changePassword} form={pwForm}>
              <Form.Item name="old_password" label="当前密码" rules={[{ required: true }]}>
                <Input.Password />
              </Form.Item>
              <Form.Item name="new_password" label="新密码" rules={[{ required: true, min: 8, message: '至少8个字符' }]}>
                <Input.Password />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={saving}>修改密码</Button>
            </Form>
          ),
        },
      ]}
    />
  );
}
