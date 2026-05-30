import { useState } from 'react';
import { Steps, Form, Input, Button, Alert, Typography, Card, Space, Spin } from 'antd';
import {
  UserOutlined,
  DownloadOutlined,
  CheckCircleOutlined,
  LockOutlined,
} from '@ant-design/icons';
import api from '../utils/api';

const { Title, Text } = Typography;

export default function SetupWizard() {
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  const handleCreateAdmin = async (values: { username: string; password: string }) => {
    setLoading(true);
    setError(null);
    try {
      await api.post('/setup/admin', values);
      setCurrent(1);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create admin');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    try {
      const res = await api.post('/setup/import');
      setImportResult(res.data.message || 'Import started');
      // Poll for completion or just mark done after a short delay
      // The import runs in background, so we wait briefly then let user proceed
      await new Promise((r) => setTimeout(r, 2000));
      setCurrent(2);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleSkipImport = () => {
    setCurrent(2);
  };

  const handleComplete = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.post('/setup/complete');
      setCompleted(true);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to complete setup');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  if (completed) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f5f5f5',
        }}
      >
        <Card style={{ maxWidth: 480, width: '90%', textAlign: 'center' }}>
          <CheckCircleOutlined style={{ fontSize: 64, color: '#52c41a', marginBottom: 24 }} />
          <Title level={3}>初始化完成</Title>
          <Text type="secondary">
            服务器已完成初始化设置，点击下方按钮进入应用。
          </Text>
          <div style={{ marginTop: 24 }}>
            <Button type="primary" size="large" onClick={handleRefresh}>
              进入应用
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const steps = [
    {
      title: '管理员账户',
      content: (
        <Card style={{ maxWidth: 480, margin: '0 auto' }}>
          <Title level={4}>创建管理员账户</Title>
          <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
            请设置管理员用户名和密码，用于管理服务器。
          </Text>
          <Form layout="vertical" onFinish={handleCreateAdmin} autoComplete="off">
            <Form.Item
              name="username"
              label="用户名"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input prefix={<UserOutlined />} placeholder="管理员用户名" size="large" />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[
                { required: true, message: '请输入密码' },
                { min: 6, message: '密码至少 6 个字符' },
              ]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="密码（至少 6 位）"
                size="large"
              />
            </Form.Item>
            {error && (
              <Alert
                message={error}
                type="error"
                showIcon
                style={{ marginBottom: 16 }}
                closable
                onClose={() => setError(null)}
              />
            )}
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading} block size="large">
                创建管理员
              </Button>
            </Form.Item>
          </Form>
        </Card>
      ),
    },
    {
      title: '导入语录',
      content: (
        <Card style={{ maxWidth: 480, margin: '0 auto' }}>
          <Title level={4}>导入语录</Title>
          <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
            你可以从一言官方句子仓库导入已有语录，也可以跳过此步骤稍后手动添加。
          </Text>
          {error && (
            <Alert
              message={error}
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
              closable
              onClose={() => setError(null)}
            />
          )}
          {importResult && (
            <Alert message={importResult} type="success" showIcon style={{ marginBottom: 16 }} />
          )}
          <Space direction="vertical" style={{ width: '100%' }}>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={handleImport}
              loading={importing}
              block
              size="large"
            >
              {importing ? '导入中...' : '从 CDN 导入语录'}
            </Button>
            <Button onClick={handleSkipImport} disabled={importing} block size="large">
              跳过
            </Button>
          </Space>
          {importing && (
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <Spin />
              <br />
              <Text type="secondary">正在从 CDN 下载语录，请稍候...</Text>
            </div>
          )}
        </Card>
      ),
    },
    {
      title: '完成',
      content: (
        <Card style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
          <CheckCircleOutlined style={{ fontSize: 48, color: '#52c41a', marginBottom: 24 }} />
          <Title level={4}>准备就绪</Title>
          <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
            所有设置已完成，点击下方按钮完成初始化。
          </Text>
          {error && (
            <Alert
              message={error}
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
              closable
              onClose={() => setError(null)}
            />
          )}
          <Button type="primary" size="large" onClick={handleComplete} loading={loading} block>
            完成初始化
          </Button>
        </Card>
      ),
    },
  ];

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f5f5f5',
        padding: '24px 16px',
      }}
    >
      <div style={{ marginBottom: 32, textAlign: 'center' }}>
        <img src="/favicon.svg" alt="logo" style={{ width: 48, height: 44 }} />
        <Title level={2} style={{ marginTop: 12, marginBottom: 4 }}>
          一言 Hitokoto
        </Title>
        <Text type="secondary">服务器初始化向导</Text>
      </div>

      <Steps
        current={current}
        style={{ maxWidth: 600, width: '100%', marginBottom: 32 }}
        items={[
          { title: '管理员账户' },
          { title: '导入语录' },
          { title: '完成' },
        ]}
      />

      {steps[current].content}
    </div>
  );
}
