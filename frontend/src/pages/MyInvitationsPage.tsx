import { useState, useEffect } from 'react';
import { Card, List, Button, Typography, Spin, Empty, message, Space, Tag, Popconfirm } from 'antd';
import { CheckOutlined, CloseOutlined, TeamOutlined } from '@ant-design/icons';
import api from '../utils/api';

const { Title, Text } = Typography;

interface PendingInvite {
  id: number;
  organization_id: number;
  organization_name: string;
  created_by: number;
  created_at: string;
}

export default function MyInvitationsPage() {
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInvites = async () => {
    setLoading(true);
    try {
      const res = await api.get('/invites/pending');
      setInvites(res.data.invitations || []);
    } catch {
      message.error('加载邀请失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchInvites(); }, []);

  const handleAccept = async (inviteId: number) => {
    try {
      await api.post(`/invites/${inviteId}/accept`);
      message.success('已加入组织');
      fetchInvites();
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    }
  };

  const handleDecline = async (inviteId: number) => {
    try {
      await api.post(`/invites/${inviteId}/decline`);
      message.success('已拒绝邀请');
      fetchInvites();
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 0' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div>
      <Title level={3} style={{ marginBottom: 24 }}>我的邀请</Title>

      {invites.length === 0 ? (
        <Empty description="暂无待处理的邀请" />
      ) : (
        <List
          dataSource={invites}
          renderItem={(item) => (
            <Card
              style={{ marginBottom: 12 }}
              key={item.id}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <Space>
                    <TeamOutlined style={{ fontSize: 18, color: '#863bff' }} />
                    <Text strong style={{ fontSize: 16 }}>{item.organization_name}</Text>
                    <Tag color="blue">待接受</Tag>
                  </Space>
                  <div style={{ marginTop: 4 }}>
                    <Text type="secondary" style={{ fontSize: 13 }}>
                      邀请时间：{new Date(item.created_at).toLocaleString()}
                    </Text>
                  </div>
                </div>
                <Space>
                  <Button
                    type="primary"
                    icon={<CheckOutlined />}
                    onClick={() => handleAccept(item.id)}
                  >
                    接受
                  </Button>
                  <Popconfirm title="确定拒绝此邀请？" onConfirm={() => handleDecline(item.id)}>
                    <Button icon={<CloseOutlined />}>拒绝</Button>
                  </Popconfirm>
                </Space>
              </div>
            </Card>
          )}
        />
      )}
    </div>
  );
}
