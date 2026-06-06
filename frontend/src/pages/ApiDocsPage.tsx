import { Typography, Card, Tag, Table, Divider, Alert, Spin } from 'antd';
import { useSiteConfig } from '../contexts/SiteConfigContext';
import useCategories from '../hooks/useCategories';

const { Title, Paragraph } = Typography;

const codeBlock = (code: string) => (
  <pre
    style={{
      background: '#1e1e2e',
      color: '#cdd6f4',
      padding: '16px 20px',
      borderRadius: 8,
      fontSize: 13,
      lineHeight: 1.7,
      overflow: 'auto',
    }}>
    <code>{code}</code>
  </pre>
);

export default function ApiDocsPage() {
  const { api_base_url, loaded: configLoaded } = useSiteConfig();
  const { categories, loading: catLoading } = useCategories();
  const base = api_base_url || window.location.origin;

  if (!configLoaded || catLoading) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <Title level={2}>Hitokoto API</Title>
      <Paragraph type="secondary">
        一言 API 提供随机语录获取功能。所有接口均为公开接口，无需认证，可直接访问。
      </Paragraph>

      <Alert
        type="info"
        message={
          <>
            响应中带有 <code>token</code> 字段，作为当前会话标识。
            在下一次请求中通过 <code>token</code> 参数传回，
            即可避免重复获取相同的语录。Token 有效期至当日 24:00。
          </>
        }
        style={{ marginBottom: 24 }}
      />

      {/* 随机获取 */}
      <Card style={{ marginBottom: 24 }}>
        <Title level={4}>
          <Tag color="green">GET</Tag> /api/quotes/random
        </Title>
        <Paragraph>随机获取一条已通过审核的语录。传入 <code>token</code> 参数可避免重复，传入 <code>search</code> 可按关键词搜索，参数均可重复多次。</Paragraph>

        <Title level={5}>请求参数</Title>
        <Table
          dataSource={[
            { key: 'category', type: 'string', required: '否', desc: '分类过滤，可重复多次（OR 逻辑），如 `?category=anime&category=game`' },
            { key: 'search', type: 'string', required: '否', desc: '关键词搜索，模糊匹配 content / from / source，可重复多次（AND 逻辑）' },
            { key: 'token', type: 'string', required: '否', desc: '会话标识，由上一条响应中的 token 字段获得，用于去重' },
          ]}
          columns={[
            { title: '参数', dataIndex: 'key', width: 100 },
            { title: '类型', dataIndex: 'type', width: 80 },
            { title: '必填', dataIndex: 'required', width: 60 },
            { title: '说明', dataIndex: 'desc' },
          ]}
          pagination={false}
          size="small"
          style={{ marginBottom: 16 }}
        />

        <Title level={5}>请求示例</Title>
        {codeBlock(`curl "${base}/api/quotes/random"
curl "${base}/api/quotes/random?category=anime"

# 多分类（OR）
curl "${base}/api/quotes/random?category=anime&category=game"

# 按关键词搜索，多个词（AND）
curl "${base}/api/quotes/random?search=命运&search=选择"

# 分类 + 搜索组合
curl "${base}/api/quotes/random?category=game&search=冒险"

# 携带会话标识避免重复
curl "${base}/api/quotes/random?token=your-token-here"`)}

        <Title level={5} style={{ marginTop: 16 }}>JavaScript 调用</Title>
        {codeBlock(`// 首次调用
fetch('/api/quotes/random')
  .then(res => res.json())
  .then(data => {
    console.log(data.quote.content);
    localStorage.setItem('api_token', data.token);
  });

// 后续调用传入 token 避免重复
const token = localStorage.getItem('api_token');
fetch('/api/quotes/random?token=' + (token ?? ''))
  .then(res => res.json())
  .then(data => console.log(data.quote.content));

// 指定分类（单个）
fetch('/api/quotes/random?category=game&token=' + (token ?? ''))
  .then(res => res.json())
  .then(data => console.log(data.quote.content));

// 多分类 OR
fetch('/api/quotes/random?category=anime&category=game')
  .then(res => res.json())
  .then(data => console.log(data.quote.content));

// 关键词搜索，多词 AND
fetch('/api/quotes/random?search=希望&search=勇气')
  .then(res => res.json())
  .then(data => console.log(data.quote.content));

// 分类 + 搜索组合
fetch('/api/quotes/random?category=anime&search=命运')
  .then(res => res.json())
  .then(data => console.log(data.quote.content));`)}

        <Title level={5} style={{ marginTop: 16 }}>响应格式</Title>
        {codeBlock(`{
  "quote": {
    "uuid": "a1b2c3d4-...",
    "content": "世界上没有偶然，有的只是必然。",
    "from": "侑子",
    "category": "anime",
    "source": "《xxxHOLiC》",
    "contributor_id": 100000000,
    "status": "approved",
    "created_at": "2026-05-27T12:00:00Z",
    "updated_at": "2026-05-27T12:00:00Z"
  },
  "token": "550e8400-e29b-41d4-a716-446655440000"
}`)}
      </Card>

      {/* 分类对照表 */}
      <Card style={{ marginBottom: 24 }}>
        <Title level={4}>分类对照表</Title>
        <Table
          dataSource={categories.map((c) => ({ param: c.name, label: c.display_name || c.name }))}
          columns={[
            { title: '参数值', dataIndex: 'param', width: 120,
              render: (v: string) => <code>{v}</code> },
            { title: '含义', dataIndex: 'label' },
          ]}
          pagination={false}
          size="small"
        />
      </Card>

      <Divider />
      <Paragraph type="secondary" style={{ textAlign: 'center' }}>
        Hitokoto Server · 一言 API
      </Paragraph>
    </div>
  );
}
