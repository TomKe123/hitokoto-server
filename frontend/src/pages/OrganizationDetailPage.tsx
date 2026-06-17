import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card, Typography, Spin, Tabs, Button, Space, Tag, message, Popconfirm, Modal,
  Input, Form, Select, List, Empty,
} from 'antd';
import {
  EditOutlined, DeleteOutlined, TeamOutlined, PlusOutlined, ArrowLeftOutlined,
  OrderedListOutlined,
} from '@ant-design/icons';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import MemberList from '../components/MemberList';
import InviteModal from '../components/InviteModal';

const { Title, Text } = Typography;

interface Organization {
  id: number;
  name: string;
  description: string;
  owner_id: number;
  created_at: string;
}

interface Member {
  id: number;
  user_id: number;
  username: string;
  role: string;
  created_at: string;
}

interface OrgList {
  id: number;
  uuid: string;
  name: string;
  description: string;
  is_public: boolean;
  share_type: string;
  item_count: number;
  user_id: number;
  created_at: string;
}

const shareTypeLabels: Record<string, { label: string; color: string }> = {
  public: { label: '公开', color: 'blue' },
  organization_private: { label: '组织内可见', color: 'purple' },
  organization_public: { label: '组织公开', color: 'cyan' },
  none: { label: '不共享', color: 'default' },
};

export default function OrganizationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState<number | null>(null);
  const [transferring, setTransferring] = useState(false);

  // Org lists tab
  const [orgLists, setOrgLists] = useState<OrgList[]>([]);
  const [listsLoading, setListsLoading] = useState(false);

  const fetchOrg = async () => {
    try {
      const res = await api.get(`/organizations/${id}`);
      setOrg(res.data.organization);
    } catch (err: any) {
      message.error('加载组织失败');
      navigate('/organizations');
    }
  };

  const fetchMembers = async () => {
    try {
      const res = await api.get(`/organizations/${id}/members`);
      setMembers(res.data.members || []);
    } catch {
      // ignore
    }
  };

  const fetchOrgLists = async () => {
    setListsLoading(true);
    try {
      const res = await api.get(`/organizations/${id}/lists`);
      setOrgLists(res.data.lists || []);
    } catch {
      // ignore
    } finally {
      setListsLoading(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([fetchOrg(), fetchMembers()]).finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 0' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!org) return null;

  const currentMember = members.find((m) => m.user_id === user?.id);
  const currentRole = currentMember?.role || '';
  const isOwner = currentRole === 'owner';
  const isAdmin = currentRole === 'owner' || currentRole === 'admin';
  const isGlobalAdmin = ((user?.permissions ?? 0) & 32) !== 0;
  const isSystemAdmin = user?.role === 'admin';

  const handleDelete = async () => {
    try {
      await api.delete(`/organizations/${org.id}`);
      message.success('组织已删除');
      navigate('/organizations');
    } catch (err: any) {
      message.error(err.response?.data?.error || '删除失败');
    }
  };

  const handleEdit = async (values: any) => {
    setSubmitting(true);
    try {
      const body: any = {};
      if (values.name !== org.name) body.name = values.name;
      if (values.description !== org.description) body.description = values.description;
      await api.put(`/organizations/${org.id}`, body);
      message.success('组织已更新');
      setEditModalOpen(false);
      fetchOrg();
    } catch (err: any) {
      message.error(err.response?.data?.error || '更新失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTransfer = async () => {
    if (!transferTarget) return;
    setTransferring(true);
    try {
      await api.post(`/organizations/${org.id}/transfer`, { new_owner_id: transferTarget });
      message.success('所有权已转让');
      setTransferOpen(false);
      setTransferTarget(null);
      fetchOrg();
      fetchMembers();
    } catch (err: any) {
      message.error(err.response?.data?.error || '转让失败');
    } finally {
      setTransferring(false);
    }
  };

  const nonOwnerMembers = members.filter((m) => m.role !== 'owner');

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/organizations')}>返回</Button>
      </Space>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <Title level={3} style={{ margin: 0 }}>
              {org.name}
              {isOwner && <Tag color="gold" style={{ marginLeft: 8 }}>拥有者</Tag>}
              {currentRole === 'admin' && <Tag color="blue" style={{ marginLeft: 8 }}>管理员</Tag>}
              {isGlobalAdmin && !isOwner && currentRole !== 'admin' && <Tag color="red" style={{ marginLeft: 8 }}>全局管理员</Tag>}
            </Title>
            <Text type="secondary">{org.description || '暂无描述'}</Text>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 13 }}>
                <TeamOutlined /> {members.length} 位成员
              </Text>
            </div>
          </div>
          <Space>
            {(isAdmin || isGlobalAdmin || isSystemAdmin) && (
              <>
                <Button icon={<PlusOutlined />} onClick={() => setInviteModalOpen(true)}>
                  邀请成员
                </Button>
                {(isOwner || isGlobalAdmin || isSystemAdmin) && (
                  <>
                    <Button icon={<EditOutlined />} onClick={() => {
                      editForm.setFieldsValue({ name: org.name, description: org.description });
                      setEditModalOpen(true);
                    }}>
                      编辑
                    </Button>
                    <Popconfirm title="确定删除此组织？此操作不可撤销。" onConfirm={handleDelete}>
                      <Button danger icon={<DeleteOutlined />}>删除</Button>
                    </Popconfirm>
                  </>
                )}
              </>
            )}
          </Space>
        </div>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <Tabs
          defaultActiveKey="members"
          items={[
            {
              key: 'members',
              label: `成员 (${members.length})`,
              children: (
                <MemberList
                  members={members}
                  orgId={org.id}
                  currentUserId={user?.id ?? 0}
                  currentUserRole={currentRole}
                  isGlobalAdmin={isGlobalAdmin || isSystemAdmin}
                  onRefresh={fetchMembers}
                />
              ),
            },
            {
              key: 'lists',
              label: `共享列表 (${orgLists.length})`,
              children: (
                <Spin spinning={listsLoading}>
                  {orgLists.length === 0 ? (
                    <Empty description="暂无共享列表" />
                  ) : (
                    <List
                      dataSource={orgLists}
                      renderItem={(list) => {
                        const st = shareTypeLabels[list.share_type] || { label: list.share_type, color: 'default' };
                        return (
                          <List.Item
                            actions={[
                              <Button size="small" onClick={() => navigate(`/lists/${list.uuid}`)}>
                                查看
                              </Button>,
                            ]}
                          >
                            <List.Item.Meta
                              avatar={<OrderedListOutlined style={{ fontSize: 18, color: '#863bff' }} />}
                              title={
                                <Space>
                                  {list.name}
                                  <Tag color={st.color}>{st.label}</Tag>
                                  {list.is_public && <Tag color="blue">全局公开</Tag>}
                                </Space>
                              }
                              description={
                                <Text type="secondary">{list.description || '暂无描述'} · {list.item_count} 条语录</Text>
                              }
                            />
                          </List.Item>
                        );
                      }}
                    />
                  )}
                </Spin>
              ),
            },
            {
              key: 'settings',
              label: '设置',
              children: (isOwner || isGlobalAdmin || isSystemAdmin) ? (
                <div>
                  <Title level={5}>转让所有权</Title>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                    将组织所有权转让给其他成员，你将自动降级为普通成员。
                  </Text>
                  {nonOwnerMembers.length === 0 ? (
                    <Text type="warning">没有可转让的成员，请先邀请其他成员加入。</Text>
                  ) : (
                    <Space>
                      <Select
                        style={{ width: 240 }}
                        placeholder="选择新拥有者"
                        value={transferTarget}
                        onChange={setTransferTarget}
                        options={nonOwnerMembers.map((m) => ({
                          value: m.user_id,
                          label: m.username || `用户 #${m.user_id}`,
                        }))}
                      />
                      <Button
                        type="primary"
                        disabled={!transferTarget}
                        onClick={() => setTransferOpen(true)}
                      >
                        转让所有权
                      </Button>
                    </Space>
                  )}
                  <Modal
                    title="确认转让"
                    open={transferOpen}
                    onOk={handleTransfer}
                    onCancel={() => { setTransferOpen(false); setTransferTarget(null); }}
                    confirmLoading={transferring}
                  >
                    <Text>
                      确定将 <Text strong>{org.name}</Text> 的所有权转让给此用户？你将自动降级为普通成员，此操作不可撤销。
                    </Text>
                  </Modal>
                </div>
              ) : (
                <Text type="secondary">需要拥有者权限才能管理组织设置</Text>
              ),
            },
          ]}
          onChange={(key) => { if (key === 'lists') fetchOrgLists(); }}
        />
      </Card>

      <InviteModal
        open={inviteModalOpen}
        orgId={org.id}
        onClose={() => setInviteModalOpen(false)}
        onCreated={fetchMembers}
      />

      <Modal
        title="编辑组织"
        open={editModalOpen}
        onCancel={() => setEditModalOpen(false)}
        onOk={() => editForm.submit()}
        confirmLoading={submitting}
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={handleEdit}
          initialValues={{ name: org.name, description: org.description }}
        >
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入组织名称' }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
