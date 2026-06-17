import { useState, useEffect } from 'react';
import { Row, Col, Button, Typography, Modal, Form, Input, Spin, Empty, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import api from '../utils/api';
import OrganizationCard from '../components/OrganizationCard';

const { Title } = Typography;

interface Organization {
  id: number;
  name: string;
  description: string;
  owner_id: number;
  created_at: string;
}

export default function OrganizationPage() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const fetchOrgs = async () => {
    setLoading(true);
    try {
      const res = await api.get('/organizations/mine');
      setOrgs(res.data.organizations || []);
    } catch {
      message.error('加载组织列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchOrgs(); }, []);

  const handleCreate = async (values: any) => {
    setSubmitting(true);
    try {
      await api.post('/organizations', {
        name: values.name,
        description: values.description || '',
      });
      setCreateModalOpen(false);
      form.resetFields();
      message.success('组织创建成功');
      fetchOrgs();
    } catch (err: any) {
      message.error(err.response?.data?.error || '创建失败');
    } finally {
      setSubmitting(false);
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>我的组织</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
          创建组织
        </Button>
      </div>

      {orgs.length === 0 ? (
        <Empty description="暂无组织，点击右上角创建一个" />
      ) : (
        <Row gutter={[16, 16]}>
          {orgs.map((org) => (
            <Col xs={24} sm={12} lg={8} key={org.id}>
              <OrganizationCard
                id={org.id}
                name={org.name}
                description={org.description}
                memberCount={0}
              />
            </Col>
          ))}
        </Row>
      )}

      <Modal
        title="创建组织"
        open={createModalOpen}
        onCancel={() => { setCreateModalOpen(false); form.resetFields(); }}
        footer={null}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入组织名称' }, { min: 2, message: '至少2个字符' }]}>
            <Input placeholder="例如：动漫爱好者协会" maxLength={100} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="可选的描述信息" maxLength={500} />
          </Form.Item>
          <div style={{ textAlign: 'right' }}>
            <Button onClick={() => { setCreateModalOpen(false); form.resetFields(); }} style={{ marginRight: 8 }}>取消</Button>
            <Button type="primary" htmlType="submit" loading={submitting}>创建</Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
