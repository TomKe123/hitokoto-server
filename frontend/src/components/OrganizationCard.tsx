import { Card, Tag, Typography, Space } from 'antd';
import { TeamOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

const { Text } = Typography;

interface OrganizationCardProps {
  uuid: string;
  name: string;
  description?: string;
  memberCount?: number;
  ownerName?: string;
  role?: string;
}

export default function OrganizationCard({ uuid, name, description, memberCount, ownerName, role }: OrganizationCardProps) {
  const navigate = useNavigate();

  return (
    <Card
      hoverable
      onClick={() => navigate(`/organizations/${uuid}`)}
      style={{ height: '100%' }}
    >
      <Card.Meta
        title={
          <Space>
            {name}
            {role === 'owner' && <Tag color="gold">拥有者</Tag>}
            {role === 'admin' && <Tag color="blue">管理员</Tag>}
          </Space>
        }
        description={
          <div>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {description || '暂无描述'}
            </Text>
            <div style={{ marginTop: 12, color: 'var(--surface-muted-text)', fontSize: 12 }}>
              <Space size={16}>
                <span><TeamOutlined /> {memberCount ?? 0} 位成员</span>
                {ownerName && <span><UserOutlined /> {ownerName}</span>}
              </Space>
            </div>
          </div>
        }
      />
    </Card>
  );
}
