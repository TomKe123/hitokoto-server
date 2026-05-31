import { useState, useEffect } from 'react';
import { Table, Typography, Tag, Grid } from 'antd';
import { TrophyOutlined, CrownOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';

const { Title } = Typography;
const { useBreakpoint } = Grid;

interface LeaderboardEntry {
  rank: number;
  user_id: number;
  username: string;
  quote_count: number;
}

export default function LeaderboardPage() {
  const [data, setData] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  useEffect(() => {
    api.get('/leaderboard', { params: { limit: 100 } })
      .then((res) => setData(res.data.leaderboard || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const rankColor = (rank: number) => {
    if (rank === 1) return '#ffd700';
    if (rank === 2) return '#c0c0c0';
    if (rank === 3) return '#cd7f32';
    return undefined;
  };

  const rankIcon = (rank: number) => {
    if (rank === 1) return <CrownOutlined style={{ color: '#ffd700', fontSize: 18 }} />;
    if (rank === 2) return <TrophyOutlined style={{ color: '#c0c0c0', fontSize: 16 }} />;
    if (rank === 3) return <TrophyOutlined style={{ color: '#cd7f32', fontSize: 16 }} />;
    return <span style={{ color: '#999' }}>{rank}</span>;
  };

  const columns = [
    {
      title: '排名',
      dataIndex: 'rank',
      width: 80,
      render: (_: unknown, record: LeaderboardEntry) => rankIcon(record.rank),
    },
    {
      title: '用户',
      dataIndex: 'username',
      render: (username: string, record: LeaderboardEntry) => (
        <a onClick={() => navigate(`/profile/${record.user_id}`)} style={{ fontWeight: record.rank <= 3 ? 600 : undefined }}>
          {username}
          {record.rank === 1 && <Tag color="gold" style={{ marginLeft: 8 }}>榜首</Tag>}
          {record.rank === 2 && <Tag color="default" style={{ marginLeft: 8 }}>亚军</Tag>}
          {record.rank === 3 && <Tag color="default" style={{ marginLeft: 8 }}>季军</Tag>}
        </a>
      ),
    },
    {
      title: '语录数',
      dataIndex: 'quote_count',
      width: 120,
      render: (count: number, record: LeaderboardEntry) => (
        <span style={{ color: record.rank <= 3 ? rankColor(record.rank) : undefined, fontWeight: record.rank <= 3 ? 600 : undefined }}>
          {count}
        </span>
      ),
    },
  ];

  return (
    <div>
      <Title level={isMobile ? 4 : 3}>
        <CrownOutlined style={{ color: '#ffd700', marginRight: 8 }} />
        贡献排行榜
      </Title>
      <Table
        dataSource={data}
        columns={columns}
        rowKey="rank"
        loading={loading}
        pagination={false}
        size={isMobile ? 'small' : 'large'}
        style={{ maxWidth: 600 }}
        locale={{ emptyText: '暂无数据' }}
      />
    </div>
  );
}
