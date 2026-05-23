import { useState, useEffect } from 'react';
import { Form, Input, Select, Button, Card, Typography, message, Spin } from 'antd';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

const { Title } = Typography;
const { TextArea } = Input;

export default function EditQuotePage() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    api.get(`/quotes/${id}`)
      .then((res) => {
        const q = res.data.quote;
        if (user?.id !== q.contributor_id) {
          message.error('无权编辑');
          navigate('/');
          return;
        }
        form.setFieldsValue(q);
      })
      .catch(() => message.error('语录不存在'))
      .finally(() => setFetching(false));
  }, [id]);

  const onFinish = async (values: { content: string; from: string; category: string; source: string }) => {
    setLoading(true);
    try {
      const filtered: Record<string, string> = {};
      Object.entries(values).forEach(([k, v]) => { if (v) filtered[k] = v; });
      await api.put(`/quotes/${id}`, filtered);
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
      <Title level={3}>编辑语录</Title>
      <Card>
        <Form form={form} layout="vertical" onFinish={onFinish} size="large">
          <Form.Item name="content" label="正文" rules={[{ required: true, message: '请输入语录正文' }]}>
            <TextArea rows={4} />
          </Form.Item>
          <Form.Item name="from" label="出自">
            <Input />
          </Form.Item>
          <Form.Item name="category" label="分类" rules={[{ required: true, message: '请选择分类' }]}>
            <Select
              options={[
                { value: 'anime', label: '动画' },
                { value: 'comic', label: '漫画' },
                { value: 'novel', label: '小说' },
                { value: 'game', label: '游戏' },
                { value: 'movie', label: '电影' },
                { value: 'music', label: '音乐' },
                { value: 'other', label: '其他' },
              ]}
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
