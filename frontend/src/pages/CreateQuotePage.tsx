import { useState } from 'react';
import { Form, Input, Select, Button, Card, Typography, message, Alert } from 'antd';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

const { Title } = Typography;
const { TextArea } = Input;

export default function CreateQuotePage() {
  const [loading, setLoading] = useState(false);
  const [submittedPending, setSubmittedPending] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  const isModerator = user?.role === 'admin' || user?.role === 'collaborator';

  const onFinish = async (values: { content: string; from: string; category: string; source: string }) => {
    setLoading(true);
    try {
      const res = await api.post('/quotes', values);
      if (res.data.quote.status === 'pending') {
        setSubmittedPending(true);
      } else {
        message.success('发布成功');
        navigate(`/quotes/${res.data.quote.uuid}`);
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || '发布失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <Title level={3}>发布语录</Title>
      {submittedPending ? (
        <Card>
          <Alert
            type="info"
            message="语录已提交，等待审核"
            description="您的语录已成功提交，目前处于待审核状态。审核通过后将公开展示。"
            showIcon
          />
          <Button type="primary" style={{ marginTop: 16 }} onClick={() => { setSubmittedPending(false); navigate('/'); }}>
            返回列表
          </Button>
        </Card>
      ) : (
      <Card>
        {!isModerator && (
          <Alert
            type="info"
            message="您提交的语录需要审核通过后才能公开展示"
            style={{ marginBottom: 16 }}
            showIcon
          />
        )}
        <Form layout="vertical" onFinish={onFinish} size="large">
          <Form.Item name="content" label="正文" rules={[{ required: true, message: '请输入语录正文' }]}>
            <TextArea rows={4} placeholder="输入语录内容..." />
          </Form.Item>
          <Form.Item name="from" label="出自">
            <Input placeholder="作品名称/人物" />
          </Form.Item>
          <Form.Item name="category" label="分类" rules={[{ required: true, message: '请选择分类' }]}>
            <Select
              placeholder="选择分类"
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
            <Input placeholder="出处链接或说明" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              发布
            </Button>
          </Form.Item>
        </Form>
      </Card>
      )}
    </div>
  );
}
