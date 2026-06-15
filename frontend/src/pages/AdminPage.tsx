import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Typography, Button, Table, Tag, InputNumber, Input, message, Upload, Tabs, Select, Popconfirm, Space, Grid, Switch, Modal, Form } from 'antd';
import { PlusOutlined, UploadOutlined, DeleteOutlined, EditOutlined, ExclamationCircleOutlined, ToolOutlined, UserAddOutlined, KeyOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import { useSiteConfig } from '../contexts/SiteConfigContext';
import api from '../utils/api';
import dayjs from 'dayjs';
import QuoteManagementPage from './QuoteManagementPage';

const { Title } = Typography;
const { useBreakpoint } = Grid;

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
  source: string;
  contributor_id: number;
  status: string;
  created_at: string;
}

export default function AdminPage() {
  const { user } = useAuth();
  const { section } = useParams<{ section?: string }>();
  const isAdmin = user?.role === 'admin';
  const perms = user?.permissions ?? 0;
  const hasCategoryPerm = isAdmin || (perms & 2) !== 0;
  const canReview = isAdmin || (perms & 1) !== 0;
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const navigate = useNavigate();

  // Determine available folders for permission-based redirect
  const availableSections: { key: string; label: string }[] = [
    ...(canReview ? [{ key: 'quotes', label: '语录管理' }] : []),
    ...(isAdmin ? [{ key: 'users', label: '用户管理' }] : []),
    ...(hasCategoryPerm ? [{ key: 'categories', label: '分类管理' }] : []),
    ...(isAdmin ? [{ key: 'settings', label: '系统设置' }] : []),
  ];

  // Redirect to first available section if none or invalid
  const validSection = section && availableSections.some((s) => s.key === section);
  useEffect(() => {
    if (!validSection && availableSections.length > 0) {
      navigate(`/admin/${availableSections[0].key}`, { replace: true });
    }
  }, [section, validSection]);

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
      {section === 'users' && <UsersSection isAdmin={isAdmin} isMobile={isMobile} />}
      {section === 'categories' && <CategoriesSection isMobile={isMobile} />}
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

function UsersSection({ isAdmin, isMobile }: { isAdmin: boolean; isMobile: boolean }) {
  const tabs = [
    { key: 'users', label: '用户列表', children: <UserManagementPanel isAdmin={isAdmin} isMobile={isMobile} /> },
    ...(isAdmin ? [{ key: 'codes', label: '邀请码管理', children: <InviteCodePanel isMobile={isMobile} /> }] : []),
  ];
  return <Tabs items={tabs} />;
}

function CategoriesSection({ isMobile }: { isMobile: boolean }) {
  return <CategoryManagementPanel isMobile={isMobile} />;
}

function SettingsSection({ isAdmin }: { isAdmin: boolean }) {
  const tabs = [
    { key: 'site', label: '站点设置', children: <SiteSettingsPanel /> },
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

  const fetchCodes = () => {
    setLoading(true);
    api.get('/admin/invite-codes')
      .then((res) => setCodes(res.data.codes || []))
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchCodes(); }, []);

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
    } catch (err: any) {
      if (err.errorFields) return;
      message.error(err.response?.data?.error || '更新失败');
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
    } catch (err: any) {
      if (err.errorFields) return;
      message.error(err.response?.data?.error || '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/admin/invite-codes/${id}`);
      message.success('已删除');
      fetchCodes();
    } catch (err: any) {
      message.error(err.response?.data?.error || '删除失败');
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
        : <span style={{ color: '#999' }}>永久</span> },
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
      message.error('未找到语录数组');
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

  const fetchQuotes = () => {
    setLoading(true);
    api.get('/quotes', { params: { page, page_size: 20, status: statusFilter } })
      .then((res) => {
        setQuotes(res.data.quotes || []);
        setTotal(res.data.total || 0);
      })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchQuotes(); }, [page, statusFilter]);

  const handleApprove = async (uuid: string) => {
    try {
      await api.put(`/quotes/${uuid}/approve`);
      message.success('已通过');
      fetchQuotes();
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
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
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    } finally {
      setRejecting(false);
    }
  };

  const openBatchReject = () => {
    setRejectTarget({ batch: true } as any);
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
    setBatchLoading(true);
    try {
      const res = await api.post('/admin/quotes/batch', {
        action,
        uuids: selectedRowKeys,
      });
      message.success('批量' + (action === 'approve' ? '通过' : '删除') + '完成：' + res.data.affected + ' 条');
      setSelectedRowKeys([]);
      fetchQuotes();
    } catch (err: any) {
      message.error(err.response?.data?.error || '批量操作失败');
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
    { title: '分类', dataIndex: 'category', key: 'category', width: 80,
      render: (c: string) => <Tag>{c}</Tag> },
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
          <span style={{ color: '#999', fontSize: 13 }}>
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

  const fetchQuotes = () => {
    setLoading(true);
    api.get('/quotes', { params: { page, page_size: 20, status: 'rejected' } })
      .then((res) => {
        setQuotes(res.data.quotes || []);
        setTotal(res.data.total || 0);
      })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchQuotes(); }, [page]);

  const handleReApprove = async (uuid: string) => {
    try {
      await api.put(`/quotes/${uuid}/approve`);
      message.success('已重新通过');
      fetchQuotes();
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    }
  };

  const handleDelete = async (uuid: string) => {
    try {
      await api.delete(`/quotes/${uuid}`);
      message.success('已删除');
      fetchQuotes();
    } catch (err: any) {
      message.error(err.response?.data?.error || '删除失败');
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
    } catch (err: any) {
      message.error(err.response?.data?.error || '批量操作失败');
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
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    } finally {
      setBatchLoading(false);
    }
  };

  const columns = [
    { title: '内容', dataIndex: 'content', key: 'content', width: 300,
      render: (c: string) => <span>{c.length > 50 ? c.slice(0, 50) + '...' : c}</span> },
    { title: '出自', dataIndex: 'from', key: 'from', width: 120 },
    { title: '分类', dataIndex: 'category', key: 'category', width: 80,
      render: (c: string) => <Tag>{c}</Tag> },
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

function UserManagementPanel({ isAdmin, isMobile }: { isAdmin: boolean; isMobile: boolean }) {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [permModalUser, setPermModalUser] = useState<UserItem | null>(null);
  const [permValues, setPermValues] = useState({ review: false, category: false, delete_quote: false, upload: false });
  const [permSaving, setPermSaving] = useState(false);
  const [addUserModalOpen, setAddUserModalOpen] = useState(false);
  const [addUserLoading, setAddUserLoading] = useState(false);
  const [addUserForm] = Form.useForm();
  const [resetPwdResult, setResetPwdResult] = useState<{ username: string; password: string } | null>(null);

  const fetchUsers = () => {
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
  };

  useEffect(() => { fetchUsers(); }, [page, roleFilter, statusFilter]);

  const handleBan = async (id: number) => {
    try {
      await api.put(`/admin/users/${id}/ban`);
      message.success('已封禁');
      fetchUsers();
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    }
  };

  const handleUnban = async (id: number) => {
    try {
      await api.put(`/admin/users/${id}/unban`);
      message.success('已解封');
      fetchUsers();
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    }
  };

  const openPermModal = (user: UserItem) => {
    const perms = user.permissions ?? 0;
    setPermValues({
      review: (perms & 1) !== 0,
      category: (perms & 2) !== 0,
      delete_quote: (perms & 4) !== 0,
      upload: (perms & 8) !== 0,
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
    setPermSaving(true);
    try {
      await api.put(`/admin/users/${permModalUser.id}/permissions`, { permissions: perms });
      message.success('权限已更新');
      setPermModalUser(null);
      fetchUsers();
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    } finally {
      setPermSaving(false);
    }
  };

  const permLabels: Record<string, string> = {
    review: '审核',
    category: '分类管理',
    delete_quote: '删除语录',
    upload: '上传',
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
    } catch (err: any) {
      if (err.errorFields) return;
      message.error(err.response?.data?.error || '创建失败');
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
    } catch (err: any) {
      message.error(err.response?.data?.error || '重置失败');
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
            {perms === 0 && <span style={{ color: '#999' }}>-</span>}
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
            <Popconfirm title="确定封禁该用户？" onConfirm={() => handleBan(r.id)}>
              <Button size="small" danger>封禁</Button>
            </Popconfirm>
          )}
          {isAdmin && r.role !== 'admin' && (
            <Button size="small" onClick={() => openPermModal(r)}>权限</Button>
          )}
          {isAdmin && (
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
          {(['review', 'category', 'delete_quote', 'upload'] as const).map((key) => (
            <div key={key} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 0', borderBottom: '1px solid #f0f0f0',
            }}>
              <span>{permLabels[key]}</span>
              <Switch
                checked={permValues[key]}
                onChange={(checked) => setPermValues({ ...permValues, [key]: checked })}
              />
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
          <Form.Item name="username" label="用户名" rules={[{ required: true, min: 3, max: 50, message: '请输入用户名（3-50 字符）' }]}>
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
              background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 6,
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

  const fetchCategories = () => {
    setLoading(true);
    api.get('/categories')
      .then((res) => setCategories(res.data.categories || []))
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchCategories(); }, []);

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
    } catch (err: any) {
      if (err.errorFields) return;
      message.error(err.response?.data?.error || '创建失败');
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
    } catch (err: any) {
      if (err.errorFields) return;
      message.error(err.response?.data?.error || '更新失败');
    } finally {
      setEditLoading(false);
    }
  };

  const handleDelete = async (cat: CategoryItem) => {
    try {
      await api.delete(`/admin/categories/${cat.id}`);
      message.success('分类已删除，相关语录已设为「其他」');
      fetchCategories();
    } catch (err: any) {
      message.error(err.response?.data?.error || '删除失败');
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
      render: (d: string) => d || <span style={{ color: '#ccc' }}>-</span> },
    { title: '语录数', dataIndex: 'count', key: 'count', width: 100 },
    { title: '操作', key: 'action', width: 160,
      render: (_: unknown, r: CategoryItem) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>重命名</Button>
          <Popconfirm
            title={`确定删除分类「${r.name}」？`}
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
    } catch (err: any) {
      message.error(err.response?.data?.error || '设置失败');
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
    } catch (err: any) {
      message.error(err.response?.data?.error || '保存失败');
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
    } catch (err: any) {
      message.error(err.response?.data?.error || '重置失败');
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
    } catch (err: any) {
      message.error(err.response?.data?.error || '修复失败');
    } finally {
      setRepairing(false);
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 500, marginBottom: 4 }}>匿名上传</div>
          <div style={{ color: '#999', fontSize: 13 }}>
            开启后，未登录用户可以通过邀请码提交语录
          </div>
        </div>
        <Switch checked={anonUpload} onChange={toggle} loading={loading} />
      </div>

      <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 24, paddingTop: 24 }}>
        <div style={{ fontWeight: 500, marginBottom: 4 }}>API 地址</div>
        <div style={{ color: '#999', fontSize: 13, marginBottom: 12 }}>
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
        <div style={{ color: '#999', fontSize: 13, marginBottom: 12 }}>
          检查并修复用户权限等数据不一致问题
        </div>
        <Button icon={<ToolOutlined />} onClick={handleRepair} loading={repairing}>
          修复数据库
        </Button>
      </div>

      <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 24, paddingTop: 24 }}>
        <div style={{ fontWeight: 500, marginBottom: 4 }}>重置服务器</div>
        <div style={{ color: '#999', fontSize: 13, marginBottom: 12 }}>
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
          <div style={{ background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 6, padding: 12, marginBottom: 16 }}>
            <ExclamationCircleOutlined style={{ color: '#ff4d4f', marginRight: 8 }} />
            重置后需要重新设置管理员，所有 JWT 令牌将失效
          </div>
          <Space align="start">
            <Switch checked={keepData} onChange={setKeepData} />
            <div>
              <div style={{ fontWeight: 500 }}>保留已有数据</div>
              <div style={{ color: '#999', fontSize: 13 }}>勾选后语录、用户等数据不会删除，仅重新触发初始化流程</div>
            </div>
          </Space>
        </div>
      </Modal>
    </Card>
  );
}
