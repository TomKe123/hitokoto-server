import { useState, useEffect } from 'react';
import { Typography, Grid, Spin, Card } from 'antd';
import { CrownOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer,
} from 'recharts';
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

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

  const barColor = (entry: LeaderboardEntry) => {
    if (entry.user_id === -1) return '#52c41a';
    if (entry.rank === 1) return '#ffd700';
    if (entry.rank === 2) return '#c0c0c0';
    if (entry.rank === 3) return '#cd7f32';
    return '#863bff';
  };

  const chartHeight = data.length * 40 + 60;

  return (
    <div>
      <Title level={isMobile ? 4 : 3}>
        <CrownOutlined style={{ color: '#ffd700', marginRight: 8 }} />
        贡献排行榜
      </Title>
      <Card style={{ maxWidth: 700 }}>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 8, right: 40, left: 0, bottom: 8 }}
            barCategoryGap={4}
          >
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="username"
              tickLine={false}
              axisLine={false}
              width={isMobile ? 70 : 100}
              tick={(props: any) => {
                const { x, y, payload } = props;
                const entry = data[payload.index];
                if (!entry) return null;
                const isAnon = entry.user_id === -1;
                const label = isAnon ? 'Anonymous' : (payload.value.length > 8 ? payload.value.slice(0, 8) + '…' : payload.value);
                return (
                  <g>
                    <text
                      x={x}
                      y={y}
                      dy={4}
                      textAnchor="end"
                      fill={isAnon ? '#52c41a' : undefined}
                      fontSize={isMobile ? 11 : 13}
                      fontWeight={entry.rank <= 3 || isAnon ? 600 : 400}
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/profile/${entry.user_id}`)}
                    >
                      {entry.rank <= 3 ? `${entry.rank}. ${label}` : label}
                    </text>
                  </g>
                );
              }}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const entry = payload[0].payload as LeaderboardEntry;
                return (
                  <div style={{ background: '#fff', padding: '6px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13 }}>
                    <div style={{ fontWeight: 600 }}>{entry.username}</div>
                    <div>{entry.quote_count} 条语录{entry.user_id === -1 ? ' (匿名)' : ''}</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="quote_count" radius={[0, 4, 4, 0]} maxBarSize={24} cursor="pointer">
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={barColor(entry)}
                  fillOpacity={entry.rank > 3 && entry.user_id !== -1 ? 0.65 : 0.9}
                  onClick={() => navigate(`/profile/${entry.user_id}`)}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
