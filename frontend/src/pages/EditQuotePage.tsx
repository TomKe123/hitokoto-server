import { useState, useEffect } from 'react';
import { Form, Input, Select, Button, Card, Typography, message, Spin, Grid } from 'antd';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import useCategories from '../hooks/useCategories';

const { Title } = Typography;
const { TextArea } = Input;
const { useBreakpoint } = Grid;

export default function EditQuotePage() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { categories, loading: catLoading } = useCategories();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  useEffect(() => {
    api.get(`/quotes/${id}`)
      .then((res) => {
        const q = res.data.quote;
        if (user?.id !== q.contributor_id) {
          message.error('无权编辑');
          navigate('/');
          return;
        }
        form.setFieldsValue({
          ...q,
          categories: q.categories && q.categories.length > 0 ? q.categories : (q.category ? [q.category] : []),
        });
      })
      .catch(() => message.error('语录不存在'))
      .finally(() => setFetching(false));
  }, [id]);

  const onFinish = async (values: { content: string; from: string; categories: string[]; source: string }) => {
    setLoading(true);
    try {
      const payload: Record<string, unknown> = {};
      if (values.content) payload.content = values.content;
      if (values.from) payload.from = values.from;
      if (values.source) payload.source = values.source;
      if (values.categories && values.categories.length > 0) payload.categories = values.categories;
      await api.put(`/quotes/${id}`, payload);
      message.success('更新成功');
      navigate(`/quotes/${id}`);
    } catch (err: any) {
      message.error(err.response?.data?.error || '更新失败');
    } finally {
      setLoading(false);
    }
  };

  if (fetching) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <Title level={isMobile ? 4 : 3}>编辑语录</Title>
      <Card>
        <Form form={form} layout="vertical" onFinish={onFinish} size="large">
          <Form.Item name="content" label="正文" rules={[{ required: true, message: '请输入语录正文' }]}>
            <TextArea rows={4} />
          </Form.Item>
          <Form.Item name="from" label="出自">
            <Input />
          </Form.Item>
          <Form.Item name="categories" label="分类" rules={[{ required: true, message: '请选择至少一个分类' }]}>
            <Select
              mode="multiple"
              options={categories.map((c) => ({ value: c.name, label: c.display_name || c.name }))}
              loading={catLoading}
            />
          </Form.Item>
          <Form.Item name="source" label="来源">
            <Input />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              保存
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
