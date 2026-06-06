import { useState, useEffect, useMemo, useRef } from 'react';
import { Typography, Grid, Spin, Card, Select, Row, Col, Tag, theme } from 'antd';
import { PieChartOutlined, TrophyOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import api from '../utils/api';

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

const categoryLabels: Record<string, string> = {
  anime: '动画',
  comic: '漫画',
  novel: '小说',
  game: '游戏',
  movie: '电影',
  music: '音乐',
  poetry: '诗词',
  philosophy: '哲学',
  life: '人生',
  emotion: '情感',
  dialogue: '台词',
  other: '其他',
};

interface LeaderboardEntry {
  rank: number;
  user_id: number;
  username: string;
  quote_count: number;
}

interface PieEntry {
  category: string;
  count: number;
}

const RANGE_OPTIONS = [
  { label: '全部', value: 0 },
  { label: '近7天', value: 7 },
  { label: '近30天', value: 30 },
  { label: '近90天', value: 90 },
];

const PIE_COLORS = [
  '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
  '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#f47983',
  '#1890ff', '#52c41a',
];

function rankColor(rank: number): string {
  if (rank === 1) return '#ffd700';
  if (rank === 2) return '#c0c0c0';
  if (rank === 3) return '#cd7f32';
  return '#863bff';
}

function rankLabel(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
}

export default function LeaderboardPage() {
  const [data, setData] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [pieData, setPieData] = useState<PieEntry[]>([]);
  const [pieLoading, setPieLoading] = useState(false);
  const [rangeDays, setRangeDays] = useState(0);
  const [selectedUserId, setSelectedUserId] = useState<number | undefined>(undefined);
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const barChartRef = useRef<any>(null);
  const { token } = theme.useToken();

  // Fetch leaderboard
  useEffect(() => {
    api.get('/leaderboard', { params: { limit: 100 } })
      .then((res) => setData(res.data.leaderboard || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Fetch pie chart data when filters change
  useEffect(() => {
    const abort = new AbortController();
    setPieLoading(true);
    const params: Record<string, unknown> = { days: rangeDays };
    if (selectedUserId) {
      params.user_id = selectedUserId;
    }
    api.get('/quotes/stats/pie', { params, signal: abort.signal })
      .then((res) => setPieData(res.data.data || []))
      .catch(() => {})
      .finally(() => setPieLoading(false));
    return () => abort.abort();
  }, [rangeDays, selectedUserId]);

  // Derive unique users from leaderboard for the user dropdown
  const userOptions = useMemo(() => {
    const seen = new Set<number>();
    return data
      .filter((e) => {
        if (seen.has(e.user_id)) return false;
        seen.add(e.user_id);
        return true;
      })
      .map((e) => ({
        label: e.user_id === -1 ? 'Anonymous' : e.user_id === -2 ? '官方源' : e.username || `#${e.user_id}`,
        value: e.user_id,
      }));
  }, [data]);

  // ---------- ECharts Bar Option ----------
  const barOption = useMemo(() => {
    // Reverse so rank 1 is at top
    const sorted = [...data].reverse();
    const names = sorted.map((d) => d.username);
    const values = sorted.map((d) => d.quote_count);
    const colors = sorted.map((d) => {
      if (d.user_id === -1) return '#52c41a';
      if (d.user_id === -2) return '#1890ff';
      return rankColor(d.rank);
    });
    const opacities = sorted.map((d) => (d.rank > 3 && d.user_id !== -1 && d.user_id !== -2 ? 0.55 : 0.9));

    return {
      tooltip: {
        trigger: 'axis' as const,
        axisPointer: { type: 'shadow' as const },
        backgroundColor: 'rgba(255,255,255,0.95)',
        borderColor: '#e8e8e8',
        borderWidth: 1,
        borderRadius: 8,
        padding: [10, 14],
        formatter: (params: any) => {
          const idx = params?.[0]?.dataIndex ?? -1;
          const entry = sorted[idx];
          if (!entry) return '';
          const badge = rankLabel(entry.rank);
          return `<div style="font-size:14px;font-weight:600;margin-bottom:4px">${badge} ${entry.username}</div>
<div style="font-size:13px;color:#666">${entry.quote_count} 条语录</div>`;
        },
      },
      grid: {
        left: isMobile ? 60 : 90,
        right: 50,
        top: 8,
        bottom: 8,
        containLabel: false,
      },
      xAxis: {
        type: 'value',
        splitLine: { show: false },
        axisLabel: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'category',
        data: names,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          fontSize: isMobile ? 12 : 13,
          fontWeight: 500,
          padding: [0, 6, 0, 0],
          color: '#333',
          formatter: (name: string, idx: number) => {
            const entry = sorted[idx];
            if (!entry) return name;
            const label = entry.user_id === -1 ? 'Anonymous' : entry.user_id === -2 ? '官方源' : (name.length > 8 ? name.slice(0, 8) + '…' : name);
            if (entry.rank <= 3) return `[${entry.rank}] ${label}`;
            return label;
          },
        },
      },
      series: [{
        type: 'bar',
        data: values.map((v, i) => ({
          value: v,
          itemStyle: {
            color: colors[i],
            opacity: opacities[i],
            borderRadius: [0, 6, 6, 0],
          },
        })),
        barMaxWidth: isMobile ? 18 : 26,
        barCategoryGap: '30%',
        label: {
          show: true,
          position: 'right',
          fontSize: isMobile ? 11 : 12,
          color: '#666',
          formatter: (p: any) => `${p.value}`,
        },
        animationDuration: 600,
        animationEasing: 'cubicOut',
      }],
    };
  }, [data, isMobile]);

  // ---------- ECharts Pie Option ----------
  const pieOption = useMemo(() => {
    if (pieData.length === 0) return null;

    const total = pieData.reduce((s, d) => s + d.count, 0);
    const mapped = pieData.map((d, i) => ({
      name: categoryLabels[d.category] || d.category,
      value: d.count,
      itemStyle: {
        color: PIE_COLORS[i % PIE_COLORS.length],
      },
    }));

    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(255,255,255,0.95)',
        borderColor: '#e8e8e8',
        borderWidth: 1,
        borderRadius: 8,
        padding: [10, 14],
        formatter: (p: any) =>
          `<strong>${p.name}</strong><br/>${p.value} 条 (${((p.value / total) * 100).toFixed(1)}%)`,
      },
      legend: {
        orient: 'vertical' as const,
        right: isMobile ? 0 : 10,
        top: 'center',
        itemWidth: 12,
        itemHeight: 12,
        borderRadius: 2,
        textStyle: { fontSize: isMobile ? 11 : 13 },
      },
      series: [{
        type: 'pie',
        radius: isMobile ? ['35%', '60%'] : ['40%', '70%'],
        center: isMobile ? ['45%', '50%'] : ['35%', '50%'],
        avoidLabelOverlap: true,
        padAngle: 1.5,
        itemStyle: {
          borderRadius: 4,
          borderColor: '#fff',
          borderWidth: 2,
        },
        label: {
          show: !isMobile,
          formatter: (p: any) => `${p.name}\n${((p.value / total) * 100).toFixed(0)}%`,
          fontSize: 12,
          color: '#555',
          lineHeight: 18,
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 14,
            fontWeight: 'bold',
          },
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: 'rgba(0,0,0,0.2)',
          },
        },
        animationType: 'scale',
        animationDuration: 800,
        data: mapped,
      }],
    };
  }, [pieData, isMobile]);

  // Bar chart click handler
  const onBarClick = useMemo(() => (params: any) => {
    const idx = params.dataIndex;
    const sorted = [...data].reverse();
    const entry = sorted[idx];
    if (entry) navigate(`/profile/${entry.user_id}`);
  }, [data, navigate]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      {/* ---------- Hero Header ---------- */}
      <div
        style={{
          background: `linear-gradient(135deg, ${token.colorPrimary} 0%, #531dab 100%)`,
          borderRadius: 16,
          padding: isMobile ? '20px 16px' : '32px 28px',
          marginBottom: 24,
          color: '#fff',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* decorative circles */}
        <div style={{ position: 'absolute', top: -30, right: -20, width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ position: 'absolute', bottom: -40, left: '40%', width: 160, height: 160, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />

        <Row align="middle" justify="space-between">
          <Col>
            <Title level={isMobile ? 4 : 3} style={{ color: '#fff', margin: 0 }}>
              <TrophyOutlined style={{ marginRight: 10 }} />
              贡献排行榜
            </Title>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 4, display: 'block' }}>
              汇聚优质语录，共建社区内容
            </Text>
          </Col>
          <Col>
            <Tag color="gold" style={{ borderRadius: 20, padding: '2px 14px', fontSize: 12 }}>
              共 {data.reduce((s, d) => s + d.quote_count, 0)} 条语录
            </Tag>
          </Col>
        </Row>
      </div>

      {/* ---------- Leaderboard Bar Chart ---------- */}
      <Card
        styles={{ body: { padding: isMobile ? 12 : 20 } }}
        style={{
          borderRadius: 12,
          marginBottom: 24,
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        }}
      >
        <ReactECharts
          ref={barChartRef}
          option={barOption}
          onEvents={{ click: onBarClick }}
          style={{ height: data.length * 36 + 40 }}
          notMerge
          lazyUpdate
        />
      </Card>

      {/* ---------- Pie Chart Section ---------- */}
      <Card
        title={
          <span>
            <PieChartOutlined style={{ color: token.colorPrimary, marginRight: 8 }} />
            类别分布
          </span>
        }
        extra={
          <Text type="secondary" style={{ fontSize: 12 }}>
            {selectedUserId ? '指定用户' : '全部用户'}
          </Text>
        }
        styles={{ body: { padding: isMobile ? 12 : 20 } }}
        style={{
          borderRadius: 12,
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        }}
      >
        {/* Filters */}
        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          <Col>
            <Select
              value={rangeDays}
              onChange={setRangeDays}
              options={RANGE_OPTIONS}
              style={{ width: 120 }}
              size={isMobile ? 'small' : 'middle'}
            />
          </Col>
          <Col>
            <Select
              value={selectedUserId}
              onChange={setSelectedUserId}
              allowClear
              placeholder="全部用户"
              style={{ width: 150 }}
              size={isMobile ? 'small' : 'middle'}
              options={userOptions}
            />
          </Col>
        </Row>

        {pieLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
            <Spin />
          </div>
        ) : pieOption ? (
          <ReactECharts
            option={pieOption}
            style={{ height: isMobile ? 280 : 340 }}
            notMerge
            lazyUpdate
          />
        ) : (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#bbb' }}>
            <PieChartOutlined style={{ fontSize: 40, display: 'block', marginBottom: 12 }} />
            <Text type="secondary">暂无数据</Text>
          </div>
        )}
      </Card>
    </div>
  );
}
