import { useState } from 'react';
import { Form, Input, Select, Button, Card, Typography, message, Alert, Grid, Spin } from 'antd';
import { KeyOutlined } from '@ant-design/icons';
import { useNavigate, Link } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useSiteConfig } from '../contexts/SiteConfigContext';
import useCategories from '../hooks/useCategories';

const { Title } = Typography;
const { TextArea } = Input;
const { useBreakpoint } = Grid;

export default function CreateQuotePage() {
  const [loading, setLoading] = useState(false);
  const [submittedPending, setSubmittedPending] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { anonymous_upload: anonUpload, loaded } = useSiteConfig();
  const { categories, loading: catLoading } = useCategories();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const isAnonymous = !user;
  const isModerator = user?.role === 'admin' || ((user?.permissions ?? 0) & 1) !== 0;

  if (!loaded) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  if (isAnonymous && !anonUpload) {
    return (
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        <Title level={isMobile ? 4 : 3}>发布语录</Title>
        <Card>
          <Alert
            type="warning"
            message="请先登录"
            description="发布语录需要先登录账号，或者等待管理员开启匿名上传功能。"
            showIcon
            style={{ marginBottom: 16 }}
          />
          <Button type="primary" onClick={() => navigate('/login')}>
            去登录
          </Button>
        </Card>
      </div>
    );
  }

  const onFinish = async (values: {
    content: string;
    from: string;
    categories: string[];
    source: string;
    invite_code?: string;
  }) => {
    setLoading(true);
    try {
      if (isAnonymous) {
        await api.post('/quotes/invite', {
          content: values.content,
          from: values.from,
          categories: values.categories,
          source: values.source,
          invite_code: values.invite_code,
        });
        setSubmittedPending(true);
      } else {
        const res = await api.post('/quotes', {
          content: values.content,
          from: values.from,
          categories: values.categories,
          source: values.source,
        });
        if (res.data.quote.status === 'pending') {
          setSubmittedPending(true);
        } else {
          message.success('发布成功');
          navigate(`/quotes/${res.data.quote.uuid}`);
        }
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || '发布失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <Title level={isMobile ? 4 : 3}>发布语录</Title>
      {submittedPending ? (
        <Card>
          <Alert
            type="info"
            message="语录已提交，等待审核"
            description="您的语录已成功提交，目前处于待审核状态。审核通过后将公开展示。"
            showIcon
          />
          <Button
            type="primary"
            style={{ marginTop: 16 }}
            onClick={() => {
              setSubmittedPending(false);
              navigate('/');
            }}>
            返回列表
          </Button>
        </Card>
      ) : (
        <Card>
          {isAnonymous && (
            <Alert
              type="info"
              message="匿名投稿模式"
              description="您未登录，需要通过邀请码提交语录，提交后将进入审核队列。"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}
          {!isAnonymous && !isModerator && (
            <Alert
              type="info"
              message="您提交的语录需要审核通过后才能公开展示"
              style={{ marginBottom: 16 }}
              showIcon
            />
          )}
          {!isAnonymous && isModerator && (
            <Alert
              type="success"
              message="作为版主，您提交的语录将自动通过审核"
              style={{ marginBottom: 16 }}
              showIcon
            />
          )}
          <Form layout="vertical" onFinish={onFinish} size="large">
            {isAnonymous && (
              <Form.Item
                name="invite_code"
                label="邀请码"
                rules={[{ required: true, message: '请输入邀请码' }]}>
                <Input prefix={<KeyOutlined />} placeholder="输入邀请码" />
              </Form.Item>
            )}
            <Form.Item name="content" label="正文" rules={[{ required: true, message: '请输入语录正文' }]}>
              <TextArea rows={4} placeholder="输入语录内容..." />
            </Form.Item>
            <Form.Item name="from" label="出自">
              <Input placeholder="作品名称/人物" />
            </Form.Item>
            <Form.Item name="categories" label="分类" rules={[{ required: true, message: '请选择至少一个分类' }]}>
              <Select
                mode="multiple"
                placeholder="选择一个或多个分类"
                options={categories.map((c) => ({ value: c.name, label: c.display_name || c.name }))}
                loading={catLoading}
              />
            </Form.Item>
            <Form.Item name="source" label="来源">
              <Input placeholder="出处链接或说明" />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" block loading={loading}>
                发布
              </Button>
            </Form.Item>
            {isAnonymous && (
              <div style={{ textAlign: 'center' }}>
                已有账号？<Link to="/login">立即登录</Link>
              </div>
            )}
          </Form>
        </Card>
      )}
    </div>
  );
}
