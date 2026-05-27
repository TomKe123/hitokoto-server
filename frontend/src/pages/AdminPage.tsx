import { useState, useEffect } from 'react';
import { Card, Typography, Button, Table, Tag, InputNumber, message, Upload, Tabs, Select, Popconfirm, Space } from 'antd';
import { PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import dayjs from 'dayjs';

const { Title } = Typography;

interface InviteCode {
  id: number;
  code: string;
  max_uses: number;
  use_count: number;
  created_by: number;
  created_at: string;
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

  const items = [
    { key: 'codes', label: '邀请码管理', children: <InviteCodePanel /> },
    ...(isAdmin ? [{ key: 'import', label: 'JSON 导入', children: <ImportPanel /> }] : []),
    { key: 'review', label: '语录审核', children: <QuoteReviewPanel /> },
    { key: 'users', label: '用户管理', children: <UserManagementPanel isAdmin={isAdmin} /> },
  ];

  return (
    <div>
      <Title level={3}>{isAdmin ? '管理后台' : '协作者面板'}</Title>
      <Tabs items={items} />
    </div>
  );
}

function InviteCodePanel() {
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState(5);
  const [maxUses, setMaxUses] = useState(1);

  const fetchCodes = () => {
    setLoading(true);
    api.get('/admin/invite-codes')
      .then((res) => setCodes(res.data.codes || []))
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchCodes(); }, []);

  const generate = async () => {
    try {
      const res = await api.post('/admin/invite-codes', { count, max_uses: maxUses });
      message.success(`生成了 ${res.data.codes.length} 个邀请码`);
      fetchCodes();
    } catch {
      message.error('生成失败');
    }
  };

  const columns = [
    { title: '邀请码', dataIndex: 'code', key: 'code',
      render: (code: string) => <Tag style={{ fontFamily: 'monospace', fontSize: 14 }}>{code}</Tag> },
    { title: '已用/最大', key: 'uses',
      render: (_: unknown, r: InviteCode) => `${r.use_count}/${r.max_uses}` },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at',
      render: (t: string) => dayjs(t).format('MM-DD HH:mm') },
  ];

  return (
    <Card>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>生成数量：</span>
        <InputNumber min={1} max={100} value={count} onChange={(v) => setCount(v || 1)} />
        <span>最大使用次数：</span>
        <InputNumber min={1} max={999} value={maxUses} onChange={(v) => setMaxUses(v || 1)} />
        <Button type="primary" icon={<PlusOutlined />} onClick={generate}>生成</Button>
      </div>
      <Table
        dataSource={codes}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 20 }}
      />
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

function QuoteReviewPanel() {
  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('pending');

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

  const handleReject = async (uuid: string) => {
    try {
      await api.put(`/quotes/${uuid}/reject`);
      message.success('已驳回');
      fetchQuotes();
    } catch {
      message.error('操作失败');
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
      <div style={{ marginBottom: 16 }}>
        <Select value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1); }}
          style={{ width: 120 }}>
          <Select.Option value="pending">待审核</Select.Option>
          <Select.Option value="approved">已通过</Select.Option>
          <Select.Option value="rejected">已驳回</Select.Option>
        </Select>
      </div>
      <Table
        dataSource={quotes}
        columns={columns}
        rowKey="uuid"
        loading={loading}
        pagination={{
          current: page,
          total,
          pageSize: 20,
          onChange: (p) => setPage(p),
          showTotal: (t) => `共 ${t} 条`,
        }}
        scroll={{ x: 1000 }}
      />
    </Card>
  );
}

function UserManagementPanel({ isAdmin }: { isAdmin: boolean }) {
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
      <div style={{ marginBottom: 16, display: 'flex', gap: 12 }}>
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
        }}
        scroll={{ x: 1000 }}
      />
    </Card>
  );
}
