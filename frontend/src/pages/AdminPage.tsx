import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { AxiosError } from 'axios';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Typography, Button, Table, Tag, InputNumber, Input, message, Upload, Tabs, Select, Popconfirm, Space, Grid, Checkbox, Switch, Modal, Form, Tooltip } from 'antd';
import { PlusOutlined, UploadOutlined, DeleteOutlined, EditOutlined, ExclamationCircleOutlined, ToolOutlined, UserAddOutlined, KeyOutlined, EyeInvisibleOutlined, EyeOutlined, RobotOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import { useSiteConfig } from '../contexts/SiteConfigContext';
import api from '../utils/api';
import dayjs from 'dayjs';
import QuoteManagementPage from './QuoteManagementPage';

const { Title } = Typography;
const { useBreakpoint } = Grid;

/** Extract error message from an axios error, or fall back to a default. */
function apiError(err: unknown, fallback: string): string {
  const e = err as AxiosError<{ error?: string }>;
  return e?.response?.data?.error || fallback;
}

/** True when the rejected value is an antd Form validation failure (skip toast). */
function isFormValidationError(err: unknown): boolean {
  return !!err && typeof err === 'object' && 'errorFields' in err;
}

interface InviteCode {
  id: number;
  code: string;
  max_uses: number;
  use_count: number;
  created_by: number;
  created_at: string;
  expires_at?: string;
}

interface UserItem {
  id: number;
  username: string;
  email: string;
  role: string;
  permissions?: number;
  status: string;
  created_at: string;
}

interface QuoteItem {
  uuid: string;
  content: string;
  from: string;
  category: string;
  categories?: string[];
  source: string;
  contributor_id: number;
  status: string;
  created_at: string;
}

export default function AdminPage() {
  const { user } = useAuth();
  const { section } = useParams<{ section?: string }>();
  const isAdmin = user?.role === 'admin';
  const hasGlobalAdmin = (user?.permissions ?? 0) & 32;
  const perms = user?.permissions ?? 0;
  const hasCategoryPerm = isAdmin || (perms & 2) !== 0;
  const canReview = isAdmin || (perms & 1) !== 0;
  const canManageLists = isAdmin || (perms & 16) !== 0;
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const navigate = useNavigate();

  // Determine available folders for permission-based redirect
  const availableSections: { key: string; label: string }[] = useMemo(() => [
    ...(canReview ? [{ key: 'quotes', label: '语录管理' }] : []),
    ...(isAdmin ? [{ key: 'users', label: '用户管理' }] : []),
    ...(hasCategoryPerm ? [{ key: 'categories', label: '分类管理' }] : []),
    ...(canManageLists ? [{ key: 'lists', label: '列表管理' }] : []),
    ...(isAdmin ? [{ key: 'settings', label: '系统设置' }] : []),
  ], [canReview, isAdmin, hasCategoryPerm, canManageLists]);

  // Redirect to first available section if none or invalid
  const validSection = section && availableSections.some((s) => s.key === section);
  useEffect(() => {
    if (!validSection && availableSections.length > 0) {
      navigate(`/admin/${availableSections[0].key}`, { replace: true });
    }
  }, [validSection, availableSections, navigate]);

  if (!validSection || availableSections.length === 0) {
    return (
      <div>
        <Title level={isMobile ? 4 : 3}>管理后台</Title>
        {availableSections.length === 0 && <Card><p>暂无可用管理功能。</p></Card>}
      </div>
    );
  }

  return (
    <div>
      <Title level={isMobile ? 4 : 3}>
        {availableSections.find((s) => s.key === section)?.label || '管理后台'}
      </Title>
      {/* Section content */}
      {section === 'quotes' && <QuotesSection isAdmin={isAdmin} canReview={canReview} isMobile={isMobile} />}
      {section === 'users' && <UsersSection isAdmin={isAdmin} hasGlobalAdmin={!!hasGlobalAdmin} isMobile={isMobile} />}
      {section === 'categories' && <CategoriesSection isMobile={isMobile} />}
      {section === 'lists' && <ListsSection isMobile={isMobile} />}
      {section === 'settings' && <SettingsSection isAdmin={isAdmin} />}
    </div>
  );
}

// ─── Section wrapper components ───

function QuotesSection({ isAdmin, canReview, isMobile }: { isAdmin: boolean; canReview: boolean; isMobile: boolean }) {
  const tabs = [
    { key: 'all', label: '全部语录', children: <QuoteManagementPage /> },
    { key: 'pending', label: '待审核', children: <QuoteReviewPanel canReview={canReview} isAdmin={isAdmin} isMobile={isMobile} /> },
    { key: 'rejected', label: '已驳回', children: <RejectedQuotesPanel canReview={canReview} isAdmin={isAdmin} isMobile={isMobile} /> },
  ];
  return <Tabs items={tabs} />;
}

function UsersSection({ isAdmin, hasGlobalAdmin, isMobile }: { isAdmin: boolean; hasGlobalAdmin: boolean; isMobile: boolean }) {
  const tabs = [
    { key: 'users', label: '用户列表', children: <UserManagementPanel isAdmin={isAdmin} hasGlobalAdmin={hasGlobalAdmin} isMobile={isMobile} /> },
    ...(isAdmin ? [{ key: 'codes', label: '邀请码管理', children: <InviteCodePanel isMobile={isMobile} /> }] : []),
  ];
  return <Tabs items={tabs} />;
}

function CategoriesSection({ isMobile }: { isMobile: boolean }) {
  return <CategoryManagementPanel isMobile={isMobile} />;
}

function ListsSection({ isMobile }: { isMobile: boolean }) {
  return <ListManagementPanel isMobile={isMobile} />;
}

function SettingsSection({ isAdmin }: { isAdmin: boolean }) {
  const tabs = [
    { key: 'site', label: '站点设置', children: <SiteSettingsPanel /> },
    ...(isAdmin ? [{ key: 'ai', label: 'AI 分类', children: <AISettingsPanel /> }] : []),
    ...(isAdmin ? [{ key: 'import', label: 'JSON 导入', children: <ImportPanel /> }] : []),
  ];
  return <Tabs items={tabs} />;
}

function InviteCodePanel({ isMobile }: { isMobile: boolean }) {
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editingCode, setEditingCode] = useState<InviteCode | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();

  const fetchCodes = useCallback(() => {
    setLoading(true);
    api.get('/admin/invite-codes')
      .then((res) => setCodes(res.data.codes || []))
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time mount fetch
  useEffect(() => { fetchCodes(); }, [fetchCodes]);

  const openEdit = (record: InviteCode) => {
    setEditingCode(record);
    editForm.setFieldsValue({
      max_uses: record.max_uses,
      expire_days: 0,
      reset_use: false,
    });
  };

  const handleUpdate = async () => {
    if (!editingCode) return;
    try {
      const values = await editForm.validateFields();
      setSaving(true);
      await api.put(`/admin/invite-codes/${editingCode.id}`, {
        max_uses: values.max_uses,
        expire_days: values.expire_days || 0,
        reset_use: values.reset_use || false,
      });
      message.success('已更新');
      setEditingCode(null);
      editForm.resetFields();
      fetchCodes();
    } catch (err: unknown) {
      if (isFormValidationError(err)) return;
      message.error(apiError(err, '更新失败'));
    } finally {
      setSaving(false);
    }
  };

  const generate = async () => {
    try {
      const values = await form.validateFields();
      setGenerating(true);
      const payload: Record<string, unknown> = {
        count: values.custom_code ? 1 : (values.count || 5),
        max_uses: values.max_uses || 1,
      };
      if (values.expire_days > 0) payload.expire_days = values.expire_days;
      if (values.custom_code?.trim()) payload.custom_code = values.custom_code.trim();
      const res = await api.post('/admin/invite-codes', payload);
      message.success(`生成了 ${res.data.codes.length} 个邀请码`);
      setModalOpen(false);
      form.resetFields();
      fetchCodes();
    } catch (err: unknown) {
      if (isFormValidationError(err)) return;
      message.error(apiError(err, '生成失败'));
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/admin/invite-codes/${id}`);
      message.success('已删除');
      fetchCodes();
    } catch (err: unknown) {
      message.error(apiError(err, '删除失败'));
    }
  };

  const columns = [
    { title: '邀请码', dataIndex: 'code', key: 'code',
      render: (code: string) => <Tag style={{ fontFamily: 'monospace', fontSize: 14 }}>{code}</Tag> },
    { title: '已用/最大', key: 'uses',
      render: (_: unknown, r: InviteCode) => (
        <span style={{ color: r.use_count >= r.max_uses ? '#ff4d4f' : undefined }}>
          {r.use_count}/{r.max_uses}
        </span>
      ) },
    { title: '过期时间', dataIndex: 'expires_at', key: 'expires_at',
      render: (t?: string) => t
        ? <span style={{ color: new Date(t) < new Date() ? '#ff4d4f' : undefined }}>{dayjs(t).format('MM-DD HH:mm')}</span>
        : <span style={{ color: 'var(--surface-muted-text)' }}>永久</span> },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at',
      render: (t: string) => dayjs(t).format('MM-DD HH:mm') },
    { title: '操作', key: 'action', width: 120,
      render: (_: unknown, r: InviteCode) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          <Popconfirm title="确定删除此邀请码？" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ) },
  ];

  return (
    <Card>
      <div style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          生成邀请码
        </Button>
      </div>
      <Table
        dataSource={codes}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 20, responsive: true, size: isMobile ? 'small' : undefined }}
      />
      <Modal
        title="生成邀请码"
        open={modalOpen}
        onCancel={() => { setModalOpen(false); form.resetFields(); }}
        onOk={generate}
        confirmLoading={generating}
        okText="生成"
        cancelText="取消"
        destroyOnClose>
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="custom_code" label="自定义邀请码">
            <Input placeholder="留空则随机生成" maxLength={100} />
          </Form.Item>
          <Form.Item name="count" label="生成数量" initialValue={5}
            rules={[{ type: 'number', min: 1, max: 100 }]}>
            <InputNumber min={1} max={100} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="max_uses" label="最大使用次数" initialValue={1}
            rules={[{ type: 'number', min: 1, max: 999 }]}>
            <InputNumber min={1} max={999} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="expire_days" label="有效期（天）" initialValue={0}
            extra="0 表示永久有效">
            <InputNumber min={0} max={3650} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={`编辑邀请码: ${editingCode?.code || ''}`}
        open={!!editingCode}
        onCancel={() => { setEditingCode(null); editForm.resetFields(); }}
        onOk={handleUpdate}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        destroyOnClose>
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="max_uses" label="最大使用次数"
            rules={[{ type: 'number', min: 1, max: 999 }]}>
            <InputNumber min={1} max={999} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="expire_days" label="有效期（天）" extra="0 保持不变，-1 设为永久">
            <InputNumber min={-1} max={3650} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="reset_use" valuePropName="checked">
            <Select
              options={[
                { value: false, label: '保留已用次数' },
                { value: true, label: '重置已用次数为 0' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

function ImportPanel() {
  const [importing, setImporting] = useState(false);

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
      message.error('未找到记录数组');
      return false;
    }

    setImporting(true);
    try {
      const res = await api.post('/admin/import', entries);
      const r = res.data;
      message.success(`导入完成：成功 ${r.imported} 条，跳过 ${r.skipped} 条`);
    } catch {
      message.error('导入失败');
    } finally {
      setImporting(false);
    }
    return false;
  };

  return (
    <Card>
      <p>支持标准 hitokoto JSON 格式。可上传 .json 文件。</p>
      <Upload
        accept=".json"
        showUploadList={false}
        beforeUpload={handleFile}
        disabled={importing}
      >
        <Button icon={<UploadOutlined />} loading={importing} type="primary">
          选择 JSON 文件导入
        </Button>
      </Upload>
    </Card>
  );
}

function QuoteReviewPanel({ canReview, isAdmin, isMobile }: { canReview: boolean; isAdmin: boolean; isMobile: boolean }) {
  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectTarget, setRejectTarget] = useState<{ uuid: string } | { batch: true } | null>(null);
  const [rejecting, setRejecting] = useState(false);

  const fetchQuotes = useCallback(() => {
    setLoading(true);
    api.get('/quotes', { params: { page, page_size: 20, status: statusFilter } })
      .then((res) => {
        setQuotes(res.data.quotes || []);
        setTotal(res.data.total || 0);
      })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  }, [page, statusFilter]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on filter change
  useEffect(() => { fetchQuotes(); }, [fetchQuotes]);

  const handleApprove = async (uuid: string) => {
    try {
      await api.put(`/quotes/${uuid}/approve`);
      message.success('已通过');
      fetchQuotes();
    } catch (err: unknown) {
      message.error(apiError(err, '操作失败'));
    }
  };

  const handleReject = (uuid: string) => {
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
    } catch (err: unknown) {
      message.error(apiError(err, '操作失败'));
    } finally {
      setRejecting(false);
    }
  };

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
      message.success('批量驳回完成：' + res.data.affected + ' 条');
      setSelectedRowKeys([]);
      setRejectModalOpen(false);
      setRejectReason('');
      fetchQuotes();
    } catch (err: unknown) {
      message.error(apiError(err, '批量操作失败'));
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
    setBatchLoading(true);
    try {
      const res = await api.post('/admin/quotes/batch', {
        action,
        uuids: selectedRowKeys,
      });
      message.success('批量' + (action === 'approve' ? '通过' : '删除') + '完成：' + res.data.affected + ' 条');
      setSelectedRowKeys([]);
      fetchQuotes();
    } catch (err: unknown) {
      message.error(apiError(err, '批量操作失败'));
    } finally {
      setBatchLoading(false);
    }
  };

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

  const columns = [
    { title: '内容', dataIndex: 'content', key: 'content', width: 300,
      render: (c: string) => <span>{c.length > 50 ? c.slice(0, 50) + '...' : c}</span> },
    { title: '出自', dataIndex: 'from', key: 'from', width: 120 },
    { title: '分类', dataIndex: 'category', key: 'category', width: 120,
      render: (_: string, r: QuoteItem) => (
        <>{(r.categories && r.categories.length > 0 ? r.categories : [r.category]).map((c) => <Tag key={c}>{c}</Tag>)}</>
      ) },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (s: string) => <Tag color={statusColors[s]}>{statusLabels[s] || s}</Tag> },
    { title: '贡献者', dataIndex: 'contributor_id', key: 'contributor_id', width: 80 },
    { title: '提交时间', dataIndex: 'created_at', key: 'created_at', width: 140,
      render: (t: string) => dayjs(t).format('MM-DD HH:mm') },
    { title: '操作', key: 'action', width: 160,
      render: (_: unknown, r: QuoteItem) => (
        <Space>
          {canReview && (
            <Button size="small" type="primary" onClick={() => handleApprove(r.uuid)}
              disabled={r.status === 'approved'}>通过</Button>
          )}
          {canReview && (
            <Button size="small" danger onClick={() => handleReject(r.uuid)}
              disabled={r.status === 'rejected'}>驳回</Button>
          )}
        </Space>
      ) },
  ];

  return (
    <Card>
      <div style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <Select value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1); setSelectedRowKeys([]); }}
          style={{ width: 120 }}>
          <Select.Option value="pending">待审核</Select.Option>
          <Select.Option value="approved">已通过</Select.Option>
          <Select.Option value="rejected">已驳回</Select.Option>
        </Select>
        {isAdmin && selectedRowKeys.length > 0 && (
          <Space>
            <Button
              type="primary"
              size="small"
              loading={batchLoading}
              onClick={() => handleBatch('approve')}
            >
              批量通过 ({selectedRowKeys.length})
            </Button>
            <Button
              danger
              size="small"
              loading={batchLoading}
              onClick={() => handleBatch('reject')}
            >
              批量驳回 ({selectedRowKeys.length})
            </Button>
            <Popconfirm
              title={`确定删除选中的 ${selectedRowKeys.length} 条语录？此操作不可恢复。`}
              onConfirm={() => handleBatch('delete')}
            >
              <Button
                danger
                size="small"
                type="default"
                loading={batchLoading}
              >
                批量删除 ({selectedRowKeys.length})
              </Button>
            </Popconfirm>
            <Button size="small" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
          </Space>
        )}
      </div>
      <Table
        dataSource={quotes}
        columns={columns}
        rowKey="uuid"
        loading={loading}
        rowSelection={isAdmin ? {
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
        } : undefined}
        pagination={{
          current: page,
          total,
          pageSize: 20,
          onChange: (p) => { setPage(p); setSelectedRowKeys([]); },
          showTotal: (t) => `共 ${t} 条`,
          responsive: true,
          size: isMobile ? 'small' : undefined,
        }}
        scroll={{ x: 1000, y: 500 }}
        virtual
      />

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
          <span style={{ color: 'var(--surface-muted-text)', fontSize: 13 }}>
            {rejectTarget && 'batch' in rejectTarget
              ? '批量驳回 ' + selectedRowKeys.length + ' 条语录，请填写驳回理由（可选）'
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
    </Card>
  );
}

function RejectedQuotesPanel({ canReview, isAdmin, isMobile }: { canReview: boolean; isAdmin: boolean; isMobile: boolean }) {
  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);

  const fetchQuotes = useCallback(() => {
    setLoading(true);
    api.get('/quotes', { params: { page, page_size: 20, status: 'rejected' } })
      .then((res) => {
        setQuotes(res.data.quotes || []);
        setTotal(res.data.total || 0);
      })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  }, [page]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on page change
  useEffect(() => { fetchQuotes(); }, [fetchQuotes]);

  const handleReApprove = async (uuid: string) => {
    try {
      await api.put(`/quotes/${uuid}/approve`);
      message.success('已重新通过');
      fetchQuotes();
    } catch (err: unknown) {
      message.error(apiError(err, '操作失败'));
    }
  };

  const handleDelete = async (uuid: string) => {
    try {
      await api.delete(`/quotes/${uuid}`);
      message.success('已删除');
      fetchQuotes();
    } catch (err: unknown) {
      message.error(apiError(err, '删除失败'));
    }
  };

  const handleBatch = async (action: string) => {
    if (selectedRowKeys.length === 0) return;
    setBatchLoading(true);
    try {
      const res = await api.post('/admin/quotes/batch', { action, uuids: selectedRowKeys });
      message.success(`批量${action === 'approve' ? '通过' : '删除'}完成：${res.data.affected} 条`);
      setSelectedRowKeys([]);
      fetchQuotes();
    } catch (err: unknown) {
      message.error(apiError(err, '批量操作失败'));
    } finally {
      setBatchLoading(false);
    }
  };

  const handleApproveAll = async () => {
    setBatchLoading(true);
    try {
      const res = await api.post('/admin/quotes/approve-all-rejected');
      message.success(`全部通过完成：${res.data.affected} 条`);
      fetchQuotes();
    } catch (err: unknown) {
      message.error(apiError(err, '操作失败'));
    } finally {
      setBatchLoading(false);
    }
  };

  const columns = [
    { title: '内容', dataIndex: 'content', key: 'content', width: 300,
      render: (c: string) => <span>{c.length > 50 ? c.slice(0, 50) + '...' : c}</span> },
    { title: '出自', dataIndex: 'from', key: 'from', width: 120 },
    { title: '分类', dataIndex: 'category', key: 'category', width: 120,
      render: (_: string, r: QuoteItem) => (
        <>{(r.categories && r.categories.length > 0 ? r.categories : [r.category]).map((c) => <Tag key={c}>{c}</Tag>)}</>
      ) },
    { title: '贡献者', dataIndex: 'contributor_id', key: 'contributor_id', width: 80 },
    { title: '驳回时间', dataIndex: 'updated_at', key: 'updated_at', width: 140,
      render: (t: string) => dayjs(t).format('MM-DD HH:mm') },
    { title: '操作', key: 'action', width: 180,
      render: (_: unknown, r: QuoteItem) => (
        <Space>
          {canReview && (
            <Button size="small" type="primary" onClick={() => handleReApprove(r.uuid)}>重新通过</Button>
          )}
          <Popconfirm title="确定删除这条语录？" onConfirm={() => handleDelete(r.uuid)}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ) },
  ];

  return (
    <Card>
      {isAdmin && (
        <div style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Popconfirm
            title={`确定将所有 ${total} 条驳回语录全部改为通过？`}
            onConfirm={handleApproveAll}
          >
            <Button type="primary" size="small" loading={batchLoading} danger>
              全部通过 ({total} 条)
            </Button>
          </Popconfirm>
          {selectedRowKeys.length > 0 && (
            <Space>
              <Button
                type="primary"
                size="small"
                loading={batchLoading}
                onClick={() => handleBatch('approve')}
              >
                批量通过 ({selectedRowKeys.length})
              </Button>
            <Popconfirm
              title={`确定删除选中的 ${selectedRowKeys.length} 条语录？此操作不可恢复。`}
              onConfirm={() => handleBatch('delete')}
            >
              <Button danger size="small" loading={batchLoading}>
                批量删除 ({selectedRowKeys.length})
              </Button>
            </Popconfirm>
            <Button size="small" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
          </Space>
        )}
        </div>
      )}
      <Table
        dataSource={quotes}
        columns={columns}
        rowKey="uuid"
        loading={loading}
        rowSelection={isAdmin ? {
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
        } : undefined}
        pagination={{
          current: page,
          total,
          pageSize: 20,
          onChange: (p) => { setPage(p); setSelectedRowKeys([]); },
          showTotal: (t) => `共 ${t} 条`,
          responsive: true,
          size: isMobile ? 'small' : undefined,
        }}
        scroll={{ x: 1000, y: 500 }}
        virtual
      />
    </Card>
  );
}

function UserManagementPanel({ isAdmin, hasGlobalAdmin, isMobile }: { isAdmin: boolean; hasGlobalAdmin: boolean; isMobile: boolean }) {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [permModalUser, setPermModalUser] = useState<UserItem | null>(null);
  const [permValues, setPermValues] = useState({ review: false, category: false, delete_quote: false, upload: false, manage_lists: false, global_admin: false });
  const [permSaving, setPermSaving] = useState(false);
  const [addUserModalOpen, setAddUserModalOpen] = useState(false);
  const [addUserLoading, setAddUserLoading] = useState(false);
  const [addUserForm] = Form.useForm();
  const [resetPwdResult, setResetPwdResult] = useState<{ username: string; password: string } | null>(null);

  const fetchUsers = useCallback(() => {
    setLoading(true);
    const params: Record<string, string | number> = { page, page_size: 20 };
    if (roleFilter) params.role = roleFilter;
    if (statusFilter) params.status = statusFilter;
    api.get('/admin/users', { params })
      .then((res) => {
        setUsers(res.data.users || []);
        setTotal(res.data.total || 0);
      })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  }, [page, roleFilter, statusFilter]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on filter change
  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleBan = async (id: number) => {
    try {
      await api.put(`/admin/users/${id}/ban`);
      message.success('已封禁');
      fetchUsers();
    } catch (err: unknown) {
      message.error(apiError(err, '操作失败'));
    }
  };

  const handleUnban = async (id: number) => {
    try {
      await api.put(`/admin/users/${id}/unban`);
      message.success('已解封');
      fetchUsers();
    } catch (err: unknown) {
      message.error(apiError(err, '操作失败'));
    }
  };

  const openPermModal = (user: UserItem) => {
    const perms = user.permissions ?? 0;
    setPermValues({
      review: (perms & 1) !== 0,
      category: (perms & 2) !== 0,
      delete_quote: (perms & 4) !== 0,
      upload: (perms & 8) !== 0,
      manage_lists: (perms & 16) !== 0,
      global_admin: (perms & 32) !== 0,
    });
    setPermModalUser(user);
  };

  const handleSetPermissions = async () => {
    if (!permModalUser) return;
    let perms = 0;
    if (permValues.review) perms |= 1;
    if (permValues.category) perms |= 2;
    if (permValues.delete_quote) perms |= 4;
    if (permValues.upload) perms |= 8;
    if (permValues.manage_lists) perms |= 16;
    setPermSaving(true);
    try {
      // Global admin is handled separately via dedicated endpoints
      const currentGlobalAdmin = (permModalUser.permissions ?? 0) & 32;
      if (permValues.global_admin !== !!currentGlobalAdmin) {
        if (permValues.global_admin) {
          await api.post(`/admin/users/${permModalUser.id}/global-admin`);
        } else {
          await api.delete(`/admin/users/${permModalUser.id}/global-admin`);
        }
      }
      await api.put(`/admin/users/${permModalUser.id}/permissions`, { permissions: perms });
      message.success('权限已更新');
      setPermModalUser(null);
      fetchUsers();
    } catch (err: unknown) {
      message.error(apiError(err, '操作失败'));
    } finally {
      setPermSaving(false);
    }
  };

  const permissionGroups = [
    {
      title: '内容管理',
      key: 'content',
      perms: ['review', 'delete_quote', 'upload'] as const,
    },
    {
      title: '分类管理',
      key: 'category',
      perms: ['category'] as const,
    },
    {
      title: '列表管理',
      key: 'lists',
      perms: ['manage_lists'] as const,
    },
    {
      title: '全局管理',
      key: 'global',
      perms: ['global_admin'] as const,
    },
  ];

  const permLabels: Record<string, string> = {
    review: '审核语录',
    category: '管理分类',
    delete_quote: '删除语录',
    upload: '上传语录',
    manage_lists: '管理列表',
    global_admin: '全局管理员',
  };

  const handleAddUser = async () => {
    try {
      const values = await addUserForm.validateFields();
      setAddUserLoading(true);
      const payload: Record<string, unknown> = {
        username: values.username,
        email: values.email || '',
        role: values.role || 'user',
      };
      if (values.password) payload.password = values.password;
      await api.post('/admin/users', payload);
      message.success('用户创建成功');
      setAddUserModalOpen(false);
      addUserForm.resetFields();
      fetchUsers();
    } catch (err: unknown) {
      if (isFormValidationError(err)) return;
      message.error(apiError(err, '创建失败'));
    } finally {
      setAddUserLoading(false);
    }
  };

  const handleResetPassword = async (id: number) => {
    try {
      const res = await api.put(`/admin/users/${id}/reset-password`);
      setResetPwdResult({
        username: res.data.username,
        password: res.data.password,
      });
      message.success('密码已重置');
      fetchUsers();
    } catch (err: unknown) {
      message.error(apiError(err, '重置失败'));
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 100 },
    { title: '用户名', dataIndex: 'username', key: 'username', width: 120 },
    { title: '邮箱', dataIndex: 'email', key: 'email', width: 180 },
    { title: '角色', dataIndex: 'role', key: 'role', width: 80,
      render: (r: string) => {
        const colors: Record<string, string> = { admin: 'red', user: 'default' };
        return <Tag color={colors[r] || 'default'}>{r}</Tag>;
      } },
    { title: '权限', dataIndex: 'permissions', key: 'permissions', width: 200,
      render: (p: number | undefined) => {
        const perms = p ?? 0;
        return (
          <Space size={4}>
            {(perms & 1) !== 0 && <Tag color="blue">审核</Tag>}
            {(perms & 2) !== 0 && <Tag color="cyan">分类</Tag>}
            {(perms & 4) !== 0 && <Tag color="purple">删除</Tag>}
            {(perms & 8) !== 0 && <Tag color="green">上传</Tag>}
            {(perms & 16) !== 0 && <Tag color="orange">列表</Tag>}
            {(perms & 32) !== 0 && <Tag color="red">全局管理</Tag>}
            {perms === 0 && <span style={{ color: 'var(--surface-muted-text)' }}>-</span>}
          </Space>
        );
      } },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (s: string) => <Tag color={s === 'banned' ? 'red' : 'green'}>{s}</Tag> },
    { title: '注册时间', dataIndex: 'created_at', key: 'created_at', width: 140,
      render: (t: string) => dayjs(t).format('MM-DD HH:mm') },
    { title: '操作', key: 'action', width: 280,
      render: (_: unknown, r: UserItem) => (
        <Space>
          {r.status === 'banned' ? (
            isAdmin && <Button size="small" onClick={() => handleUnban(r.id)}>解封</Button>
          ) : (
            isAdmin && r.role !== 'admin' && (
              <Popconfirm title="确定封禁该用户？" onConfirm={() => handleBan(r.id)}>
                <Button size="small" danger>封禁</Button>
              </Popconfirm>
            )
          )}
          {isAdmin && r.role !== 'admin' && (
            <Button size="small" onClick={() => openPermModal(r)}>权限</Button>
          )}
          {isAdmin && r.role !== 'admin' && (
            <Popconfirm
              title={`确定重置「${r.username}」的密码？`}
              description="重置后将生成新的随机密码"
              onConfirm={() => handleResetPassword(r.id)}
              okText="确认重置"
              cancelText="取消"
            >
              <Button size="small" icon={<KeyOutlined />}>重置密码</Button>
            </Popconfirm>
          )}
        </Space>
      ) },
  ];

  return (
    <Card>
      <div style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Select placeholder="角色筛选" allowClear value={roleFilter || undefined}
          onChange={(v) => { setRoleFilter(v || ''); setPage(1); }} style={{ width: 120 }}>
          <Select.Option value="admin">管理员</Select.Option>
          <Select.Option value="user">用户</Select.Option>
        </Select>
        <Select placeholder="状态筛选" allowClear value={statusFilter || undefined}
          onChange={(v) => { setStatusFilter(v || ''); setPage(1); }} style={{ width: 120 }}>
          <Select.Option value="active">正常</Select.Option>
          <Select.Option value="banned">已封禁</Select.Option>
        </Select>
        {isAdmin && (
          <Button type="primary" icon={<UserAddOutlined />} onClick={() => setAddUserModalOpen(true)}>
            添加用户
          </Button>
        )}
      </div>
      <Table
        dataSource={users}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{
          current: page,
          total,
          pageSize: 20,
          onChange: (p) => setPage(p),
          showTotal: (t) => `共 ${t} 条`,
          responsive: true,
          size: isMobile ? 'small' : undefined,
        }}
        scroll={{ x: 1000 }}
      />

      <Modal
        title={`设置权限 - ${permModalUser?.username || ''}`}
        open={!!permModalUser}
        onOk={handleSetPermissions}
        onCancel={() => setPermModalUser(null)}
        confirmLoading={permSaving}
        okText="保存"
        cancelText="取消"
      >
        <div style={{ marginTop: 16 }}>
          {permissionGroups.map((group) => (
            <div key={group.key} style={{ marginBottom: 20 }}>
              <div style={{
                fontWeight: 600, fontSize: 14, color: 'var(--text-secondary)',
                padding: '8px 0', borderBottom: '1px solid var(--border-light)', marginBottom: 8,
              }}>
                {group.title}
              </div>
              {group.perms.map((key) => (
                <div key={key} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 0',
                }}>
                  <Checkbox
                    checked={permValues[key]}
                    disabled={key === 'global_admin' && !hasGlobalAdmin && !isAdmin}
                    onChange={(e) => setPermValues({ ...permValues, [key]: e.target.checked })}
                  />
                  <span>{permLabels[key]}</span>
                  {key === 'global_admin' && !hasGlobalAdmin && !isAdmin && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>（需全局管理员权限）</Typography.Text>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </Modal>
      <Modal
        title="添加用户"
        open={addUserModalOpen}
        onCancel={() => { setAddUserModalOpen(false); addUserForm.resetFields(); }}
        onOk={handleAddUser}
        confirmLoading={addUserLoading}
        okText="创建"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={addUserForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, min: 3, max: 50, message: '请输入用户名（3-50 字符）' }, { pattern: /^[a-zA-Z0-9_]+$/, message: '用户名只能包含字母、数字和下划线' }]}>
            <Input placeholder="用户名" maxLength={50} />
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ type: 'email', message: '请输入有效邮箱' }]}>
            <Input placeholder="选填" maxLength={100} />
          </Form.Item>
          <Form.Item name="password" label="密码" extra="留空则自动生成 8 位随机密码">
            <Input.Password placeholder="留空自动生成" maxLength={100} />
          </Form.Item>
          <Form.Item name="role" label="角色" initialValue="user">
            <Select>
              <Select.Option value="user">普通用户</Select.Option>
              <Select.Option value="admin">管理员</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="密码已重置"
        open={!!resetPwdResult}
        onCancel={() => setResetPwdResult(null)}
        footer={[
          <Button key="close" type="primary" onClick={() => setResetPwdResult(null)}>关闭</Button>,
        ]}
      >
        {resetPwdResult && (
          <div style={{ marginTop: 16 }}>
            <div style={{ marginBottom: 12 }}>
              用户 <strong>{resetPwdResult.username}</strong> 的新密码为：
            </div>
            <div style={{
              background: 'var(--warning-bg)', border: '1px solid var(--warning-border)', borderRadius: 6,
              padding: '12px 16px', fontFamily: 'monospace', fontSize: 18,
              textAlign: 'center', letterSpacing: 2, marginBottom: 12,
            }}>
              {resetPwdResult.password}
            </div>
            <div style={{ color: '#ff4d4f', fontSize: 13 }}>
              <ExclamationCircleOutlined style={{ marginRight: 6 }} />
              请立即将此密码告知用户，关闭后将无法再次查看。
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}

interface CategoryItem {
  id: number;
  name: string;
  display_name?: string;
  count: number;
}

function CategoryManagementPanel({ isMobile }: { isMobile: boolean }) {
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [editTarget, setEditTarget] = useState<CategoryItem | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();

  const fetchCategories = useCallback(() => {
    setLoading(true);
    api.get('/categories')
      .then((res) => setCategories(res.data.categories || []))
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time mount fetch
  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setCreateLoading(true);
      const payload: Record<string, string> = { name: values.name };
      if (values.display_name) payload.display_name = values.display_name;
      await api.post('/admin/categories', payload);
      message.success('分类已创建');
      setModalOpen(false);
      form.resetFields();
      fetchCategories();
    } catch (err: unknown) {
      if (isFormValidationError(err)) return;
      message.error(apiError(err, '创建失败'));
    } finally {
      setCreateLoading(false);
    }
  };

  const openEdit = (cat: CategoryItem) => {
    setEditTarget(cat);
    editForm.setFieldsValue({ name: cat.name, display_name: cat.display_name || '' });
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    try {
      const values = await editForm.validateFields();
      setEditLoading(true);
      const payload: Record<string, string> = { name: values.name };
      if (values.display_name) payload.display_name = values.display_name;
      await api.put(`/admin/categories/${editTarget.id}`, payload);
      message.success('分类已更新');
      setEditTarget(null);
      editForm.resetFields();
      fetchCategories();
    } catch (err: unknown) {
      if (isFormValidationError(err)) return;
      message.error(apiError(err, '更新失败'));
    } finally {
      setEditLoading(false);
    }
  };

  const handleDelete = async (cat: CategoryItem) => {
    try {
      await api.delete(`/admin/categories/${cat.id}`);
      message.success('分类已删除，相关语录已设为「其他」');
      fetchCategories();
    } catch (err: unknown) {
      message.error(apiError(err, '删除失败'));
    }
  };

  const categoryColors: Record<string, string> = {
    anime: 'volcano', comic: 'orange', novel: 'blue',
    game: 'green', movie: 'purple', music: 'pink', other: 'default',
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 80 },
    { title: '名称', dataIndex: 'name', key: 'name', width: 120,
      render: (n: string) => <Tag color={categoryColors[n] || 'default'}>{n}</Tag> },
    { title: '显示名称', dataIndex: 'display_name', key: 'display_name', width: 120,
      render: (d: string) => d || <span style={{ color: 'var(--text-muted)' }}>-</span> },
    { title: '语录数', dataIndex: 'count', key: 'count', width: 100 },
    { title: '操作', key: 'action', width: 160,
      render: (_: unknown, r: CategoryItem) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>重命名</Button>
          <Popconfirm
            title={`确定删除分类「?{r.name}」？`}
            description={`相关语录将自动设为「其他」分类。`}
            onConfirm={() => handleDelete(r)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" danger icon={<DeleteOutlined />} disabled={r.name === 'other'}>删除</Button>
          </Popconfirm>
        </Space>
      ) },
  ];

  return (
    <Card>
      <div style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          新建分类
        </Button>
      </div>
      <Table
        dataSource={categories}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 50, responsive: true, size: isMobile ? 'small' : undefined }}
      />
      <Modal
        title="新建分类"
        open={modalOpen}
        onCancel={() => { setModalOpen(false); form.resetFields(); }}
        onOk={handleCreate}
        confirmLoading={createLoading}
        okText="创建"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="分类标识" rules={[{ required: true, min: 1, max: 50, message: '请输入分类标识' }]}>
            <Input placeholder="例如：anime, sports" maxLength={50} />
          </Form.Item>
          <Form.Item name="display_name" label="显示名称" rules={[{ max: 50 }]}>
            <Input placeholder="例如：动画, 体育（留空则使用标识）" maxLength={50} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="重命名分类"
        open={!!editTarget}
        onCancel={() => { setEditTarget(null); editForm.resetFields(); }}
        onOk={handleEdit}
        confirmLoading={editLoading}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="分类标识" rules={[{ required: true, min: 1, max: 50, message: '请输入分类标识' }]}>
            <Input placeholder="输入新标识" maxLength={50} />
          </Form.Item>
          <Form.Item name="display_name" label="显示名称" rules={[{ max: 50 }]}>
            <Input placeholder="输入显示名称（留空则使用标识）" maxLength={50} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

interface AdminListItem {
  id: number;
  uuid: string;
  name: string;
  description: string;
  is_public: boolean;
  user_id: number;
  username: string;
  item_count: number;
  type: string;
  reference_count: number;
  blocked: boolean;
  blocked_reason?: string;
  created_at: string;
  updated_at: string;
}

function ListManagementPanel({ isMobile }: { isMobile: boolean }) {
  const [lists, setLists] = useState<AdminListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [blocking, setBlocking] = useState<number | null>(null);
  const [blockModalOpen, setBlockModalOpen] = useState(false);
  const [blockTarget, setBlockTarget] = useState<AdminListItem | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const [blockingSubmit, setBlockingSubmit] = useState(false);

  const fetchLists = useCallback(() => {
    setLoading(true);
    api.get('/admin/lists', { params: { page, page_size: 20 } })
      .then((res) => {
        setLists(res.data.lists || []);
        setTotal(res.data.total || 0);
      })
      .catch(() => message.error('加载列表失败'))
      .finally(() => setLoading(false));
  }, [page]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on page change
  useEffect(() => { fetchLists(); }, [fetchLists]);

  const handleDelete = async (id: number) => {
    setDeleting(id);
    try {
      await api.delete(`/admin/lists/${id}`);
      message.success('列表已删除');
      fetchLists();
    } catch (err: unknown) {
      message.error(apiError(err, '删除失败'));
    } finally {
      setDeleting(null);
    }
  };

  const openBlockModal = (list: AdminListItem) => {
    setBlockTarget(list);
    setBlockReason('');
    setBlockModalOpen(true);
  };

  const handleBlock = async () => {
    if (!blockTarget) return;
    setBlockingSubmit(true);
    try {
      await api.put(`/admin/lists/${blockTarget.id}/block`, { reason: blockReason });
      message.success('列表已屏蔽');
      setBlockModalOpen(false);
      fetchLists();
    } catch (err: unknown) {
      message.error(apiError(err, '屏蔽失败'));
    } finally {
      setBlockingSubmit(false);
    }
  };

  const handleUnblock = async (id: number) => {
    setBlocking(id);
    try {
      await api.put(`/admin/lists/${id}/unblock`);
      message.success('列表已解封');
      fetchLists();
    } catch (err: unknown) {
      message.error(apiError(err, '解封失败'));
    } finally {
      setBlocking(null);
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 70 },
    { title: '名称', dataIndex: 'name', key: 'name', width: 180,
      render: (name: string, r: AdminListItem) => (
        <span>{r.blocked ? <span style={{ color: '#ff4d4f' }}>馃攪 {name}</span> : name}</span>
      ) },
    { title: '所有者', dataIndex: 'username', key: 'username', width: 100,
      render: (un: string) => <Tag>{un}</Tag> },
    { title: '类型', dataIndex: 'type', key: 'type', width: 80,
      render: (t: string) => <Tag color={t === 'aggregated' ? 'purple' : 'blue'}>{t === 'aggregated' ? '聚合' : '普通'}</Tag> },
    { title: '可见性', dataIndex: 'is_public', key: 'is_public', width: 70,
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '公开' : '私密'}</Tag> },
    { title: '状态', dataIndex: 'blocked', key: 'blocked', width: 60,
      render: (v: boolean) => v ? <Tag color="red">已屏蔽</Tag> : <Tag color="green">正常</Tag> },
    { title: '条目', dataIndex: 'item_count', key: 'item_count', width: 55, align: 'center' as const },
    { title: '被引用', dataIndex: 'reference_count', key: 'reference_count', width: 55, align: 'center' as const },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 130,
      render: (t: string) => dayjs(t).format('MM-DD HH:mm') },
    { title: '操作', key: 'action', width: 130,
      render: (_: unknown, r: AdminListItem) => (
        <Space size="small">
          {r.blocked ? (
            <Button size="small" onClick={() => handleUnblock(r.id)} loading={blocking === r.id}>
              解封
            </Button>
          ) : (
            <Button size="small" onClick={() => openBlockModal(r)}>
              屏蔽
            </Button>
          )}
          <Popconfirm title="确定删除此列表？" description="引用了此列表的聚合列表将受影响" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} loading={deleting === r.id} />
          </Popconfirm>
        </Space>
      ) },
  ];

  return (
    <Card>
      <Table
        dataSource={lists}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{
          current: page,
          total,
          pageSize: 20,
          onChange: (p) => setPage(p),
          showTotal: (t) => `共 ${t} 条`,
          responsive: true,
          size: isMobile ? 'small' : undefined,
        }}
        scroll={{ x: 950 }}
      />
      <Modal
        title={`屏蔽列表 - ${blockTarget?.name || ''}`}
        open={blockModalOpen}
        onCancel={() => { setBlockModalOpen(false); setBlockReason(''); }}
        onOk={handleBlock}
        confirmLoading={blockingSubmit}
        okText="确认屏蔽"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <div style={{ marginTop: 16 }}>
          <div style={{ background: 'var(--error-bg)', border: '1px solid var(--error-border)', borderRadius: 6, padding: 12, marginBottom: 16 }}>
            屏蔽后该列表将无法通过公开链接访问，列表所有者将收到通知。
          </div>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>屏蔽原因（选填）</div>
          <Input.TextArea
            value={blockReason}
            onChange={(e) => setBlockReason(e.target.value)}
            placeholder="输入屏蔽原因，将随通知发送给列表所有者"
            maxLength={500}
            rows={3}
          />
        </div>
      </Modal>
    </Card>
  );
}

function SiteSettingsPanel() {
  const [anonUpload, setAnonUpload] = useState(false);
  const [loading, setLoading] = useState(false);
  const { refresh } = useSiteConfig();
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [apiUrlSaving, setApiUrlSaving] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [keepData, setKeepData] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [repairing, setRepairing] = useState(false);

  useEffect(() => {
    api.get('/admin/settings')
      .then((res) => {
        const s = res.data.settings || {};
        setAnonUpload(s.anonymous_upload !== 'false');
        setApiBaseUrl(s.api_base_url || '');
      })
      .catch(() => {});
  }, []);

  const toggle = async (checked: boolean) => {
    setLoading(true);
    try {
      await api.put('/admin/settings', { key: 'anonymous_upload', value: String(checked) });
      setAnonUpload(checked);
      refresh();
      message.success(checked ? '匿名上传已开启' : '匿名上传已关闭');
    } catch (err: unknown) {
      message.error(apiError(err, '设置失败'));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveApiUrl = async () => {
    setApiUrlSaving(true);
    try {
      await api.put('/admin/settings', { key: 'api_base_url', value: apiBaseUrl });
      refresh();
      message.success('API 地址已保存');
    } catch (err: unknown) {
      message.error(apiError(err, '保存失败'));
    } finally {
      setApiUrlSaving(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      await api.post('/admin/reset', { keep_data: keepData });
      message.success('服务器已重置，即将跳转到初始化页面');
      setTimeout(() => { window.location.href = '/setup'; }, 1500);
    } catch (err: unknown) {
      message.error(apiError(err, '重置失败'));
    } finally {
      setResetting(false);
      setResetModalOpen(false);
    }
  };

  const handleRepair = async () => {
    setRepairing(true);
    try {
      const res = await api.post('/admin/repair');
      const msgs = res.data.message || [];
      message.success(Array.isArray(msgs) ? msgs.join('；') : msgs);
    } catch (err: unknown) {
      message.error(apiError(err, '修复失败'));
    } finally {
      setRepairing(false);
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 500, marginBottom: 4 }}>匿名上传</div>
          <div style={{ color: 'var(--surface-muted-text)', fontSize: 13 }}>
            开启后，未登录用户可以通过邀请码提交语录
          </div>
        </div>
        <Switch checked={anonUpload} onChange={toggle} loading={loading} />
      </div>

      <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 24, paddingTop: 24 }}>
        <div style={{ fontWeight: 500, marginBottom: 4 }}>API 地址</div>
        <div style={{ color: 'var(--surface-muted-text)', fontSize: 13, marginBottom: 12 }}>
          设置后前端所有 API 请求将发送到此地址，留空则使用当前服务器地址
        </div>
        <Space.Compact style={{ width: '100%', maxWidth: 400 }}>
          <Input
            placeholder="https://api.example.com"
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
          />
          <Button type="primary" onClick={handleSaveApiUrl} loading={apiUrlSaving}>保存</Button>
        </Space.Compact>
      </div>

      <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 24, paddingTop: 24 }}>
        <div style={{ fontWeight: 500, marginBottom: 4 }}>数据库修复</div>
        <div style={{ color: 'var(--surface-muted-text)', fontSize: 13, marginBottom: 12 }}>
          检查并修复用户权限等数据不一致问题
        </div>
        <Button icon={<ToolOutlined />} onClick={handleRepair} loading={repairing}>
          修复数据库
        </Button>
      </div>

      <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 24, paddingTop: 24 }}>
        <div style={{ fontWeight: 500, marginBottom: 4 }}>重置服务器</div>
        <div style={{ color: 'var(--surface-muted-text)', fontSize: 13, marginBottom: 12 }}>
          重置后需要重新完成初始化设置，建议先备份数据
        </div>
        <Button danger icon={<ExclamationCircleOutlined />} onClick={() => setResetModalOpen(true)}>
          重置服务器
        </Button>
      </div>

      <Modal
        title="重置服务器"
        open={resetModalOpen}
        onCancel={() => setResetModalOpen(false)}
        onOk={handleReset}
        confirmLoading={resetting}
        okText="确认重置"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <div style={{ marginTop: 16 }}>
          <div style={{ background: 'var(--error-bg)', border: '1px solid var(--error-border)', borderRadius: 6, padding: 12, marginBottom: 16 }}>
            <ExclamationCircleOutlined style={{ color: '#ff4d4f', marginRight: 8 }} />
            重置后需要重新设置管理员，所有 JWT 令牌将失效
          </div>
          <Space align="start">
            <Switch checked={keepData} onChange={setKeepData} />
            <div>
              <div style={{ fontWeight: 500 }}>保留已有数据</div>
              <div style={{ color: 'var(--surface-muted-text)', fontSize: 13 }}>勾选后语录、用户等数据不会删除，仅重新触发初始化流程</div>
            </div>
          </Space>
        </div>
      </Modal>
    </Card>
  );
}

// ─── AI Settings Panel ───────────────────────────────────────────────────────

interface SuggestionItem {
  name: string;
  display_name: string;
  is_new: boolean;
  confidence: string;
  reason: string;
}

interface BatchLogEntry {
  quote_uuid: string;
  content: string;
  from: string;
  old_category: string;
  suggestions: SuggestionItem[];
  is_error: boolean;
  error?: string;
  change_id?: number;
  retry_count?: number;
  skipped?: boolean;
  auto_approved?: boolean;
  applied_categories?: string[];
}

interface BatchMsg {
  type: 'start' | 'log' | 'done' | 'stopped' | 'paused' | 'resumed' | 'error';
  total?: number;
  processed?: number;
  log?: BatchLogEntry;
  message?: string;
  batch_run?: string;
  paused?: boolean;
}

// ─── Batch classify panel ─────────────────────────────────────────────────────

function AIBatchPanel() {
  const wsRef = useRef<WebSocket | null>(null);
  const logsBottomRef = useRef<HTMLDivElement>(null);
  const [jobState, setJobState] = useState<'idle' | 'running' | 'paused' | 'done' | 'stopped'>('idle');
  const jobStateRef = useRef<'idle' | 'running' | 'paused' | 'done' | 'stopped'>('idle');
  const [processed, setProcessed] = useState(0);
  const [total, setTotal] = useState(0);
  const [logs, setLogs] = useState<BatchLogEntry[]>([]);
  const [wsError, setWsError] = useState('');
  const [batchRun, setBatchRun] = useState('');

  // Filter: restricts which quotes enter the batch run.
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [filterKeyword, setFilterKeyword] = useState('');
  const [filterOnlyUnclassified, setFilterOnlyUnclassified] = useState(false);
  const [categoryOptions, setCategoryOptions] = useState<{ value: string; label: string }[]>([]);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Build the filter payload sent to the backend (omitting empty fields).
  const buildFilter = useCallback(() => {
    const f: { status?: string; categories?: string[]; search?: string[]; only_unclassified?: boolean } = {};
    if (filterStatus) f.status = filterStatus;
    if (filterCategories.length > 0) f.categories = filterCategories;
    const kw = filterKeyword.trim();
    if (kw) f.search = kw.split(/\s+/);
    if (filterOnlyUnclassified) f.only_unclassified = true;
    return f;
  }, [filterStatus, filterCategories, filterKeyword, filterOnlyUnclassified]);

  const getWsUrl = () => {
    const token = localStorage.getItem('access_token') || '';
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const base = api.defaults.baseURL || '/api';
    let host: string, path: string;
    try {
      const u = new URL(base, window.location.href);
      host = u.host;
      path = u.pathname.replace(/\/api\/?$/, '');
    } catch {
      host = window.location.host; path = '';
    }
    return proto + '://' + host + path + '/api/admin/ai/batch-classify/ws?token=' + encodeURIComponent(token);
  };

  const connectWs = () => {
    if (wsRef.current) {
      wsRef.current.onopen = wsRef.current.onmessage = wsRef.current.onerror = wsRef.current.onclose = null;
      if (wsRef.current.readyState !== WebSocket.CLOSED) wsRef.current.close();
    }
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;
    ws.onmessage = (e: MessageEvent) => {
      let msg: BatchMsg;
      try { msg = JSON.parse(e.data as string) as BatchMsg; } catch { return; }
      if (msg.type === 'start') {
        setTotal(msg.total ?? 0); setProcessed(0); setLogs([]);
        setBatchRun(msg.batch_run ?? '');
        setJobState('running'); jobStateRef.current = 'running'; setWsError('');
      } else if (msg.type === 'log') {
        if (msg.processed !== undefined) setProcessed(msg.processed);
        if (msg.total !== undefined) setTotal(msg.total);
        if (msg.log) setLogs((prev) => [...prev, msg.log!]);
      } else if (msg.type === 'paused') {
        if (msg.processed !== undefined) setProcessed(msg.processed);
        setJobState('paused'); jobStateRef.current = 'paused';
      } else if (msg.type === 'resumed') {
        setJobState('running'); jobStateRef.current = 'running';
      } else if (msg.type === 'done') {
        if (msg.processed !== undefined) setProcessed(msg.processed);
        setJobState('done'); jobStateRef.current = 'done';
      } else if (msg.type === 'stopped') {
        if (msg.processed !== undefined) setProcessed(msg.processed);
        setJobState('stopped'); jobStateRef.current = 'stopped';
      } else if (msg.type === 'error') {
        setWsError(msg.message || '任务出错');
        setJobState('idle'); jobStateRef.current = 'idle';
      }
    };
    ws.onerror = () => { setWsError('WebSocket 连接失败'); setJobState('idle'); jobStateRef.current = 'idle'; };
    ws.onclose = () => { if (jobStateRef.current === 'running') { setJobState('stopped'); jobStateRef.current = 'stopped'; } };
    return ws;
  };

  useEffect(() => {
    api.get('/admin/ai/batch/status').then((r) => {
      const s = r.data;
      // Restore the last job's progress on refresh, whatever its state
      // (running / paused / done / stopped).
      if (s.running || (s.done && (s.processed ?? 0) > 0)) {
        setTotal(s.total ?? 0); setProcessed(s.processed ?? 0); setBatchRun(s.batch_run ?? '');
        if (s.done) {
          const st = s.stopped ? 'stopped' : 'done';
          setJobState(st); jobStateRef.current = st;
        } else {
          const st = s.paused ? 'paused' : 'running';
          setJobState(st); jobStateRef.current = st;
          connectWs();
        }
      }
    }).catch(() => {});
    // Load category options for the filter selector.
    api.get('/categories').then((r) => {
      const cats = (r.data.categories || []) as { name: string; display_name?: string }[];
      setCategoryOptions(cats.map((c) => ({
        value: c.name,
        label: c.display_name && c.display_name !== c.name ? `${c.name}（${c.display_name}）` : c.name,
      })));
    }).catch(() => {});
    return () => { wsRef.current?.close(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced preview of how many quotes match the current filter.
  useEffect(() => {
    const active = jobState === 'running' || jobState === 'paused';
    const handle = setTimeout(() => {
      if (active) { setPreviewCount(null); return; }
      setPreviewLoading(true);
      api.post('/admin/ai/batch/preview', buildFilter())
        .then((r) => setPreviewCount(r.data.count ?? 0))
        .catch(() => setPreviewCount(null))
        .finally(() => setPreviewLoading(false));
    }, active ? 0 : 400);
    return () => clearTimeout(handle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterCategories, filterKeyword, filterOnlyUnclassified, jobState]);

  const handleStart = () => {
    setWsError(''); setLogs([]); setProcessed(0); setTotal(0);
    const ws = connectWs();
    const send = () => ws.send(JSON.stringify({ action: 'start', filter: buildFilter() }));
    if (ws.readyState === WebSocket.OPEN) send(); else ws.onopen = send;
  };
  const handleStop = () => wsRef.current?.send(JSON.stringify({ action: 'stop' }));
  const handlePause = async () => { try { await api.post('/admin/ai/batch/pause'); } catch (err: unknown) { message.error(apiError(err, '暂停失败')); } };
  const handleResume = async () => { try { await api.post('/admin/ai/batch/resume'); } catch (err: unknown) { message.error(apiError(err, '恢复失败')); } };

  useEffect(() => { logsBottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs.length]);

  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
  const isRunning = jobState === 'running';
  const isPaused = jobState === 'paused';
  const hasResult = isRunning || isPaused || jobState === 'done' || jobState === 'stopped';

  const returnUrl = batchRun ? `/admin/ai-changes?batch_run=${batchRun}` : '/admin/ai-changes';

  return (
    <div>
      {!isRunning && !isPaused && (
        <div style={{ marginBottom: 16, padding: '12px 14px', background: 'var(--surface-secondary, #f6f8fa)', border: '1px solid var(--border-light, #e0e0e0)', borderRadius: 8 }}>
          <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 10 }}>筛选要分类的语录（留空则处理全部）</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <Select
              allowClear
              placeholder="状态（全部）"
              style={{ width: 140 }}
              value={filterStatus || undefined}
              onChange={(v) => setFilterStatus(v ?? '')}
              options={[
                { value: 'pending', label: '待审核' },
                { value: 'approved', label: '已通过' },
                { value: 'rejected', label: '已驳回' },
              ]}
            />
            <Select
              mode="multiple"
              allowClear
              placeholder="分类（全部）"
              style={{ minWidth: 220, maxWidth: 360 }}
              value={filterCategories}
              onChange={setFilterCategories}
              options={categoryOptions}
              maxTagCount="responsive"
              filterOption={(input, opt) => (opt?.label as string ?? '').toLowerCase().includes(input.toLowerCase())}
            />
            <Input
              allowClear
              placeholder="关键词（内容/出处，空格分隔）"
              style={{ width: 240 }}
              value={filterKeyword}
              onChange={(e) => setFilterKeyword(e.target.value)}
            />
            <Checkbox checked={filterOnlyUnclassified} onChange={(e) => setFilterOnlyUnclassified(e.target.checked)}>
              仅未处理过的语录
            </Checkbox>
          </div>
          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--surface-muted-text)' }}>
            {previewLoading
              ? '正在统计匹配数量…'
              : previewCount === null
                ? '无法获取匹配数量'
                : <>匹配 <strong style={{ color: 'var(--text-primary)' }}>{previewCount}</strong> 条语录将进入分类</>}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {!isRunning && !isPaused
          ? <Button type="primary" icon={<RobotOutlined />} onClick={handleStart} disabled={previewCount === 0}>启动批量 AI 分类</Button>
          : <>
              {isRunning && <Button onClick={handlePause}>暂停</Button>}
              {isPaused && <Button type="primary" onClick={handleResume}>继续</Button>}
              <Button danger onClick={handleStop}>停止</Button>
            </>
        }
        {hasResult && (
          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 14 }}>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{processed}</span>
            <span style={{ color: 'var(--surface-muted-text)', margin: '0 4px' }}>/</span>
            <span style={{ fontWeight: 600 }}>{total}</span>
            <span style={{ color: 'var(--surface-muted-text)', marginLeft: 6 }}>
              {jobState === 'done' ? '已完成'
                : jobState === 'stopped' ? '已停止'
                : jobState === 'paused' ? '已暂停'
                : percent + '%'}
            </span>
          </span>
        )}
      </div>

      {wsError && (
        <div style={{ color: '#ff4d4f', background: 'var(--error-bg, #fff2f0)', border: '1px solid #ffccc7', borderRadius: 6, padding: '6px 12px', marginBottom: 12, fontSize: 13 }}>
          {wsError}
        </div>
      )}

      {hasResult && (
        <div style={{ height: 6, background: 'var(--border-light, #f0f0f0)', borderRadius: 3, overflow: 'hidden', marginBottom: 12 }}>
          <div style={{
            height: '100%', width: percent + '%', borderRadius: 3, transition: 'width 0.25s ease',
            background: jobState === 'stopped' ? '#faad14' : jobState === 'done' ? '#52c41a' : jobState === 'paused' ? '#722ed1' : '#1677ff',
          }} />
        </div>
      )}

      {(hasResult || batchRun) && (
        <Button
          size="small" type="link"
          href={returnUrl}
          target="_blank"
          style={{ padding: 0, fontSize: 13 }}
        >
          查看变更记录与审核 →
        </Button>
      )}
    </div>
  );
}

function AISettingsPanel() {
  const [enabled, setEnabled] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [modelName, setModelName] = useState('');
  const [rpmLimit, setRpmLimit] = useState<number>(10);
  const [autoApprove, setAutoApprove] = useState(false);
  const [autoApproveConfidence, setAutoApproveConfidence] = useState<'high' | 'medium' | 'low'>('high');
  const [saving, setSaving] = useState(false);
  const [modelList, setModelList] = useState<string[]>([]);
  const [modelListLoading, setModelListLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ reply: string; latency_ms: number } | null>(null);

  useEffect(() => {
    api.get('/admin/settings').then((res) => {
      const s = res.data.settings || {};
      setEnabled(s.ai_enabled === 'true');
      setApiKey(s.ai_api_key || '');
      setBaseUrl(s.ai_base_url || '');
      setModelName(s.ai_model || '');
      const rpm = parseInt(s.ai_rpm_limit, 10);
      setRpmLimit(isNaN(rpm) ? 10 : rpm);
      setAutoApprove(s.ai_auto_approve === 'true');
      const conf = s.ai_auto_approve_confidence;
      setAutoApproveConfidence(conf === 'low' || conf === 'medium' ? conf : 'high');
    }).catch(() => {});
  }, []);

  const saveSetting = async (key: string, value: string) => {
    await api.put('/admin/settings', { key, value });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSetting('ai_enabled', String(enabled));
      if (apiKey && !apiKey.startsWith('****')) {
        await saveSetting('ai_api_key', apiKey);
      }
      await saveSetting('ai_base_url', baseUrl);
      await saveSetting('ai_model', modelName);
      await saveSetting('ai_rpm_limit', String(rpmLimit));
      await saveSetting('ai_auto_approve', String(autoApprove));
      await saveSetting('ai_auto_approve_confidence', autoApproveConfidence);
      message.success('AI 设置已保存');
    } catch (err: unknown) {
      message.error(apiError(err, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const fetchModelList = async () => {
    setModelListLoading(true);
    try {
      const res = await api.post('/admin/ai/models', {
        api_key: apiKey.startsWith('****') ? '' : apiKey,
        base_url: baseUrl,
      });
      const list: string[] = res.data.models || [];
      list.sort();
      setModelList(list);
      if (list.length === 0) message.warning('服务商无相关功能或 API 密钥错误');
    } catch (err: unknown) {
      message.error(apiError(err, '服务商无相关功能或 API 密钥错误'));
      setModelList([]);
    } finally {
      setModelListLoading(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post('/admin/ai/test', {
        api_key: apiKey.startsWith('****') ? '' : apiKey,
        base_url: baseUrl,
        model: modelName,
      });
      setTestResult(res.data);
    } catch (err: unknown) {
      message.error(apiError(err, '连接测试失败'));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ fontWeight: 500, marginBottom: 4 }}>AI 自动分类</div>
          <div style={{ color: 'var(--surface-muted-text)', fontSize: 13 }}>
            开启后语录提交时 AI 自动分类；变更默认需在「AI 审核」页面人工通过后生效，启用下方自动审批后达标建议将直接应用
          </div>
        </div>
        <Switch checked={enabled} onChange={setEnabled} />
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 500, marginBottom: 6 }}>API Key</div>
        <Space.Compact style={{ width: '100%', maxWidth: 480 }}>
          <Input
            type={apiKeyVisible ? 'text' : 'password'}
            placeholder="sk-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="new-password"
          />
          <Tooltip title={apiKeyVisible ? '隐藏' : '显示'}>
            <Button
              icon={apiKeyVisible ? <EyeInvisibleOutlined /> : <EyeOutlined />}
              onClick={() => setApiKeyVisible(!apiKeyVisible)}
            />
          </Tooltip>
        </Space.Compact>
        <div style={{ color: 'var(--surface-muted-text)', fontSize: 12, marginTop: 4 }}>
          保存后以脱敏形式展示；如需更换请直接输入新 Key
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 500, marginBottom: 6 }}>API Base URL</div>
        <Input style={{ maxWidth: 480 }} placeholder="https://api.openai.com/v1（留空使用默认）"
          value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 500, marginBottom: 6 }}>模型名称</div>
        <Space.Compact style={{ maxWidth: 480 }}>
          <Select showSearch style={{ width: 300 }} placeholder="gpt-4o-mini（留空使用默认）"
            value={modelName || undefined}
            onChange={(v) => setModelName(v ?? '')}
            options={modelList.length > 0
              ? modelList.map((m) => ({ value: m, label: m }))
              : (modelName ? [{ value: modelName, label: modelName }] : [])}
            filterOption={(input, opt) => (opt?.label as string ?? '').toLowerCase().includes(input.toLowerCase())}
            notFoundContent={null} allowClear onClear={() => setModelName('')}
          />
          <Button onClick={fetchModelList} loading={modelListLoading}>获取模型列表</Button>
        </Space.Compact>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontWeight: 500, marginBottom: 6 }}>RPM 限制</div>
        <InputNumber min={1} max={30} value={rpmLimit} onChange={(v) => setRpmLimit(v ?? 10)}
          style={{ width: 140 }} addonAfter="次/分钟" />
        <div style={{ color: 'var(--surface-muted-text)', fontSize: 12, marginTop: 4 }}>最大 30 RPM</div>
      </div>

      <div style={{ borderTop: '1px solid var(--border-light, #f0f0f0)', paddingTop: 20, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>自动审批</div>
            <div style={{ color: 'var(--surface-muted-text)', fontSize: 13 }}>
              开启后，达到所选置信度的 AI 建议将自动应用到语录分类，无需人工审核
            </div>
          </div>
          <Switch checked={autoApprove} onChange={setAutoApprove} />
        </div>

        {autoApprove && (
          <div>
            <div style={{ fontWeight: 500, marginBottom: 6 }}>自动审批置信度</div>
            <Select
              value={autoApproveConfidence}
              onChange={(v) => setAutoApproveConfidence(v)}
              style={{ width: 280 }}
              options={[
                { value: 'high', label: '仅高置信度（high）' },
                { value: 'medium', label: '中及以上（medium、high）' },
                { value: 'low', label: '低及以上（low、medium、high）' },
              ]}
            />
            <div style={{ color: 'var(--surface-muted-text)', fontSize: 12, marginTop: 4 }}>
              选择某一档时会包含更高置信度的建议，并自动为语录分配所有达标的分类
            </div>
          </div>
        )}
      </div>

      <Space wrap style={{ marginTop: 8 }}>
        <Button type="primary" onClick={handleSave} loading={saving}>保存 AI 设置</Button>
        <Button onClick={handleTest} loading={testing}>测试连接</Button>
      </Space>

      {testResult && (
        <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--surface-secondary, #f6f8fa)', border: '1px solid var(--border-light, #e0e0e0)', borderRadius: 6, fontSize: 13, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: '#52c41a', fontWeight: 500 }}>连接成功</span>
          <span style={{ color: 'var(--surface-muted-text)' }}>
            耗时 <strong style={{ color: 'var(--text-primary)' }}>{testResult.latency_ms} ms</strong>
          </span>
          <span style={{ color: 'var(--surface-muted-text)' }}>
            回复：<strong style={{ color: 'var(--text-primary)' }}>{testResult.reply}</strong>
          </span>
        </div>
      )}

      <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 32, paddingTop: 24 }}>
        <div style={{ fontWeight: 500, marginBottom: 12 }}>批量 AI 分类</div>
        <AIBatchPanel />
      </div>

      <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 32, paddingTop: 24 }}>
        <div style={{ fontWeight: 500, marginBottom: 8 }}>分类审核</div>
        <Button type="link" href="/admin/ai-changes" target="_blank" style={{ padding: 0 }}>
          前往 AI 分类审核页面
        </Button>
      </div>
    </Card>
  );
}