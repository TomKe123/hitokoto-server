import { useState, useRef } from 'react';
import { Modal, Form, Select, message, Typography, Space, Input } from 'antd';
import api from '../utils/api';

const { Text } = Typography;

interface UserOption {
  id: number;
  username: string;
}

interface InviteModalProps {
  open: boolean;
  orgId: string;
  onClose: () => void;
  onCreated: () => void;
}

export default function InviteModal({ open, orgId, onClose, onCreated }: InviteModalProps) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [searching, setSearching] = useState(false);
  const fetchIdRef = useRef(0);
  const [mode, setMode] = useState<'search' | 'uid'>('search');
  const [directUid, setDirectUid] = useState<string>('');

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

  const handleInvite = async () => {
    let userId: number;
    if (mode === 'search') {
      const values = await form.validateFields();
      userId = values.user_id;
    } else {
      const uid = parseInt(directUid, 10);
      if (isNaN(uid) || uid <= 0) {
        message.error('请输入有效的用户ID');
        return;
      }
      userId = uid;
    }

    setSubmitting(true);
    try {
      await api.post(`/organizations/${orgId}/members`, {
        user_id: userId,
      });
      message.success('已成功添加为成员');
      form.resetFields();
      setUsers([]);
      setDirectUid('');
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
    setDirectUid('');
    onClose();
  };

  const onOk = () => {
    handleInvite();
  };

  return (
    <Modal
      title="邀请成员"
      open={open}
      onCancel={handleClose}
      onOk={onOk}
      confirmLoading={submitting}
      okText="邀请"
    >
      <div style={{ marginBottom: 16 }}>
        <Select
          value={mode}
          onChange={(v) => { setMode(v); form.resetFields(); setDirectUid(''); }}
          style={{ width: '100%' }}
          options={[
            { value: 'search', label: '按用户名搜索' },
            { value: 'uid', label: '按用户ID添加' },
          ]}
        />
      </div>

      {mode === 'search' ? (
        <Form form={form} layout="vertical">
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
        </Form>
      ) : (
        <div>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            输入用户的数字ID，直接将其加入组织
          </Text>
          <Input
            placeholder="输入用户ID"
            type="number"
            value={directUid}
            onChange={(e) => setDirectUid(e.target.value)}
            min={1}
          />
        </div>
      )}

      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 16 }}>
        {mode === 'search' ? '选择用户后直接加入组织（无需对方同意）' : '输入用户ID后直接加入组织'}
      </Text>
    </Modal>
  );
}
