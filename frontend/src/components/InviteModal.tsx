import { useState, useRef } from 'react';
import { Modal, Form, Select, message, Button, Typography, Space } from 'antd';
import { UserAddOutlined } from '@ant-design/icons';
import api from '../utils/api';

const { Text } = Typography;

interface UserOption {
  id: number;
  username: string;
}

interface InviteModalProps {
  open: boolean;
  orgId: number;
  onClose: () => void;
  onCreated: () => void;
}

export default function InviteModal({ open, orgId, onClose, onCreated }: InviteModalProps) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [searching, setSearching] = useState(false);
  const fetchIdRef = useRef(0);

  const handleSearch = async (query: string) => {
    if (!query || query.length < 1) {
      setUsers([]);
      return;
    }

    const fetchId = ++fetchIdRef.current;
    setSearching(true);
    try {
      const res = await api.get('/users/search', { params: { q: query } });
      if (fetchId === fetchIdRef.current) {
        setUsers(res.data.users || []);
      }
    } catch {
      if (fetchId === fetchIdRef.current) {
        setUsers([]);
      }
    } finally {
      if (fetchId === fetchIdRef.current) {
        setSearching(false);
      }
    }
  };

  const handleInvite = async (values: { user_id: number }) => {
    setSubmitting(true);
    try {
      await api.post(`/organizations/${orgId}/members`, {
        user_id: values.user_id,
      });
      message.success('已成功添加为成员');
      form.resetFields();
      setUsers([]);
      onCreated();
      onClose();
    } catch (err: unknown) {
      message.error(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error || '添加失败'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    form.resetFields();
    setUsers([]);
    onClose();
  };

  return (
    <Modal
      title="邀请成员"
      open={open}
      onCancel={handleClose}
      footer={null}
      destroyOnClose
    >
      <Form form={form} layout="vertical" onFinish={handleInvite}>
        <Form.Item name="user_id" label="选择用户" rules={[{ required: true, message: '请搜索并选择用户' }]}>
          <Select
            showSearch
            placeholder="输入用户名搜索"
            filterOption={false}
            onSearch={handleSearch}
            loading={searching}
            notFoundContent={searching ? '搜索中...' : '未找到用户'}
            style={{ width: '100%' }}
          >
            {users.map((u) => (
              <Select.Option key={u.id} value={u.id}>
                <Space>
                  <Text>{u.username}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>ID: {u.id}</Text>
                </Space>
              </Select.Option>
            ))}
          </Select>
        </Form.Item>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 16 }}>
          搜索用户名，选择后将直接将该用户加入组织（无需对方同意）。
        </Text>
        <div style={{ textAlign: 'right' }}>
          <Button onClick={handleClose} style={{ marginRight: 8 }}>取消</Button>
          <Button type="primary" icon={<UserAddOutlined />} htmlType="submit" loading={submitting}>
            邀请
          </Button>
        </div>
      </Form>
    </Modal>
  );
}
