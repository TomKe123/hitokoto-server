import { useState, useEffect } from 'react';
import {
  Typography, Spin, Card, List, Tag, Button, Space, Grid, message, Popconfirm, Switch, Modal,
  Input, Empty, Divider, Pagination,
} from 'antd';
import {
  ArrowLeftOutlined, DeleteOutlined, LockOutlined, UnlockOutlined, KeyOutlined, CopyOutlined, ShareAltOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import api from '../utils/api';

const { Title, Text, Paragraph } = Typography;
const { useBreakpoint } = Grid;

interface ListData {
  list: {
    id: number;
    uuid: string;
    name: string;
    description: string;
    is_public: boolean;
    item_count: number;
    created_at: string;
    updated_at: string;
  };
  items: ListItemData[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

interface ListItemData {
  id: number;
  quote_id: number;
  quote_uuid?: string;
  quote_content?: string;
  quote_from?: string;
  sort_order: number;
}

export default function ListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [data, setData] = useState<ListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editPublic, setEditPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [apiKeyText, setApiKeyText] = useState('');

  const fetchList = () => {
    if (!id) return;
    setLoading(true);
    api.get(`/lists/${id}`, { params: { page, page_size: pageSize } })
      .then((res) => setData(res.data))
      .catch(() => message.error('加载列表失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchList(); }, [id, page]);

  const handleSave = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const body: any = {};
      if (editName !== data.list.name) body.name = editName;
      if (editDesc !== (data.list.description || '')) body.description = editDesc;
      if (editPublic !== data.list.is_public) body.is_public = editPublic;

      const res = await api.put(`/lists/${data.list.id}`, body);
      setEditing(false);
      message.success('列表已更新');

      if (editPublic === false && data.list.is_public && res.data.api_key) {
        setApiKeyText(res.data.api_key);
        setApiKeyModalOpen(true);
      }
      fetchList();
    } catch (err: any) {
      message.error(err.response?.data?.error || '更新失败');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveItem = async (itemId: number) => {
    if (!data) return;
    try {
      await api.delete(`/lists/${data.list.id}/items/${itemId}`);
      message.success('已移除');
      fetchList();
    } catch (err: any) {
      message.error(err.response?.data?.error || '移除失败');
    }
  };

  const handleRegenerateKey = async () => {
    if (!data) return;
    try {
      const res = await api.post(`/lists/${data.list.id}/regenerate-key`);
      setApiKeyText(res.data.api_key);
      setApiKeyModalOpen(true);
    } catch (err: any) {
      message.error(err.response?.data?.error || '重新生成失败');
    }
  };

  const copyApiKey = () => {
    navigator.clipboard.writeText(apiKeyText);
    message.success('API Key 已复制');
  };

  const shareUrl = data ? `${window.location.origin}/shared/${data.list.uuid}` : '';

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '80px 0' }}><Spin size="large" /></div>;
  }

  if (!data) {
    return <Empty description="列表不存在" />;
  }

  const { list } = data;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/lists')}>
          返回列表
        </Button>
      </div>

      {/* List Info */}
      <Card style={{ marginBottom: 16 }}>
        {editing ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="名称" />
            <Input.TextArea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={2} placeholder="描述" />
            <Space>
              <Text>公开列表：</Text>
              <Switch
                checked={editPublic}
                onChange={setEditPublic}
                checkedChildren={<UnlockOutlined />}
                unCheckedChildren={<LockOutlined />}
              />
            </Space>
            <Space>
              <Button onClick={() => setEditing(false)}>取消</Button>
              <Button type="primary" loading={saving} onClick={handleSave}>保存</Button>
            </Space>
          </Space>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <Title level={4} style={{ margin: 0 }}>
                  {list.name}
                  <Tag icon={list.is_public ? <UnlockOutlined /> : <LockOutlined />} color={list.is_public ? 'blue' : 'orange'} style={{ marginLeft: 8 }}>
                    {list.is_public ? '公开' : '私有'}
                  </Tag>
                </Title>
                <Text type="secondary">{list.description || '暂无描述'}</Text>
                <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
                  共 {list.item_count} 条语录 · 创建于 {dayjs(list.created_at).format('YYYY-MM-DD')}
                </div>
              </div>
              <Space>
                <Button size="small" onClick={() => {
                  setEditing(true);
                  setEditName(list.name);
                  setEditDesc(list.description || '');
                  setEditPublic(list.is_public);
                }}>编辑</Button>
                {!list.is_public && (
                  <Button size="small" icon={<KeyOutlined />} onClick={handleRegenerateKey}>重设 Key</Button>
                )}
              </Space>
            </div>
            <Divider />
            <Space>
              <Button icon={<ShareAltOutlined />} onClick={() => {
                navigator.clipboard.writeText(shareUrl);
                message.success('分享链接已复制');
              }} size="small">
                复制分享链接
              </Button>
              {!list.is_public && (
                <Button icon={<KeyOutlined />} size="small" onClick={() => {
                  setApiKeyText('需要重新生成以查看');
                  handleRegenerateKey();
                }}>
                  获取 API Key
                </Button>
              )}
            </Space>
          </div>
        )}
      </Card>

      {/* Items */}
      <Title level={5}>语录列表</Title>
      {data.items.length === 0 ? (
        <Empty description="此列表暂无语录" />
      ) : (
        <>
          <List
            dataSource={data.items}
            renderItem={(item, index) => (
              <List.Item
                actions={[
                  <Popconfirm
                    key="remove"
                    title="确定移除此语录？"
                    onConfirm={() => handleRemoveItem(item.id)}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />}>移除</Button>
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      <span style={{ color: '#999', fontWeight: 600 }}>
                        {(data.page - 1) * data.page_size + index + 1}
                      </span>
                      {item.quote_content
                        ? <span>{item.quote_content}</span>
                        : <Text italic type="secondary">语录 #{item.quote_id}</Text>
                      }
                    </Space>
                  }
                  description={
                    <span>
                      {item.quote_from && <>—— {item.quote_from} · </>}
                      {item.quote_uuid && (
                        <Text
                          type="secondary"
                          style={{ cursor: 'pointer' }}
                          onClick={() => navigate(`/quotes/${item.quote_uuid}`)}
                        >
                          查看原文
                        </Text>
                      )}
                    </span>
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

      {/* API Key Modal */}
      <Modal
        title="API Key"
        open={apiKeyModalOpen}
        onCancel={() => { setApiKeyModalOpen(false); setApiKeyText(''); }}
        footer={
          <Space>
            <Button onClick={() => { setApiKeyModalOpen(false); setApiKeyText(''); }}>关闭</Button>
            <Button type="primary" icon={<CopyOutlined />} onClick={copyApiKey}>复制 Key</Button>
          </Space>
        }
      >
        <div style={{ marginBottom: 12 }}>
          <Text type="warning" strong>
            ⚠️ 此 API Key 仅在此刻显示一次，请立即保存！
          </Text>
        </div>
        <Input.TextArea
          value={apiKeyText}
          readOnly
          rows={2}
          style={{ fontFamily: 'monospace', fontSize: 13 }}
          onClick={(e) => (e.target as HTMLTextAreaElement).select()}
        />
      </Modal>
    </div>
  );
}
