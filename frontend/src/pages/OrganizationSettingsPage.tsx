import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Typography, Spin, Button, Space, message, Popconfirm, Form, Input, Select } from 'antd';
import { ArrowLeftOutlined, DeleteOutlined } from '@ant-design/icons';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

const { Title, Text } = Typography;

interface Organization {
  id: number;
  uuid: string;
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
}

export default function OrganizationSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const fetchData = async () => {
    try {
      const [orgRes, membersRes] = await Promise.all([
        api.get(`/organizations/${id}`),
        api.get(`/organizations/${id}/members`),
      ]);
      setOrg(orgRes.data.organization);
      setMembers(membersRes.data.members || []);
      form.setFieldsValue({
        name: orgRes.data.organization.name,
        description: orgRes.data.organization.description,
      });
    } catch {
      message.error('加载组织失败');
      navigate('/organizations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (id) fetchData(); }, [id]);

  const handleUpdate = async (values: any) => {
    setSubmitting(true);
    try {
      await api.put(`/organizations/${id}`, {
        name: values.name,
        description: values.description,
      });
      message.success('组织已更新');
      fetchData();
    } catch (err: any) {
      message.error(err.response?.data?.error || '更新失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    try {
      await api.delete(`/organizations/${id}`);
      message.success('组织已删除');
      navigate('/organizations');
    } catch (err: any) {
      message.error(err.response?.data?.error || '删除失败');
    }
  };

  const handleTransfer = async (newOwnerId: number) => {
    try {
      await api.post(`/organizations/${id}/transfer`, { new_owner_id: newOwnerId });
      message.success('所有权已转让');
      fetchData();
    } catch (err: any) {
      message.error(err.response?.data?.error || '转让失败');
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 0' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!org) return null;

  const isOwner = user?.id === org.owner_id;

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/organizations/${id}`)}>返回</Button>
      </Space>

      <Title level={3}>组织设置</Title>

      <Card title="基本信息" style={{ marginBottom: 16 }}>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleUpdate}
          disabled={!isOwner}
        >
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入组织名称' }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
          {isOwner && (
            <Button type="primary" htmlType="submit" loading={submitting}>保存</Button>
          )}
        </Form>
      </Card>

      {isOwner && (
        <>
          <Card title="转让所有权" style={{ marginBottom: 16 }}>
            <Text type="secondary">将组织所有权转让给另一位成员</Text>
            <div style={{ marginTop: 12 }}>
              <Select
                style={{ width: 240 }}
                placeholder="选择新拥有者"
                onChange={handleTransfer}
                options={members
                  .filter((m) => m.user_id !== user?.id)
                  .map((m) => ({ value: m.user_id, label: m.username || `用户 #${m.user_id}` }))}
              />
            </div>
          </Card>

          <Card title="危险操作" style={{ marginBottom: 16 }}>
            <Text type="danger">删除组织将导致所有数据和成员关系丢失，此操作不可撤销。</Text>
            <div style={{ marginTop: 12 }}>
              <Popconfirm title="确定删除此组织？" onConfirm={handleDelete}>
                <Button danger icon={<DeleteOutlined />}>删除组织</Button>
              </Popconfirm>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
