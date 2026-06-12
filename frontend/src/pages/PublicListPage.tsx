import { useState, useEffect } from 'react';
import {
  Typography, Spin, Card, List, Tag, Button, Input, Grid, message, Empty, Pagination, Space,
} from 'antd';
import { LockOutlined, UnlockOutlined, KeyOutlined } from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import api from '../utils/api';

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

interface ListInfo {
  uuid: string;
  name: string;
  description: string;
  is_public: boolean;
  item_count: number;
  owner: string;
  created_at: string;
  updated_at: string;
}

interface ListItemData {
  id: number;
  quote_id: number;
  quote_uuid?: string;
  quote_content?: string;
  quote_from?: string;
  quote_category?: string;
  sort_order: number;
}

interface PublicListData {
  list: ListInfo;
  items: ListItemData[];
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

export default function PublicListPage() {
  const { uuid } = useParams<{ uuid: string }>();
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [data, setData] = useState<PublicListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [apiKey, setApiKey] = useState('');
  const [validatedKey, setValidatedKey] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPublicList = (key?: string) => {
    if (!uuid) return;
    setLoading(true);
    setError(null);

    const headers: Record<string, string> = {};
    const effectiveKey = key || validatedKey;
    if (effectiveKey) headers['Authorization'] = `Bearer ${effectiveKey}`;

    api.get(`/public/lists/${uuid}`, {
      params: { page, page_size: pageSize },
      headers,
    })
      .then((res) => {
        setData(res.data);
        setShowKeyInput(false);
      })
      .catch((err) => {
        const status = err.response?.status;
        if (status === 401) {
          setError('private');
          setShowKeyInput(true);
          setValidatedKey('');
        } else if (status === 403) {
          message.error('API Key 无效');
          setError('private');
          setShowKeyInput(true);
          setValidatedKey('');
        } else if (status === 404) {
          setError('not_found');
        } else {
          setError('error');
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchPublicList(); }, [uuid, page]);

  const handleKeySubmit = () => {
    if (!apiKey.trim()) {
      message.warning('请输入 API Key');
      return;
    }
    setFetching(true);
    setPage(1);
    // We need to re-fetch with the key
    setLoading(true);
    setError(null);

    const headers = { Authorization: `Bearer ${apiKey.trim()}` };
    api.get(`/public/lists/${uuid}`, {
      params: { page: 1, page_size: pageSize },
      headers,
    })
      .then((res) => {
        setData(res.data);
        setShowKeyInput(false);
        setValidatedKey(apiKey.trim());
        message.success('验证成功');
      })
      .catch((err) => {
        const status = err.response?.status;
        if (status === 403) {
          message.error('API Key 无效');
        } else {
          message.error('访问失败');
        }
      })
      .finally(() => { setLoading(false); setFetching(false); });
  };

  if (loading && !data) {
    return <div style={{ textAlign: 'center', padding: '80px 0' }}><Spin size="large" /></div>;
  }

  if (error === 'not_found') {
    return <Empty description="列表不存在" />;
  }

  if (error === 'error') {
    return <Empty description="加载失败，请稍后重试" />;
  }

  if (error === 'private' && showKeyInput) {
    return (
      <div style={{ maxWidth: 500, margin: '60px auto', textAlign: 'center' }}>
        <div style={{ fontSize: 48, color: '#faad14', marginBottom: 16 }}>
          <LockOutlined />
        </div>
        <Title level={4}>私有列表</Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
          此列表为私有，需要 API Key 才能查看
        </Text>
        <Space.Compact style={{ width: '100%' }}>
          <Input.Password
            placeholder="输入 API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onPressEnter={handleKeySubmit}
            prefix={<KeyOutlined />}
            style={{ fontFamily: 'monospace' }}
          />
          <Button type="primary" loading={fetching} onClick={handleKeySubmit}>验证</Button>
        </Space.Compact>
      </div>
    );
  }

  if (!data) {
    return <Empty description="无法加载列表" />;
  }

  const { list } = data;

  return (
    <div>
      {/* List Header */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Title level={4} style={{ margin: 0 }}>
              {list.name}
              <Tag icon={list.is_public ? <UnlockOutlined /> : <LockOutlined />} color={list.is_public ? 'blue' : 'orange'} style={{ marginLeft: 8 }}>
                {list.is_public ? '公开' : '私有'}
              </Tag>
            </Title>
            <Text type="secondary">{list.description || '暂无描述'}</Text>
            <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
              {list.owner && <>创建者：{list.owner} · </>}
              共 {list.item_count} 条 · 创建于 {dayjs(list.created_at).format('YYYY-MM-DD')}
            </div>
          </div>
        </div>
      </Card>

      {/* Items */}
      <Title level={5}>语录</Title>
      {data.items.length === 0 ? (
        <Empty description="此列表暂无语录" />
      ) : (
        <>
          <List
            dataSource={data.items}
            renderItem={(item, index) => (
              <List.Item
                style={{ cursor: 'pointer' }}
                onClick={() => item.quote_uuid && navigate(`/quotes/${item.quote_uuid}`)}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      <span style={{ color: '#999', fontWeight: 600 }}>
                        {(data.page - 1) * data.page_size + index + 1}
                      </span>
                      {item.quote_content || <Text italic type="secondary">语录 #{item.quote_id}</Text>}
                      {item.quote_category && (
                        <Tag color={categoryColors[item.quote_category] || 'default'} style={{ marginLeft: 4 }}>
                          {item.quote_category}
                        </Tag>
                      )}
                    </Space>
                  }
                  description={
                    item.quote_from ? <span>—— {item.quote_from}</span> : undefined
                  }
                />
              </List.Item>
            )}
          />
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <Pagination
              current={data.page}
              total={data.total}
              pageSize={data.page_size}
              onChange={(p) => setPage(p)}
              showTotal={(total) => `共 ${total} 条`}
              responsive
              size={isMobile ? 'small' : undefined}
            />
          </div>
        </>
      )}
    </div>
  );
}
