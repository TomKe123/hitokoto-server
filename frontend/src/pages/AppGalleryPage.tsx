import { Typography, Card, Row, Col, Tag, Empty } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { APP_PRESETS } from '../apps/registry';

const { Title, Text, Paragraph } = Typography;

export default function AppGalleryPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const openApp = (route: string, requiresAuth: boolean) => {
    if (requiresAuth && !user) {
      navigate(`/login?redirect=${encodeURIComponent(route)}`);
      return;
    }
    navigate(route);
  };

  return (
    <div>
      <Title level={2} style={{ marginBottom: 4 }}>应用</Title>
      <Paragraph type="secondary" style={{ marginTop: 0 }}>
        平台内置的预设应用。点击卡片即可打开，部分应用可绑定你自己的语录列表。
      </Paragraph>

      {APP_PRESETS.length === 0 ? (
        <Empty description="暂无可用应用" style={{ marginTop: 64 }} />
      ) : (
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          {APP_PRESETS.map((preset) => {
            const locked = preset.requiresAuth && !user;
            return (
              <Col key={preset.id} xs={24} sm={12} lg={8}>
                <Card
                  hoverable
                  onClick={() => openApp(preset.route, preset.requiresAuth)}
                  style={{ height: '100%' }}
                  styles={{ body: { display: 'flex', flexDirection: 'column', gap: 8, height: '100%' } }}
                  cover={
                    preset.thumbnail ? (
                      <img
                        alt={preset.name}
                        src={preset.thumbnail}
                        style={{ height: 140, objectFit: 'cover' }}
                      />
                    ) : (
                      <div
                        style={{
                          height: 140,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 48,
                          color: '#F59E0B',
                          background: 'var(--app-cover-bg)',
                        }}
                      >
                        {preset.icon}
                      </div>
                    )
                  }
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Text strong style={{ fontSize: 16 }}>{preset.name}</Text>
                    {locked && (
                      <Tag icon={<LockOutlined />} color="default" style={{ marginInlineEnd: 0 }}>
                        需登录
                      </Tag>
                    )}
                  </div>
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    {preset.description}
                  </Text>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}
    </div>
  );
}
