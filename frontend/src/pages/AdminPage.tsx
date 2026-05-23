import { useState, useEffect } from 'react';
import { Card, Typography, Button, Table, Tag, InputNumber, message, Upload, Tabs } from 'antd';
import { PlusOutlined, UploadOutlined } from '@ant-design/icons';
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

export default function AdminPage() {
  return (
    <div>
      <Title level={3}>管理后台</Title>
      <Tabs
        items={[
          { key: 'codes', label: '邀请码管理', children: <InviteCodePanel /> },
          { key: 'import', label: 'JSON 导入', children: <ImportPanel /> },
        ]}
      />
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
      .then((res) => setCodes(res.data.codes))
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
    // Support both array and {data: [...]} format
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
