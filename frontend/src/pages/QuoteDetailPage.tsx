import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Tag, Typography, Button, Descriptions, Popconfirm, message, Spin } from 'antd';
import { ArrowLeftOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import dayjs from 'dayjs';

const { Paragraph } = Typography;

const statusColors: Record<string, string> = { pending: 'orange', approved: 'green', rejected: 'red' };
const statusLabels: Record<string, string> = { pending: '待审核', approved: '已通过', rejected: '已驳回' };
function statusTag(status: string) {
  return <Tag color={statusColors[status] || 'default'}>{statusLabels[status] || status}</Tag>;
}

interface Quote {
  uuid: string;
  content: string;
  from: string;
  category: string;
  source: string;
  contributor_id: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    api.get(`/quotes/${id}`)
      .then((res) => setQuote(res.data.quote))
      .catch(() => message.error('语录不存在'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleDelete = async () => {
    try {
      await api.delete(`/quotes/${id}`);
      message.success('删除成功');
      navigate('/');
    } catch {
      message.error('删除失败');
    }
  };

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!quote) return null;

  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>
        返回
      </Button>
      <Card style={{ marginTop: 16 }}>
        <Paragraph style={{ fontSize: 18, lineHeight: 1.8 }}>{quote.content}</Paragraph>
        <Descriptions column={1} style={{ marginTop: 24 }}>
          {quote.from && <Descriptions.Item label="出自">{quote.from}</Descriptions.Item>}
          {quote.source && <Descriptions.Item label="来源">{quote.source}</Descriptions.Item>}
          <Descriptions.Item label="分类">
            <Tag>{quote.category}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            {statusTag(quote.status)}
          </Descriptions.Item>
          <Descriptions.Item label="唯一编码">{quote.uuid}</Descriptions.Item>
          <Descriptions.Item label="贡献者 ID">{quote.contributor_id}</Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {dayjs(quote.created_at).format('YYYY-MM-DD HH:mm:ss')}
          </Descriptions.Item>
        </Descriptions>

        {user?.id === quote.contributor_id && (
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <Button icon={<EditOutlined />} onClick={() => navigate(`/quotes/${quote.uuid}/edit`)}>
              编辑
            </Button>
            <Popconfirm title="确定删除这条语录？" onConfirm={handleDelete}>
              <Button danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </div>
        )}
      </Card>
    </div>
  );
}
