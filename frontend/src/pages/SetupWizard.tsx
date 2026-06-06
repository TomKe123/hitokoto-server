import { useState } from 'react';
import { Steps, Form, Input, Button, Alert, Typography, Card, Space, Spin, Radio, Tag } from 'antd';
import {
  UserOutlined,
  DownloadOutlined,
  CheckCircleOutlined,
  LockOutlined,
  DatabaseOutlined,
  CloudServerOutlined,
  ClusterOutlined,
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

  // Database config state
  const [dbDriver, setDbDriver] = useState<'sqlite' | 'mysql'>('sqlite');
  const [dbConfiguring, setDbConfiguring] = useState(false);
  const [dbDone, setDbDone] = useState(false);

  // Redis config state
  const [redisDone, setRedisDone] = useState(false);
  const [redisSkipped, setRedisSkipped] = useState(false);
  const [redisTesting, setRedisTesting] = useState(false);

  const handleDatabaseConfig = async (values: any) => {
    setDbConfiguring(true);
    setError(null);
    try {
      const payload: Record<string, string> = { driver: dbDriver };
      if (dbDriver === 'mysql') {
        payload.host = values.host || 'localhost';
        payload.port = values.port || '3306';
        payload.user = values.user;
        payload.password = values.password || '';
        payload.db_name = values.db_name;
      } else {
        payload.db_path = values.db_path || 'hitokoto.db';
      }
      await api.post('/setup/database', payload);
      setDbDone(true);
      setCurrent(1); // Always go to Redis step
    } catch (err: any) {
      setError(err.response?.data?.error || 'Database configuration failed');
    } finally {
      setDbConfiguring(false);
    }
  };

  const handleRedisConfig = async (values: any) => {
    setRedisTesting(true);
    setError(null);
    try {
      await api.post('/setup/redis', {
        addr: values.redis_addr || 'localhost:6379',
        password: values.redis_password || '',
        db: parseInt(values.redis_db, 10) || 0,
      });
      setRedisDone(true);
      setRedisSkipped(false);
      // Go to admin step, checking if admin already exists
      const adminRes = await api.get('/setup/admin-status');
      if (adminRes.data.exists) {
        setCurrent(3); // Skip admin, go to import
      } else {
        setCurrent(2);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Redis configuration failed');
    } finally {
      setRedisTesting(false);
    }
  };

  const handleRedisSkip = async () => {
    setRedisSkipped(true);
    setRedisDone(true);
    setError(null);
    try {
      // Save empty Redis config to .env
      await api.post('/setup/redis', { addr: '', password: '', db: 0 });
    } catch {
      // Ignore errors on skip
    }
    const adminRes = await api.get('/setup/admin-status');
    if (adminRes.data.exists) {
      setCurrent(3); // Skip admin, go to import
    } else {
      setCurrent(2);
    }
  };

  const handleCreateAdmin = async (values: { username: string; password: string }) => {
    setLoading(true);
    setError(null);
    try {
      await api.post('/setup/admin', values);
      setCurrent(3);
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
      await new Promise((r) => setTimeout(r, 2000));
      setCurrent(4);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleSkipImport = () => {
    setCurrent(4);
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
      title: '数据库',
      content: (
        <Card style={{ maxWidth: 520, margin: '0 auto' }}>
          <Title level={4}>
            <DatabaseOutlined style={{ marginRight: 8 }} />
            数据库配置
          </Title>
          <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
            选择服务器使用的数据库类型。SQLite 无需额外配置，适合开发和小型部署。选择 MySQL 需要填写连接信息。
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

          <Form
            layout="vertical"
            onFinish={handleDatabaseConfig}
            initialValues={{ db_path: 'hitokoto.db' }}
            disabled={dbDone}
          >
            <Form.Item label="数据库类型">
              <Radio.Group
                value={dbDriver}
                onChange={(e) => setDbDriver(e.target.value)}
                disabled={dbDone}
              >
                <Radio.Button value="sqlite" style={{ width: 140, textAlign: 'center' }}>
                  <DatabaseOutlined /> SQLite
                </Radio.Button>
                <Radio.Button value="mysql" style={{ width: 140, textAlign: 'center' }}>
                  <CloudServerOutlined /> MySQL
                </Radio.Button>
              </Radio.Group>
            </Form.Item>

            {dbDriver === 'sqlite' ? (
              <Form.Item name="db_path" label="数据库文件路径">
                <Input placeholder="hitokoto.db" />
              </Form.Item>
            ) : (
              <>
                <Form.Item name="host" label="主机" initialValue="localhost"
                  rules={[{ required: true, message: '请输入主机地址' }]}>
                  <Input placeholder="localhost" />
                </Form.Item>
                <Form.Item name="port" label="端口" initialValue="3306"
                  rules={[{ required: true, message: '请输入端口' }]}>
                  <Input placeholder="3306" />
                </Form.Item>
                <Form.Item name="user" label="用户名"
                  rules={[{ required: true, message: '请输入用户名' }]}>
                  <Input placeholder="root" />
                </Form.Item>
                <Form.Item name="password" label="密码">
                  <Input.Password placeholder="数据库密码" />
                </Form.Item>
                <Form.Item name="db_name" label="数据库名"
                  rules={[{ required: true, message: '请输入数据库名' }]}>
                  <Input placeholder="hitokoto" />
                </Form.Item>
              </>
            )}

            <Form.Item>
              <Button type="primary" htmlType="submit" loading={dbConfiguring} block size="large">
                {dbDone ? '已配置' : dbDriver === 'mysql' ? '测试连接并保存' : '确认配置'}
              </Button>
            </Form.Item>
          </Form>
        </Card>
      ),
    },
    {
      title: 'Redis',
      content: (
        <Card style={{ maxWidth: 520, margin: '0 auto' }}>
          <Title level={4}>
            <ClusterOutlined style={{ marginRight: 8 }} />
            Redis 缓存配置
          </Title>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            配置 Redis 以启用数据缓存，可显著提高 API 响应速度。如无 Redis 服务可跳过。
          </Text>
          <Tag color="blue" style={{ marginBottom: 20 }}>可跳过 · 强烈建议生产环境启用</Tag>

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

          <Form
            layout="vertical"
            onFinish={handleRedisConfig}
            initialValues={{ redis_addr: 'localhost:6379', redis_db: 0 }}
            disabled={redisDone}
          >
            <Form.Item
              name="redis_addr"
              label="Redis 地址"
              rules={[{ required: true, message: '请输入 Redis 地址' }]}
            >
              <Input placeholder="localhost:6379" />
            </Form.Item>
            <Form.Item name="redis_password" label="密码（可选）">
              <Input.Password placeholder="Redis 密码（无密码留空）" />
            </Form.Item>
            <Form.Item name="redis_db" label="数据库编号">
              <Input type="number" min={0} max={15} placeholder="0" />
            </Form.Item>

            <Form.Item>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Button type="primary" htmlType="submit" loading={redisTesting} block size="large">
                  {redisDone && !redisSkipped ? '已配置' : '保存配置'}
                </Button>
                <Button onClick={handleRedisSkip} disabled={redisDone} block size="large">
                  跳过 — 不启用缓存
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </Card>
      ),
    },
    {
      title: '管理员',
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
          { title: '数据库' },
          { title: 'Redis' },
          { title: '管理员' },
          { title: '导入语录' },
          { title: '完成' },
        ]}
      />

      {steps[current].content}
    </div>
  );
}
