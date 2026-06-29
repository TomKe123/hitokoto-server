import { useState, useEffect, useCallback } from 'react';
import { Typography, Card, Tag, Button, Row, Col, Grid, Spin, Space, Divider } from 'antd';
import { ReloadOutlined, RightCircleOutlined, BookOutlined, PlusOutlined, CodeOutlined, CrownOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { useTheme } from '../contexts/ThemeContext';

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

interface Quote {
  uuid: string;
  content: string;
  from: string;
  category: string;
  categories?: string[];
  source: string;
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

export default function HomePage() {
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const { mode } = useTheme();
  const isDark = mode === 'dark';

  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRandom = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/quotes/random');
      setQuote(res.data.quote);
    } catch (err: any) {
      setError(err.response?.data?.error || '获取失败');
      setQuote(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRandom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const quickLinks = [
    {
      icon: <BookOutlined style={{ fontSize: 22, color: '#F59E0B' }} />,
      title: '浏览语录',
      desc: '所有精选语录',
      path: '/quotes',
    },
    {
      icon: <CrownOutlined style={{ fontSize: 22, color: '#faad14' }} />,
      title: '排行榜',
      desc: '最受欢迎语录',
      path: '/leaderboard',
    },
    {
      icon: <CodeOutlined style={{ fontSize: 22, color: '#1890ff' }} />,
      title: 'API Playground',
      desc: '可视化调试接口',
      path: '/playground',
    },
    {
      icon: <PlusOutlined style={{ fontSize: 22, color: '#52c41a' }} />,
      title: '发布语录',
      desc: '分享你喜欢的一句话',
      path: '/quotes/new',
    },
  ];

  return (
    <div>
      {/* ── Compact quote bar ── */}
      <Card
        style={{ marginBottom: 20, borderRadius: 10, border: `1px solid ${isDark ? '#4A4338' : '#E0D4C0'}` }}
        styles={{ body: { padding: isMobile ? '12px 16px' : '14px 24px' } }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
            {error && !quote ? (
              <Text type="danger" style={{ fontSize: 13 }}>{error}</Text>
            ) : quote ? (
              <Space split={<Divider type="vertical" />} wrap style={{ paddingRight: 24 }}>
                <Text
                  style={{
                    fontSize: isMobile ? 14 : 16,
                    color: isDark ? '#E0D4C0' : '#1a1a2e',
                    fontStyle: 'italic',
                    lineHeight: 1.6,
                  }}
                >
                  「{quote.content.length > 80 ? quote.content.slice(0, 80) + '…' : quote.content}」
                </Text>
                <Text type="secondary" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                  {quote.from || quote.category}
                </Text>
                <Tag color={categoryColors[quote.category] || 'default'} style={{ marginRight: 0 }}>
                  {quote.category}
                </Tag>
              </Space>
            ) : loading ? (
              <Spin size="small" style={{ display: 'block', margin: '4px 0' }} />
            ) : null}
            {loading && quote && (
              <span style={{ position: 'absolute', right: 0, top: 0, bottom: 0, display: 'flex', alignItems: 'center' }}>
                <Spin size="small" />
              </span>
            )}
          </div>
          <div style={{ flexShrink: 0 }}>
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              onClick={fetchRandom}
              loading={loading}
              size={isMobile ? 'small' : 'middle'}
              style={{ whiteSpace: 'nowrap' }}
            >
              {isMobile ? '' : '换一换'}
            </Button>
          </div>
        </div>
      </Card>

      {/* ── Quick Links ── */}
      <div style={{ marginBottom: 24 }}>
        <Title level={5} style={{ marginBottom: 12 }}>
          <RightCircleOutlined style={{ marginRight: 6 }} />
          快速入口
        </Title>
        <Row gutter={[12, 12]}>
          {quickLinks.map((link) => (
            <Col xs={12} sm={6} key={link.path}>
              <Card
                hoverable
                size="small"
                style={{ borderRadius: 10, height: '100%', border: `1px solid ${isDark ? '#4A4338' : '#E0D4C0'}` }}
                styles={{ body: { padding: isMobile ? '12px' : '14px 12px' } }}
                onClick={() => navigate(link.path)}
              >
                <Space>
                  {link.icon}
                  <div>
                    <Text strong style={{ fontSize: 14, display: 'block', lineHeight: 1.4 }}>
                      {link.title}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {link.desc}
                    </Text>
                  </div>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      </div>
    </div>
  );
}
