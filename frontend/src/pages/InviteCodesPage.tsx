import { useState, useEffect } from 'react';
import { Typography, Button, Table, Modal, Input, message, Grid, Tooltip, Empty } from 'antd';
import { CopyOutlined, KeyOutlined } from '@ant-design/icons';
import api from '../utils/api';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

interface InviteCode {
  id: number;
  code: string;
  max_uses: number;
  use_count: number;
  created_at: string;
  expires_at?: string;
}

export default function InviteCodesPage() {
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [nextAllowedAt, setNextAllowedAt] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [customCode, setCustomCode] = useState('');
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const fetchCodes = () => {
    setLoading(true);
    api.get('/user/invite-codes', { params: { page, page_size: 20 } })
      .then((res) => {
        setCodes(res.data.codes || []);
        setTotal(res.data.total || 0);
        setNextAllowedAt(res.data.next_allowed_at || null);
      })
      .catch(() => message.error('加载邀请码失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchCodes();
  }, [page]);

  const handleGenerate = () => {
    setGenerating(true);
    const body: any = {};
    if (customCode.trim()) body.custom_code = customCode.trim();
    api.post('/user/invite-codes', body)
      .then(() => {
        message.success('邀请码生成成功');
        setModalOpen(false);
        setCustomCode('');
        setPage(1);
        fetchCodes();
      })
      .catch((err) => {
        message.error(err.response?.data?.error || '生成失败');
      })
      .finally(() => setGenerating(false));
  };

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      message.success('已复制');
    }).catch(() => {
      message.error('复制失败');
    });
  };

  const getCooldownText = () => {
    if (!nextAllowedAt) return '可生成';
    const diff = dayjs(nextAllowedAt).diff(dayjs());
    if (diff <= 0) return '可生成';
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    return `${hours}小时${minutes}分钟后`;
  };

  const canGenerate = !nextAllowedAt || dayjs(nextAllowedAt).diff(dayjs()) <= 0;

  const columns = [
    {
      title: '邀请码',
      dataIndex: 'code',
      key: 'code',
      render: (code: string) => (
        <span>
          <Text code style={{ fontSize: 13 }}>{code}</Text>
          <Tooltip title="复制">
            <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => copyToClipboard(code)} />
          </Tooltip>
        </span>
      ),
    },
    {
      title: '使用次数',
      dataIndex: 'use_count',
      key: 'use_count',
      width: 100,
      render: (use: number, record: InviteCode) => (
        <Text>{use}/{record.max_uses}</Text>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: isMobile ? 0 : 120,
      render: (t: string) => isMobile ? null : dayjs(t).format('MM-DD HH:mm'),
    },
    {
      title: '过期时间',
      dataIndex: 'expires_at',
      key: 'expires_at',
      width: isMobile ? 0 : 120,
      render: (t: string | undefined) => {
        if (isMobile) return null;
        return t ? dayjs(t).format('MM-DD HH:mm') : <Text type="secondary">永不过期</Text>;
      },
    },
  ];

  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          <KeyOutlined style={{ marginRight: 8 }} />
          邀请码
        </Title>
        <Button type="primary" disabled={!canGenerate} onClick={() => setModalOpen(true)}>
          生成邀请码
        </Button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Text strong>生成冷却：</Text>
        <Text type={canGenerate ? 'success' : 'secondary'}>{getCooldownText()}</Text>
        <Text type="secondary" style={{ marginLeft: 16, fontSize: 13 }}>
          每 72 小时可生成一个，每个最多使用 5 次
        </Text>
      </div>

      <Table
        dataSource={codes}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{
          current: page,
          total,
          pageSize: 20,
          onChange: setPage,
          showTotal: (t) => `共 ${t} 个`,
          size: isMobile ? 'small' : undefined,
          responsive: true,
        }}
        size="small"
        scroll={{ x: 500 }}
        locale={{ emptyText: <Empty description="暂无邀请码" /> }}
      />

      <Modal
        title="生成邀请码"
        open={modalOpen}
        onOk={handleGenerate}
        onCancel={() => { setModalOpen(false); setCustomCode(''); }}
        confirmLoading={generating}
        okText="生成"
        cancelText="取消"
      >
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary">每个邀请码最多可使用 5 次，每 72 小时可生成一个</Text>
        </div>
        <Input
          placeholder="自定义邀请码（可选，留空自动生成）"
          value={customCode}
          onChange={(e) => setCustomCode(e.target.value)}
        />
      </Modal>
    </div>
  );
}
