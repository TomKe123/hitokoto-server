import { useState, useEffect, useCallback } from 'react';
import {
  Card, Typography, Button, Table, Tag, Select, Input, message, Upload,
  Popconfirm, Space, Grid, Modal, Statistic, Row, Col, Tooltip, Form,
} from 'antd';
import {
  UploadOutlined, CheckOutlined, StopOutlined, DeleteOutlined,
  ReloadOutlined, SearchOutlined, ClearOutlined, ExclamationCircleOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import dayjs from 'dayjs';

const { Title } = Typography;
const { useBreakpoint } = Grid;

interface QuoteItem {
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

interface CategoryItem {
  name: string;
  display_name?: string;
  count: number;
}

const statusColors: Record<string, string> = {
  pending: 'orange',
  approved: 'green',
  rejected: 'red',
};

const statusLabels: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
};

const categoryColors: Record<string, string> = {
  anime: 'volcano',
  comic: 'orange',
  novel: 'blue',
  game: 'green',
  movie: 'purple',
  music: 'pink',
  other: 'default',
};

export default function QuoteManagementPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const perms = user?.permissions ?? 0;
  const canReview = isAdmin || (perms & 1) !== 0;
  const canDelete = isAdmin || (perms & 4) !== 0;
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [keyword, setKeyword] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [categories, setCategories] = useState<CategoryItem[]>([]);

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectTarget, setRejectTarget] = useState<{ uuid: string } | { batch: true } | null>(null);
  const [rejecting, setRejecting] = useState(false);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  // Edit modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<QuoteItem | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm] = Form.useForm();

  // Stats
  const [stats, setStats] = useState({ all: 0, pending: 0, approved: 0, rejected: 0 });
  const [statsLoading, setStatsLoading] = useState(false);

  const fetchStats = useCallback(() => {
    setStatsLoading(true);
    api.get('/admin/quotes/stats')
      .then((res) => setStats(res.data))
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, []);

  const fetchCategories = useCallback(() => {
    api.get('/categories')
      .then((res) => setCategories(res.data.categories || []))
      .catch(() => {});
  }, []);

  const fetchQuotes = useCallback(() => {
    setLoading(true);
    const params: Record<string, string | number | undefined> = {
      page,
      page_size: pageSize,
      status: statusFilter || undefined,
      category: categoryFilter || undefined,
      keyword: keyword || undefined,
      mine: mineOnly ? 'true' : undefined,
    };
    api.get('/quotes', { params })
      .then((res) => {
        setQuotes(res.data.quotes || []);
        setTotal(res.data.total || 0);
      })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  }, [page, pageSize, statusFilter, categoryFilter, keyword, mineOnly]);

  useEffect(() => { fetchStats(); fetchCategories(); }, [fetchStats, fetchCategories]);
  useEffect(() => { fetchQuotes(); }, [fetchQuotes]);

  const resetFilters = () => {
    setStatusFilter('');
    setCategoryFilter('');
    setKeyword('');
    setMineOnly(false);
    setPage(1);
    setSelectedRowKeys([]);
  };

  // Single actions
  const handleApprove = async (uuid: string) => {
    try {
      await api.put(`/quotes/${uuid}/approve`);
      message.success('已通过');
      fetchQuotes();
      fetchStats();
    } catch {
      message.error('操作失败');
    }
  };

  const openReject = (uuid: string) => {
    setRejectTarget({ uuid });
    setRejectReason('');
    setRejectModalOpen(true);
  };

  const confirmReject = async () => {
    if (!rejectTarget || 'batch' in rejectTarget) return;
    setRejecting(true);
    try {
      await api.put(`/quotes/${rejectTarget.uuid}/reject`, { reason: rejectReason });
      message.success('已驳回');
      setRejectModalOpen(false);
      setRejectReason('');
      fetchQuotes();
      fetchStats();
    } catch {
      message.error('操作失败');
    } finally {
      setRejecting(false);
    }
  };

  const handleDelete = async (uuid: string) => {
    try {
      await api.delete(`/quotes/${uuid}`);
      message.success('已删除');
      fetchQuotes();
      fetchStats();
    } catch {
      message.error('删除失败');
    }
  };

  // Batch actions
  const openBatchReject = () => {
    setRejectTarget({ batch: true });
    setRejectReason('');
    setRejectModalOpen(true);
  };

  const confirmBatchReject = async () => {
    if (!rejectTarget || !('batch' in rejectTarget)) return;
    setBatchLoading(true);
    try {
      const res = await api.post('/admin/quotes/batch', {
        action: 'reject',
        uuids: selectedRowKeys,
        reason: rejectReason,
      });
      message.success(`批量驳回完成：${res.data.affected} 条`);
      setSelectedRowKeys([]);
      setRejectModalOpen(false);
      setRejectReason('');
      fetchQuotes();
      fetchStats();
    } catch (err: any) {
      message.error(err.response?.data?.error || '批量操作失败');
    } finally {
      setBatchLoading(false);
    }
  };

  const handleBatch = async (action: string) => {
    if (selectedRowKeys.length === 0) return;
    if (action === 'reject') {
      openBatchReject();
      return;
    }
    const setLoading = action === 'delete' ? setDeleteLoading : setBatchLoading;
    setLoading(true);
    try {
      const res = await api.post('/admin/quotes/batch', { action, uuids: selectedRowKeys });
      const label = action === 'approve' ? '通过' : '删除';
      message.success(`批量${label}完成：${res.data.affected} 条`);
      setSelectedRowKeys([]);
      fetchQuotes();
      fetchStats();
    } catch (err: any) {
      message.error(err.response?.data?.error || '批量操作失败');
    } finally {
      setLoading(false);
    }
  };

  const handleApproveAllRejected = async () => {
    setBatchLoading(true);
    try {
      const res = await api.post('/admin/quotes/approve-all-rejected');
      message.success(`全部通过完成：${res.data.affected} 条`);
      fetchQuotes();
      fetchStats();
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    } finally {
      setBatchLoading(false);
    }
  };

  // Edit
  const openEdit = (quote: QuoteItem) => {
    setEditTarget(quote);
    editForm.setFieldsValue({
      content: quote.content,
      from: quote.from,
      category: quote.category,
      source: quote.source,
    });
    setEditModalOpen(true);
  };

  const handleEditSave = async () => {
    if (!editTarget) return;
    try {
      const values = await editForm.validateFields();
      setEditSaving(true);
      await api.put(`/quotes/${editTarget.uuid}`, values);
      message.success('已更新');
      setEditModalOpen(false);
      fetchQuotes();
      fetchStats();
    } catch (err: any) {
      if (err.errorFields || err.response?.data?.error) return;
      message.error('更新失败');
    } finally {
      setEditSaving(false);
    }
  };

  // Import
  const handleFile = async (file: File) => {
    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      message.error('JSON 格式无效');
      return false;
    }
    const entries = Array.isArray(data) ? data : data.data || data.quotes || [];
    if (!Array.isArray(entries)) {
      message.error('未找到语录数组');
      return false;
    }

    setImporting(true);
    try {
      const res = await api.post('/admin/import', entries);
      const r = res.data;
      message.success(`导入完成：成功 ${r.imported} 条，跳过 ${r.skipped} 条`);
      setImportModalOpen(false);
      fetchQuotes();
      fetchStats();
    } catch {
      message.error('导入失败');
    } finally {
      setImporting(false);
    }
    return false;
  };

  const columns = [
    {
      title: '内容', dataIndex: 'content', key: 'content', width: 280,
      ellipsis: true,
      render: (c: string) => (
        <Tooltip title={c.length > 80 ? c : undefined}>
          <span>{c.length > 50 ? c.slice(0, 50) + '...' : c}</span>
        </Tooltip>
      ),
    },
    {
      title: '出处', dataIndex: 'from', key: 'from', width: 120,
      ellipsis: true,
      render: (f: string) => f || <span style={{ color: '#ccc' }}>-</span>,
    },
    {
      title: '分类', dataIndex: 'category', key: 'category', width: 80,
      render: (c: string) => <Tag color={categoryColors[c] || 'default'}>{c}</Tag>,
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (s: string) => <Tag color={statusColors[s]}>{statusLabels[s] || s}</Tag>,
    },
    {
      title: '贡献者', dataIndex: 'contributor_id', key: 'contributor_id', width: 80,
    },
    {
      title: '时间', dataIndex: 'created_at', key: 'created_at', width: 140,
      render: (t: string) => dayjs(t).format('MM-DD HH:mm'),
      sorter: (a: QuoteItem, b: QuoteItem) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    },
    {
      title: '操作', key: 'action', width: 200, fixed: 'right' as const,
      render: (_: unknown, r: QuoteItem) => (
        <Space size="small">
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>
            编辑
          </Button>
          {r.status !== 'approved' && (
            <Button size="small" type="primary" onClick={() => handleApprove(r.uuid)}>
              通过
            </Button>
          )}
          {r.status !== 'rejected' && (
            <Button size="small" danger onClick={() => openReject(r.uuid)}>
              驳回
            </Button>
          )}
          {canDelete && (
            <Popconfirm
              title="确定删除这条语录？此操作不可恢复。"
              onConfirm={() => handleDelete(r.uuid)}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const hasFilters = statusFilter || categoryFilter || keyword || mineOnly;

  return (
    <div>
      <Title level={isMobile ? 4 : 3} style={{ marginBottom: 16 }}>语录管理</Title>

      {/* Stats bar */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {[
          { label: '全部', value: stats.all, color: undefined },
          { label: '待审核', value: stats.pending, color: '#faad14' },
          { label: '已通过', value: stats.approved, color: '#52c41a' },
          { label: '已驳回', value: stats.rejected, color: '#ff4d4f' },
        ].map((s) => (
          <Col xs={12} sm={6} key={s.label}>
            <Card size="small" loading={statsLoading}>
              <Statistic
                title={s.label}
                value={s.value}
                valueStyle={s.color ? { color: s.color, fontSize: isMobile ? 20 : 24 } : { fontSize: isMobile ? 20 : 24 }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      {/* Filter + action bar */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{
          display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center',
          marginBottom: selectedRowKeys.length > 0 && (canReview || canDelete) ? 12 : 0,
        }}>
          <Select
            placeholder="状态筛选"
            allowClear
            value={statusFilter || undefined}
            onChange={(v) => { setStatusFilter(v || ''); setPage(1); setSelectedRowKeys([]); }}
            style={{ width: 110 }}
          >
            <Select.Option value="pending">待审核</Select.Option>
            <Select.Option value="approved">已通过</Select.Option>
            <Select.Option value="rejected">已驳回</Select.Option>
          </Select>

          <Select
            placeholder="分类筛选"
            allowClear
            value={categoryFilter || undefined}
            onChange={(v) => { setCategoryFilter(v || ''); setPage(1); setSelectedRowKeys([]); }}
            style={{ width: 120 }}
          >
            {categories.map((c) => (
              <Select.Option key={c.name} value={c.name}>{c.display_name || c.name} ({c.count})</Select.Option>
            ))}
          </Select>

          <Input.Search
            placeholder="搜索内容/出处"
            allowClear
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onSearch={(v) => { setKeyword(v); setPage(1); }}
            style={{ width: 200 }}
            prefix={<SearchOutlined />}
          />

          {user && (
            <Button
              type={mineOnly ? 'primary' : 'default'}
              size="small"
              onClick={() => { setMineOnly(!mineOnly); setPage(1); }}
            >
              仅看我的
            </Button>
          )}

          {hasFilters && (
            <Button size="small" icon={<ClearOutlined />} onClick={resetFilters}>清除筛选</Button>
          )}

          <div style={{ flex: 1 }} />

          {isAdmin && (
            <Space>
              <Button
                size="small"
                icon={<UploadOutlined />}
                onClick={() => setImportModalOpen(true)}
              >
                JSON 导入
              </Button>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => { fetchQuotes(); fetchStats(); }}
              >
                刷新
              </Button>
            </Space>
          )}
        </div>

        {/* Batch action bar */}
        {(canReview || canDelete) && selectedRowKeys.length > 0 && (
          <div style={{
            padding: '8px 12px', background: '#fff7e6', borderRadius: 6,
            display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
            border: '1px solid #ffd591',
          }}>
            <span style={{ fontWeight: 500 }}>已选 {selectedRowKeys.length} 条：</span>
            <Button
              type="primary"
              size="small"
              icon={<CheckOutlined />}
              loading={batchLoading}
              onClick={() => handleBatch('approve')}
            >
              批量通过
            </Button>
            <Button
              danger
              size="small"
              icon={<StopOutlined />}
              loading={batchLoading}
              onClick={() => handleBatch('reject')}
            >
              批量驳回
            </Button>
            {canDelete && (
              <Popconfirm
                title={`确定删除选中的 ${selectedRowKeys.length} 条语录？此操作不可恢复。`}
                onConfirm={() => handleBatch('delete')}
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Button danger size="small" icon={<DeleteOutlined />} loading={deleteLoading}>
                  批量删除
                </Button>
              </Popconfirm>
            )}
            <Button size="small" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
          </div>
        )}

        {/* Approve all rejected */}
        {canReview && statusFilter === 'rejected' && stats.rejected > 0 && (
          <div style={{ marginTop: selectedRowKeys.length > 0 ? 8 : 0 }}>
            <Popconfirm
              title={
                <div>
                  <p style={{ marginBottom: 8 }}>
                    <ExclamationCircleOutlined style={{ color: '#faad14', fontSize: 16, marginRight: 8 }} />
                    确定将所有 <b>{stats.rejected}</b> 条已驳回语录全部改为通过？
                  </p>
                  <p style={{ color: '#999', margin: 0 }}>此操作不可恢复。</p>
                </div>
              }
              onConfirm={handleApproveAllRejected}
              okText="全部通过"
              cancelText="取消"
            >
              <Button type="primary" size="small" danger loading={batchLoading}>
                全部通过 ({stats.rejected} 条)
              </Button>
            </Popconfirm>
          </div>
        )}
      </Card>

      {/* Table */}
      <Card>
        <Table
          dataSource={quotes}
          columns={columns}
          rowKey="uuid"
          loading={loading}
          rowSelection={(canReview || canDelete) ? {
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys),
          } : undefined}
          pagination={{
            current: page,
            total,
            pageSize,
            showSizeChanger: true,
            pageSizeOptions: ['1000', '100', '50', '20'],
            onChange: (p, ps) => { setPage(p); setPageSize(ps); setSelectedRowKeys([]); },
            showTotal: (t) => `共 ${t} 条`,
            responsive: true,
            size: isMobile ? 'small' : undefined,
          }}
          scroll={{ x: 1000, y: 600 }}
          virtual
          size={isMobile ? 'small' : 'middle'}
        />
      </Card>

      {/* Reject reason modal */}
      <Modal
        title="驳回语录"
        open={rejectModalOpen}
        onOk={rejectTarget && 'batch' in rejectTarget ? confirmBatchReject : confirmReject}
        onCancel={() => { setRejectModalOpen(false); setRejectReason(''); }}
        confirmLoading={rejecting || batchLoading}
        okText="驳回"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <div style={{ marginBottom: 8 }}>
          <span style={{ color: '#999', fontSize: 13 }}>
            {rejectTarget && 'batch' in rejectTarget
              ? `批量驳回 ${selectedRowKeys.length} 条语录，请填写驳回理由（可选）`
              : '请填写驳回理由（可选），用户将收到通知'}
          </span>
        </div>
        <Input.TextArea
          rows={3}
          placeholder="请输入驳回理由..."
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
        />
      </Modal>

      {/* Edit modal */}
      <Modal
        title="编辑语录"
        open={editModalOpen}
        onOk={handleEditSave}
        onCancel={() => { setEditModalOpen(false); editForm.resetFields(); }}
        confirmLoading={editSaving}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="content"
            label="内容"
            rules={[{ required: true, message: '请输入语录内容' }]}
          >
            <Input.TextArea rows={3} showCount maxLength={500} />
          </Form.Item>
          <Form.Item
            name="from"
            label="出处"
          >
            <Input placeholder="作品/作者" />
          </Form.Item>
          <Form.Item
            name="category"
            label="分类"
            rules={[{ required: true, message: '请选择分类' }]}
          >
            <Select placeholder="选择分类">
              {categories.map((c) => (
                <Select.Option key={c.name} value={c.name}>{c.display_name || c.name}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            name="source"
            label="来源链接"
          >
            <Input placeholder="https://..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* Import modal */}
      <Modal
        title="JSON 导入语录"
        open={importModalOpen}
        onCancel={() => setImportModalOpen(false)}
        footer={null}
      >
        <p style={{ color: '#666', marginBottom: 16 }}>
          支持标准 hitokoto JSON 格式。可上传 .json 文件，每行一个语录对象。
        </p>
        <Upload
          accept=".json"
          showUploadList={false}
          beforeUpload={handleFile}
          disabled={importing}
        >
          <Button icon={<UploadOutlined />} loading={importing} type="primary" block>
            选择 JSON 文件导入
          </Button>
        </Upload>
      </Modal>
    </div>
  );
}
