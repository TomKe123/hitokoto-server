import { useState, useEffect } from 'react';
import { Card, Typography, Button, Table, Tag, InputNumber, Input, message, Upload, Tabs, Select, Popconfirm, Space, Grid, Switch, Modal, Form } from 'antd';
import { PlusOutlined, UploadOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import { useSiteConfig } from '../contexts/SiteConfigContext';
import api from '../utils/api';
import dayjs from 'dayjs';

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
  const isAdmin = user?.role === 'admin';
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const items = [
    { key: 'codes', label: '邀请码管理', children: <InviteCodePanel isMobile={isMobile} /> },
    ...(isAdmin ? [{ key: 'import', label: 'JSON 导入', children: <ImportPanel /> }] : []),
    { key: 'review', label: '语录审核', children: <QuoteReviewPanel isAdmin={isAdmin} isMobile={isMobile} /> },
    { key: 'rejected', label: '驳回管理', children: <RejectedQuotesPanel isAdmin={isAdmin} isMobile={isMobile} /> },
    { key: 'users', label: '用户管理', children: <UserManagementPanel isAdmin={isAdmin} isMobile={isMobile} /> },
    ...(isAdmin ? [{ key: 'settings', label: '站点设置', children: <SiteSettingsPanel /> }] : []),
  ];

  return (
    <div>
      <Title level={isMobile ? 4 : 3}>{isAdmin ? '管理后台' : '协作者面板'}</Title>
      <Tabs items={items} />
    </div>
  );
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

function QuoteReviewPanel({ isAdmin, isMobile }: { isAdmin: boolean; isMobile: boolean }) {
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
    } catch {
      message.error('操作失败');
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
    } catch {
      message.error('操作失败');
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

  const columns = [
    { title: '内容', dataIndex: 'content', key: 'content', width: 300,
      render: (c: string) => <span>{c.length > 50 ? c.slice(0, 50) + '...' : c}</span> },
    { title: '出自', dataIndex: 'from', key: 'from', width: 120 },
    { title: '分类', dataIndex: 'category', key: 'category', width: 80,
      render: (c: string) => <Tag>{c}</Tag> },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (s: string) => <Tag color={statusColors[s]}>{s}</Tag> },
    { title: '贡献者', dataIndex: 'contributor_id', key: 'contributor_id', width: 80 },
    { title: '提交时间', dataIndex: 'created_at', key: 'created_at', width: 140,
      render: (t: string) => dayjs(t).format('MM-DD HH:mm') },
    { title: '操作', key: 'action', width: 160,
      render: (_: unknown, r: QuoteItem) => (
        <Space>
          <Button size="small" type="primary" onClick={() => handleApprove(r.uuid)}
            disabled={r.status === 'approved'}>通过</Button>
          <Button size="small" danger onClick={() => handleReject(r.uuid)}
            disabled={r.status === 'rejected'}>驳回</Button>
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
        scroll={{ x: 1000 }}
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

function RejectedQuotesPanel({ isAdmin, isMobile }: { isAdmin: boolean; isMobile: boolean }) {
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
    } catch {
      message.error('操作失败');
    }
  };

  const handleDelete = async (uuid: string) => {
    try {
      await api.delete(`/quotes/${uuid}`);
      message.success('已删除');
      fetchQuotes();
    } catch {
      message.error('删除失败');
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
          <Button size="small" type="primary" onClick={() => handleReApprove(r.uuid)}>重新通过</Button>
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
        scroll={{ x: 1000 }}
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
    } catch {
      message.error('操作失败');
    }
  };

  const handleSetRole = async (id: number, role: string) => {
    try {
      await api.put(`/admin/users/${id}/role`, { role });
      message.success('角色已更新');
      fetchUsers();
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 100 },
    { title: '用户名', dataIndex: 'username', key: 'username', width: 120 },
    { title: '邮箱', dataIndex: 'email', key: 'email', width: 180 },
    { title: '角色', dataIndex: 'role', key: 'role', width: 100,
      render: (r: string) => {
        const colors: Record<string, string> = { admin: 'red', collaborator: 'blue', user: 'default' };
        return <Tag color={colors[r] || 'default'}>{r}</Tag>;
      } },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (s: string) => <Tag color={s === 'banned' ? 'red' : 'green'}>{s}</Tag> },
    { title: '注册时间', dataIndex: 'created_at', key: 'created_at', width: 140,
      render: (t: string) => dayjs(t).format('MM-DD HH:mm') },
    { title: '操作', key: 'action', width: 240,
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
            <Button size="small" onClick={() => handleSetRole(r.id, r.role === 'collaborator' ? 'user' : 'collaborator')}>
              {r.role === 'collaborator' ? '降级' : '晋升'}
            </Button>
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
          <Select.Option value="collaborator">协作者</Select.Option>
          <Select.Option value="user">用户</Select.Option>
        </Select>
        <Select placeholder="状态筛选" allowClear value={statusFilter || undefined}
          onChange={(v) => { setStatusFilter(v || ''); setPage(1); }} style={{ width: 120 }}>
          <Select.Option value="active">正常</Select.Option>
          <Select.Option value="banned">已封禁</Select.Option>
        </Select>
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
    </Card>
  );
}

function SiteSettingsPanel() {
  const [anonUpload, setAnonUpload] = useState(false);
  const [loading, setLoading] = useState(false);
  const { refresh } = useSiteConfig();

  useEffect(() => {
    api.get('/admin/settings')
      .then((res) => setAnonUpload(res.data.settings?.anonymous_upload !== 'false'))
      .catch(() => {});
  }, []);

  const toggle = async (checked: boolean) => {
    setLoading(true);
    try {
      await api.put('/admin/settings', { key: 'anonymous_upload', value: String(checked) });
      setAnonUpload(checked);
      refresh();
      message.success(checked ? '匿名上传已开启' : '匿名上传已关闭');
    } catch {
      message.error('设置失败');
    } finally {
      setLoading(false);
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
    </Card>
  );
}
