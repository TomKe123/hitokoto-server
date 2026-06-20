import { useState, useEffect } from 'react';
import { Modal, Select, Button, message, Space, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import api from '../utils/api';

interface QuoteList {
  id: number;
  uuid: string;
  name: string;
  description: string;
  is_public: boolean;
  item_count: number;
}

interface AddToListModalProps {
  open: boolean;
  quoteId: number;
  quoteUuid: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function AddToListModal({ open, quoteId, quoteUuid: _quoteUuid, onClose, onSuccess }: AddToListModalProps) {
  const [lists, setLists] = useState<QuoteList[]>([]);
  const [selectedListUuid, setSelectedListUuid] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedListUuid(null);
    setLoading(true);
    api.get('/lists')
      .then((res) => setLists(res.data.lists || []))
      .catch(() => message.error('加载列表失败'))
      .finally(() => setLoading(false));
  }, [open]);

  const handleAdd = async () => {
    if (!selectedListUuid) {
      message.warning('请选择一个列表');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post(`/lists/${selectedListUuid}/items`, {
        quote_ids: [quoteId],
      });
      const { added, duplicates } = res.data as { added: number; duplicates: number };
      if (added > 0) {
        message.success(`已添加到列表 (成功添加 ${added} 条)`);
      } else if (duplicates > 0) {
        message.info('该语录已在列表中');
      } else {
        message.warning('未能添加，请重试');
      }
      onSuccess?.();
      onClose();
    } catch (err) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      message.error(axiosErr.response?.data?.error || '添加失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="添加到列表"
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={submitting} onClick={handleAdd} icon={<PlusOutlined />}>
            添加
          </Button>
        </Space>
      }
      destroyOnClose
    >
      <div style={{ marginBottom: 8 }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>选择要将此语录添加到的列表：</span>
      </div>
      <Select
        style={{ width: '100%' }}
        placeholder="选择一个列表..."
        loading={loading}
        value={selectedListUuid}
        onChange={setSelectedListUuid}
        showSearch
        optionFilterProp="label"
      >
        {lists.map((l) => (
          <Select.Option key={l.uuid} value={l.uuid} label={l.name}>
            {l.name}
            <Tag color={l.is_public ? 'blue' : 'orange'} style={{ marginLeft: 8 }}>
              {l.is_public ? '公开' : '私有'}
            </Tag>
            <span style={{ color: 'var(--surface-muted-text)', fontSize: 12, marginLeft: 4 }}>
              ({l.item_count} 条)
            </span>
          </Select.Option>
        ))}
      </Select>
    </Modal>
  );
}
