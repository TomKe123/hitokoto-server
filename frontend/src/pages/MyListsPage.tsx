import { useState, useEffect } from 'react';
import {
  Card, Row, Col, Button, Tag, Typography, Empty, Spin, Modal, message, Popconfirm, Space, Input, Switch, Form, Select,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, KeyOutlined, UnlockOutlined, LockOutlined,
  FolderAddOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';

const { Title, Text } = Typography;

interface QuoteList {
  id: number;
  uuid: string;
  name: string;
  description: string;
  is_public: boolean;
  item_count: number;
  type: string;
  reference_count: number;
  created_at: string;
  updated_at: string;
}

export default function MyListsPage() {
  const [lists, setLists] = useState<QuoteList[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingList, setEditingList] = useState<QuoteList | null>(null);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [apiKeyText, setApiKeyText] = useState('');
  const navigate = useNavigate();

  const fetchLists = () => {
    setLoading(true);
    api.get('/lists')
      .then((res) => setLists(res.data.lists || []))
      .catch(() => message.error('加载列表失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchLists(); }, []);

  const handleCreate = async (values: any) => {
    setSubmitting(true);
    try {
      const res = await api.post('/lists', {
        name: values.name,
        description: values.description || '',
        is_public: values.is_public !== false,
        type: values.type || 'normal',
      });
      setCreateModalOpen(false);
      form.resetFields();
      message.success('列表创建成功');
      if (!values.is_public && res.data.api_key) {
        setApiKeyText(res.data.api_key);
        setApiKeyModalOpen(true);
      }
      fetchLists();
    } catch (err: any) {
      message.error(err.response?.data?.error || '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (values: any) => {
    if (!editingList) return;
    setSubmitting(true);
    try {
      const body: any = {};
      if (values.name !== editingList.name) body.name = values.name;
      if (values.description !== editingList.description) body.description = values.description;
      if (values.is_public !== editingList.is_public) body.is_public = values.is_public;

      const res = await api.put(`/lists/${editingList.id}`, body);
      setEditModalOpen(false);
      setEditingList(null);
      form.resetFields();
      message.success('列表已更新');
      if (values.is_public === false && editingList.is_public && res.data.api_key) {
        setApiKeyText(res.data.api_key);
        setApiKeyModalOpen(true);
      }
      fetchLists();
    } catch (err: any) {
      message.error(err.response?.data?.error || '更新失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/lists/${id}`);
      message.success('列表已删除');
      fetchLists();
    } catch (err: any) {
      message.error(err.response?.data?.error || '删除失败');
    }
  };

  const handleRegenerateKey = async (id: number) => {
    try {
      const res = await api.post(`/lists/${id}/regenerate-key`);
      setApiKeyText(res.data.api_key);
      setApiKeyModalOpen(true);
    } catch (err: any) {
      message.error(err.response?.data?.error || '重新生成失败');
    }
  };

  const copyApiKey = () => {
    navigator.clipboard.writeText(apiKeyText);
    message.success('API Key 已复制');
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>我的列表</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
          创建列表
        </Button>
      </div>

      {lists.length === 0 ? (
        <Empty description="暂无列表，点击右上角创建你的第一个列表" />
      ) : (
        <Row gutter={[16, 16]}>
          {lists.map((list) => (
            <Col xs={24} sm={12} lg={8} key={list.id}>
              <Card
                hoverable
                onClick={() => navigate(`/lists/${list.id}`)}
                actions={[
                  <EditOutlined key="edit" onClick={(e) => {
                    e.stopPropagation();
                    setEditingList(list);
                    form.setFieldsValue(list);
                    setEditModalOpen(true);
                  }} />,
                  <Popconfirm key="delete" title="确定删除此列表？此操作不可撤销。" onConfirm={() => handleDelete(list.id)}>
                    <DeleteOutlined onClick={(e) => e.stopPropagation()} />
                  </Popconfirm>,
                  ...(!list.is_public ? [
                    <KeyOutlined key="key" onClick={(e) => {
                      e.stopPropagation();
                      handleRegenerateKey(list.id);
                    }} />,
                  ] : []),
                ]}
              >
                <Card.Meta
                  title={
                    <Space>
                      {list.name}
                      <Tag icon={list.is_public ? <UnlockOutlined /> : <LockOutlined />} color={list.is_public ? 'blue' : 'orange'}>
                        {list.is_public ? '公开' : '私有'}
                      </Tag>
                      {list.type === 'aggregated' && (
                        <Tag icon={<FolderAddOutlined />} color="purple">汇聚</Tag>
                      )}
                    </Space>
                  }
                  description={
                    <div>
                      <Text type="secondary" style={{ fontSize: 13 }}>
                        {list.description || '暂无描述'}
                      </Text>
                      <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
                        {list.type === 'aggregated'
                          ? `${list.reference_count} 个引用列表`
                          : `${list.item_count} 条语录`
                        }
                      </div>
                    </div>
                  }
                />
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {/* Create Modal */}
      <Modal
        title="创建列表"
        open={createModalOpen}
        onCancel={() => { setCreateModalOpen(false); form.resetFields(); }}
        footer={null}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleCreate} initialValues={{ is_public: true }}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入列表名称' }]}>
            <Input placeholder="例如：我喜爱的动漫台词" maxLength={255} />
          </Form.Item>
          <Form.Item name="type" label="类型" initialValue="normal">
            <Select>
              <Select.Option value="normal">普通列表</Select.Option>
              <Select.Option value="aggregated">汇聚列表（引用其他列表）</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="可选的描述信息" maxLength={1000} />
          </Form.Item>
          <Form.Item name="is_public" label="可见性" valuePropName="checked">
            <Switch checkedChildren={<UnlockOutlined />} unCheckedChildren={<LockOutlined />} />
          </Form.Item>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 16 }}>
            {form.getFieldValue('is_public') !== false
              ? '公开列表：任何人可以看到此列表的内容'
              : '私有列表：需要 API Key 才能访问'}
          </Text>
          <div style={{ textAlign: 'right' }}>
            <Button onClick={() => { setCreateModalOpen(false); form.resetFields(); }} style={{ marginRight: 8 }}>取消</Button>
            <Button type="primary" htmlType="submit" loading={submitting}>创建</Button>
          </div>
        </Form>
      </Modal>

      {/* Edit Modal */}
      <Modal
        title="编辑列表"
        open={editModalOpen}
        onCancel={() => { setEditModalOpen(false); setEditingList(null); form.resetFields(); }}
        footer={null}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleEdit} initialValues={{ is_public: true }}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入列表名称' }]}>
            <Input maxLength={255} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} maxLength={1000} />
          </Form.Item>
          <Form.Item name="is_public" label="可见性" valuePropName="checked">
            <Switch checkedChildren={<UnlockOutlined />} unCheckedChildren={<LockOutlined />} />
          </Form.Item>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 16 }}>
            {form.getFieldValue('is_public') !== false
              ? '公开列表：任何人可以看到此列表的内容'
              : '私有列表：切换后系统将生成新的 API Key'}
          </Text>
          <div style={{ textAlign: 'right' }}>
            <Button onClick={() => { setEditModalOpen(false); setEditingList(null); form.resetFields(); }} style={{ marginRight: 8 }}>取消</Button>
            <Button type="primary" htmlType="submit" loading={submitting}>保存</Button>
          </div>
        </Form>
      </Modal>

      {/* API Key Modal */}
      <Modal
        title="API Key"
        open={apiKeyModalOpen}
        onCancel={() => { setApiKeyModalOpen(false); setApiKeyText(''); }}
        footer={
          <Space>
            <Button onClick={() => { setApiKeyModalOpen(false); setApiKeyText(''); }}>关闭</Button>
            <Button type="primary" onClick={copyApiKey}>复制 Key</Button>
          </Space>
        }
      >
        <div style={{ marginBottom: 12 }}>
          <Text type="warning" strong>
            ⚠️ 此 API Key 仅在此刻显示一次，请立即保存！
          </Text>
        </div>
        <Input.TextArea
          value={apiKeyText}
          readOnly
          rows={2}
          style={{ fontFamily: 'monospace', fontSize: 13 }}
          onClick={(e) => (e.target as HTMLTextAreaElement).select()}
        />
      </Modal>
    </div>
  );
}
