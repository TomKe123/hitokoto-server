import { useState, useEffect } from 'react';
import { Card, Tag, Pagination, Select, Input, Row, Col, Typography, Empty, Grid, List, Segmented, Button, Popconfirm, message, Space, Modal, Tooltip } from 'antd';
import { AppstoreOutlined, UnorderedListOutlined, CheckOutlined, CloseOutlined, DeleteOutlined, FolderAddOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import useCategories from '../hooks/useCategories';
import AddToListModal from '../components/AddToListModal';
import dayjs from 'dayjs';

const { Paragraph, Title } = Typography;
const { useBreakpoint } = Grid;

interface Quote {
  id: number;
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
  const { categories } = useCategories();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectQuoteId, setRejectQuoteId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [addToListQuoteId, setAddToListQuoteId] = useState<number | null>(null);
  const [addToListQuoteUuid, setAddToListQuoteUuid] = useState<string | null>(null);
  const [addToListModalOpen, setAddToListModalOpen] = useState(false);

  const page = parseInt(searchParams.get('page') || '1');
  const pageSize = parseInt(searchParams.get('page_size') || '20');
  const category = searchParams.get('category') || '';
  const keyword = searchParams.get('keyword') || '';
  const mine = searchParams.get('mine') === 'true';

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string | number | boolean> = { page, page_size: pageSize };
    if (category) params.category = category;
    if (keyword) params.keyword = keyword;
    if (mine) params.mine = true;

    api.get('/quotes', { params })
      .then((res) => setData(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, pageSize, category, keyword, mine]);

  const handleSearch = (value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) params.set('keyword', value);
    else params.delete('keyword');
    params.set('page', '1');
    setSearchParams(params);
  };

  const handleApprove = async (uuid: string) => {
    try {
      await api.put(`/quotes/${uuid}/approve`);
      message.success('已通过');
      setData(null);
      setLoading(true);
      api.get('/quotes', { params: { page, page_size: pageSize, category: category || undefined, keyword: keyword || undefined } })
        .then((res) => setData(res.data))
        .finally(() => setLoading(false));
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    }
  };

  const handleReject = async (uuid: string, reason: string) => {
    setRejecting(true);
    try {
      await api.put(`/quotes/${uuid}/reject`, { reason });
      message.success('已驳回');
      setRejectModalOpen(false);
      setRejectReason('');
      setData(null);
      setLoading(true);
      api.get('/quotes', { params: { page, page_size: pageSize, category: category || undefined, keyword: keyword || undefined } })
        .then((res) => setData(res.data))
        .finally(() => setLoading(false));
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    } finally {
      setRejecting(false);
    }
  };

  const openRejectModal = (uuid: string) => {
    setRejectQuoteId(uuid);
    setRejectReason('');
    setRejectModalOpen(true);
  };

  const handleDelete = async (uuid: string) => {
    try {
      await api.delete(`/quotes/${uuid}`);
      message.success('已删除');
      setData(null);
      setLoading(true);
      api.get('/quotes', { params: { page, page_size: pageSize, category: category || undefined, keyword: keyword || undefined } })
        .then((res) => setData(res.data))
        .finally(() => setLoading(false));
    } catch (err: any) {
      message.error(err.response?.data?.error || '删除失败');
    }
  };

  const isMod = user?.role === 'admin' || ((user?.permissions ?? 0) & 1) !== 0;
  const canDelete = user?.role === 'admin' || ((user?.permissions ?? 0) & 4) !== 0;

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
            options={categories.map((c) => ({ value: c.name, label: c.display_name || c.name }))}
          />
        </Col>
        {user && (
          <Col xs={24} sm={8}>
            <Button
              type={mine ? 'primary' : 'default'}
              size="small"
              onClick={() => {
                const params = new URLSearchParams(searchParams);
                if (mine) params.delete('mine');
                else params.set('mine', 'true');
                params.set('page', '1');
                setSearchParams(params);
              }}
              style={{ marginTop: isMobile ? 0 : 24 }}
            >
              {mine ? '我的语录' : '只看我的'}
            </Button>
          </Col>
        )}
      </Row>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Segmented
          options={[
            { value: 'card', icon: <AppstoreOutlined /> },
            { value: 'list', icon: <UnorderedListOutlined /> },
          ]}
          value={viewMode}
          onChange={(v) => setViewMode(v as 'card' | 'list')}
        />
        {hasQuotes && (
          <span style={{ color: 'var(--surface-muted-text)', fontSize: 13 }}>共 {data!.total} 条</span>
        )}
      </div>

      {hasQuotes ? viewMode === 'card' ? (
        <>
          <Row gutter={[16, 16]}>
            {quotes.map((q) => (
              <Col xs={24} sm={12} key={q.uuid} style={{ contentVisibility: 'auto', containIntrinsicSize: 200 }}>
                <Card
                  hoverable
                  onClick={() => navigate(`/quotes/${q.uuid}`)}
                  style={{ height: '100%' }}
                >
                  <Tooltip title={q.content} trigger="hover">
                    <Paragraph ellipsis={{ rows: 3 }}>{q.content}</Paragraph>
                  </Tooltip>
                  <div style={{ marginTop: 8 }}>
                    <Tag color={categoryColors[q.category] || 'default'}>{q.category}</Tag>
                    {q.from && <span style={{ color: 'var(--surface-muted-text)', fontSize: 12 }}>—— {q.from}</span>}
                    {user && (q.contributor_id === user.id || isMod) && (
                      <Tag color={statusColors[q.status]} style={{ marginLeft: 8 }}>
                        {statusLabels[q.status] || q.status}
                      </Tag>
                    )}
                  </div>
                  {isMod && q.status === 'pending' && (
                    <div style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                      <Space size={4}>
                        <Popconfirm title="确定通过这条语录？" onConfirm={() => handleApprove(q.uuid)}>
                          <Button size="small" type="primary" icon={<CheckOutlined />}>通过</Button>
                        </Popconfirm>
                        <Button size="small" danger icon={<CloseOutlined />} onClick={() => openRejectModal(q.uuid)}>驳回</Button>
                        {user && (
                          <Button size="small" icon={<FolderAddOutlined />} onClick={() => {
                            setAddToListQuoteId(q.id);
                            setAddToListQuoteUuid(q.uuid);
                            setAddToListModalOpen(true);
                          }}>列表</Button>
                        )}
                      </Space>
                    </div>
                  )}
                  {isMod && q.status === 'approved' && (
                    <div style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                      <Space size={4}>
                        <Button size="small" danger icon={<CloseOutlined />} onClick={() => openRejectModal(q.uuid)}>驳回</Button>
                        {user && (
                          <Button size="small" icon={<FolderAddOutlined />} onClick={() => {
                            setAddToListQuoteId(q.id);
                            setAddToListQuoteUuid(q.uuid);
                            setAddToListModalOpen(true);
                          }}>列表</Button>
                        )}
                      </Space>
                    </div>
                  )}
                  {user && !isMod && (
                    <div style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                      <Button size="small" icon={<FolderAddOutlined />} onClick={() => {
                        setAddToListQuoteId(q.id);
                        setAddToListQuoteUuid(q.uuid);
                        setAddToListModalOpen(true);
                      }}>添加到列表</Button>
                    </div>
                  )}
                  {canDelete && (
                    <div style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                      <Popconfirm title="确定删除这条语录？此操作不可恢复。" onConfirm={() => handleDelete(q.uuid)}>
                        <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                      </Popconfirm>
                    </div>
                  )}
                </Card>
              </Col>
            ))}
          </Row>
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <Pagination
              current={data!.page}
              total={data!.total}
              pageSize={pageSize}
              showSizeChanger
              pageSizeOptions={['10', '20', '50', '100']}
              onChange={(p, size) => {
                const params = new URLSearchParams(searchParams);
                params.set('page', size !== pageSize ? '1' : String(p));
                params.set('page_size', String(size));
                setSearchParams(params);
              }}
              showTotal={(total) => `共 ${total} 条`}
              responsive
              size={isMobile ? 'small' : undefined}
            />
          </div>
        </>
      ) : (
        <>
          <List
            dataSource={quotes}
            renderItem={(q) => (
              <List.Item
                style={{ cursor: 'pointer', padding: '12px 0', contentVisibility: 'auto', containIntrinsicSize: 80 }}
                onClick={() => navigate(`/quotes/${q.uuid}`)}
                actions={[
                  ...(user && !isMod ? [
                    <Button key="list" size="small" icon={<FolderAddOutlined />} onClick={(e) => {
                      e.stopPropagation();
                      setAddToListQuoteId(q.id);
                      setAddToListQuoteUuid(q.uuid);
                      setAddToListModalOpen(true);
                    }}>列表</Button>,
                  ] : []),
                  ...(isMod ? [
                    ...(q.status === 'pending' ? [
                      <Popconfirm key="approve" title="通过？" onConfirm={() => handleApprove(q.uuid)}>
                        <Button size="small" type="primary" icon={<CheckOutlined />} onClick={(e) => e.stopPropagation()}>通过</Button>
                      </Popconfirm>,
                      <Button key="reject" size="small" danger icon={<CloseOutlined />} onClick={(e) => { e.stopPropagation(); openRejectModal(q.uuid); }}>驳回</Button>,
                      <Button key="list" size="small" icon={<FolderAddOutlined />} onClick={(e) => {
                        e.stopPropagation();
                        setAddToListQuoteId(q.id);
                        setAddToListQuoteUuid(q.uuid);
                        setAddToListModalOpen(true);
                      }}>列表</Button>,
                    ] : []),
                    ...(q.status === 'approved' ? [
                      <Button key="reject" size="small" danger icon={<CloseOutlined />} onClick={(e) => { e.stopPropagation(); openRejectModal(q.uuid); }}>驳回</Button>,
                      <Button key="list" size="small" icon={<FolderAddOutlined />} onClick={(e) => {
                        e.stopPropagation();
                        setAddToListQuoteId(q.id);
                        setAddToListQuoteUuid(q.uuid);
                        setAddToListModalOpen(true);
                      }}>列表</Button>,
                    ] : []),
                  ] : []),
                  ...(canDelete ? [
                    <Popconfirm key="delete" title="确定删除这条语录？此操作不可恢复。" onConfirm={() => handleDelete(q.uuid)}>
                      <Button size="small" danger icon={<DeleteOutlined />} onClick={(e) => { e.stopPropagation(); }}>删除</Button>
                    </Popconfirm>,
                  ] : []),
                ]}
              >
                <List.Item.Meta
                  title={
                    <span>
                      <Tooltip title={q.content} trigger="hover">
                        <span>{q.content.length > 80 ? q.content.slice(0, 80) + '...' : q.content}</span>
                      </Tooltip>
                      <Tag color={categoryColors[q.category] || 'default'} style={{ marginLeft: 8 }}>{q.category}</Tag>
                      {user && (q.contributor_id === user.id || isMod) && (
                        <Tag color={statusColors[q.status]} style={{ marginLeft: 4 }}>
                          {statusLabels[q.status] || q.status}
                        </Tag>
                      )}
                    </span>
                  }
                  description={
                    <span>
                      {q.from && `—— ${q.from}`}
                      {q.from && ' · '}
                      {dayjs(q.created_at).format('YYYY-MM-DD')}
                    </span>
                  }
                />
              </List.Item>
            )}
          />
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <Pagination
              current={data!.page}
              total={data!.total}
              pageSize={pageSize}
              showSizeChanger
              pageSizeOptions={['10', '20', '50', '100']}
              onChange={(p, size) => {
                const params = new URLSearchParams(searchParams);
                params.set('page', size !== pageSize ? '1' : String(p));
                params.set('page_size', String(size));
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

      <Modal
        title="驳回语录"
        open={rejectModalOpen}
        onOk={() => rejectQuoteId && handleReject(rejectQuoteId, rejectReason)}
        onCancel={() => { setRejectModalOpen(false); setRejectReason(''); }}
        confirmLoading={rejecting}
        okText="驳回"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <div style={{ marginBottom: 8 }}>
          <span style={{ color: 'var(--surface-muted-text)', fontSize: 13 }}>请填写驳回理由（可选），用户将收到通知</span>
        </div>
        <Input.TextArea
          rows={3}
          placeholder="请输入驳回理由..."
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
        />
      </Modal>

      {addToListQuoteId && addToListQuoteUuid && (
        <AddToListModal
          open={addToListModalOpen}
          quoteId={addToListQuoteId}
          quoteUuid={addToListQuoteUuid}
          onClose={() => { setAddToListModalOpen(false); setAddToListQuoteId(null); setAddToListQuoteUuid(null); }}
        />
      )}
    </div>
  );
}
