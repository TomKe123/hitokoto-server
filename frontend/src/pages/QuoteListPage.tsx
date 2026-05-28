import { useState, useEffect } from 'react';
import { Card, Tag, Pagination, Select, Input, Row, Col, Typography, Empty, Grid } from 'antd';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

const { Paragraph, Title } = Typography;
const { useBreakpoint } = Grid;

interface Quote {
  uuid: string;
  content: string;
  from: string;
  category: string;
  source: string;
  contributor_id: number;
  status: string;
  created_at: string;
}

interface QuoteListResponse {
  quotes: Quote[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

const categoryColors: Record<string, string> = {
  anime: 'volcano',
  manga: 'orange',
  novel: 'blue',
  game: 'green',
  movie: 'purple',
  music: 'pink',
  other: 'default',
};

const statusColors: Record<string, string> = { pending: 'orange', approved: 'green', rejected: 'red' };
const statusLabels: Record<string, string> = { pending: '待审核', approved: '已通过', rejected: '已驳回' };

export default function QuoteListPage() {
  const [data, setData] = useState<QuoteListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const page = parseInt(searchParams.get('page') || '1');
  const category = searchParams.get('category') || '';
  const keyword = searchParams.get('keyword') || '';

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string | number> = { page, page_size: 20 };
    if (category) params.category = category;
    if (keyword) params.keyword = keyword;

    api.get('/quotes', { params })
      .then((res) => setData(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, category, keyword]);

  const handleSearch = (value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) params.set('keyword', value);
    else params.delete('keyword');
    params.set('page', '1');
    setSearchParams(params);
  };

  if (loading) {
    return (
      <div>
        <Title level={isMobile ? 4 : 3}>一言语录</Title>
        <Card loading />
      </div>
    );
  }

  const quotes = data?.quotes;
  const hasQuotes = Array.isArray(quotes) && quotes.length > 0;

  return (
    <div>
      <Title level={3}>一言语录</Title>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12}>
          <Input.Search
            placeholder="搜索语录..."
            defaultValue={keyword}
            onSearch={handleSearch}
            allowClear
          />
        </Col>
        <Col xs={24} sm={12}>
          <Select
            style={{ width: '100%' }}
            placeholder="选择分类"
            allowClear
            value={category || undefined}
            onChange={(val) => {
              const params = new URLSearchParams(searchParams);
              if (val) params.set('category', val);
              else params.delete('category');
              params.set('page', '1');
              setSearchParams(params);
            }}
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
        </Col>
      </Row>

      {hasQuotes ? (
        <>
          <Row gutter={[16, 16]}>
            {quotes.map((q) => (
              <Col xs={24} sm={12} key={q.uuid}>
                <Card
                  hoverable
                  onClick={() => navigate(`/quotes/${q.uuid}`)}
                  style={{ height: '100%' }}
                >
                  <Paragraph ellipsis={{ rows: 3 }}>{q.content}</Paragraph>
                  <div style={{ marginTop: 8 }}>
                    <Tag color={categoryColors[q.category] || 'default'}>{q.category}</Tag>
                    {q.from && <span style={{ color: '#999', fontSize: 12 }}>—— {q.from}</span>}
                    {user && q.contributor_id === user.id && (
                      <Tag color={statusColors[q.status]} style={{ marginLeft: 8 }}>
                        {statusLabels[q.status] || q.status}
                      </Tag>
                    )}
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <Pagination
              current={data!.page}
              total={data!.total}
              pageSize={data!.page_size}
              onChange={(p) => {
                const params = new URLSearchParams(searchParams);
                params.set('page', String(p));
                setSearchParams(params);
              }}
              showTotal={(total) => `共 ${total} 条`}
              responsive
              size={isMobile ? 'small' : undefined}
            />
          </div>
        </>
      ) : (
        <Empty description="暂无语录" />
      )}
    </div>
  );
}
