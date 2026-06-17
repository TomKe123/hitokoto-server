import { Table, Tag, Button, Popconfirm, Select, Space, message, Typography } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import api from '../utils/api';

const { Text } = Typography;

interface Member {
  id: number;
  user_id: number;
  username: string;
  role: string;
  created_at: string;
}

interface MemberListProps {
  members: Member[];
  orgId: string;
  currentUserId: number;
  currentUserRole: string;
  isGlobalAdmin?: boolean;
  onRefresh: () => void;
}

const roleLabels: Record<string, { label: string; color: string }> = {
  owner: { label: '拥有者', color: 'gold' },
  admin: { label: '管理员', color: 'blue' },
  member: { label: '成员', color: 'default' },
};

export default function MemberList({ members, orgId, currentUserId, currentUserRole, isGlobalAdmin = false, onRefresh }: MemberListProps) {
  const canManage = currentUserRole === 'owner' || currentUserRole === 'admin' || isGlobalAdmin;

  const handleRemove = async (memberId: number) => {
    try {
      await api.delete(`/organizations/${orgId}/members/${memberId}`);
      message.success('成员已移除');
      onRefresh();
    } catch (err: any) {
      message.error(err.response?.data?.error || '移除失败');
    }
  };

  const handleChangeRole = async (memberId: number, role: string) => {
    try {
      await api.put(`/organizations/${orgId}/members/${memberId}/role`, { role });
      message.success('角色已更新');
      onRefresh();
    } catch (err: any) {
      message.error(err.response?.data?.error || '更新失败');
    }
  };

  const columns = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      render: (username: string, record: Member) => username || `用户 #${record.user_id}`,
    },
    {
      title: '用户 ID',
      dataIndex: 'user_id',
      key: 'user_id',
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      render: (role: string) => {
        const info = roleLabels[role] || { label: role, color: 'default' };
        return <Tag color={info.color}>{info.label}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, record: Member) => {
        // Owner cannot be managed
        if (record.role === 'owner') return <Text type="secondary">—</Text>;

        const isSelf = record.user_id === currentUserId;

        return (
          <Space>
            {canManage && record.role !== 'owner' && currentUserRole === 'owner' && (
              <Select
                size="small"
                value={record.role}
                style={{ width: 90 }}
                onChange={(role) => handleChangeRole(record.id, role)}
                options={[
                  { value: 'admin', label: '管理员' },
                  { value: 'member', label: '成员' },
                ]}
              />
            )}
            {canManage && !isSelf && record.role !== 'owner' && (
              <Popconfirm title="确定移除该成员？" onConfirm={() => handleRemove(record.id)}>
                <Button type="link" danger size="small" icon={<DeleteOutlined />} />
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <Table
      dataSource={members}
      columns={columns}
      rowKey="id"
      pagination={false}
      size="small"
    />
  );
}
