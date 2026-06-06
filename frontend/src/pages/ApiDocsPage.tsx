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
        一言 API 提供随机语录获取、分页查询、分类浏览等功能。所有接口均以 JSON 格式返回。
      </Paragraph>

      <Alert
        type="info"
        message={
          <>
            <strong>认证说明：</strong> GET 请求无需认证，可直接在浏览器中访问。
            未登录用户会自动分配 <code>X-Anonymous-Token</code>（见下节），
            用于随机接口的去重。POST 请求需要登录或携带邀请码。
          </>
        }
        style={{ marginBottom: 24 }}
      />

      {/* 匿名 Token */}
      <Card style={{ marginBottom: 24 }}>
        <Title level={4}>
          <Tag color="blue">HEADER</Tag> X-Anonymous-Token
        </Title>
        <Paragraph>
          匿名用户首次请求时，服务端自动生成一个 UUID 作为会话标识，
          通过响应头 <code>X-Anonymous-Token</code> 返回。
          客户端在后续请求中携带此 Token，服务端即可标记已返回的语录，
          避免 <code>/api/quotes/random</code> 重复返回相同内容。
        </Paragraph>
        <Paragraph>
          Token 有效期至当日 24:00，次日自动重置。
          登录用户不受此机制影响。
        </Paragraph>
        <Title level={5}>使用方式</Title>
        <Paragraph>
          请求头：<code>X-Anonymous-Token: your-token-uuid</code>
          <br />
          URL 参数：<code>?_anon=your-token-uuid</code>
        </Paragraph>
        <Title level={5}>JavaScript 示例</Title>
        {codeBlock(`// 首次请求后保存响应头中的 X-Anonymous-Token
// 后续请求带上该 Token 即可享受去重效果
fetch('/api/quotes/random', {
  headers: { 'X-Anonymous-Token': localStorage.getItem('anonymous_token') ?? '' }
})
  .then(res => {
    const token = res.headers.get('X-Anonymous-Token');
    if (token) localStorage.setItem('anonymous_token', token);
    return res.json();
  })
  .then(data => console.log(data.quote));`)}
      </Card>

      {/* 随机获取 */}
      <Card style={{ marginBottom: 24 }}>
        <Title level={4}>
          <Tag color="green">GET</Tag> /api/quotes/random
        </Title>
        <Paragraph>随机获取一条已通过审核的语录。携带 <code>X-Anonymous-Token</code> 可避免重复。</Paragraph>

        <Title level={5}>请求参数</Title>
        <Table
          dataSource={[
            { key: 'category', type: 'string', required: '否', desc: '分类过滤，可选值见下方分类表' },
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
curl "${base}/api/quotes/random?category=anime"`)}

        <Title level={5} style={{ marginTop: 16 }}>JavaScript 示例</Title>
        {codeBlock(`fetch('/api/quotes/random')
  .then(res => res.json())
  .then(data => console.log(data.quote));

// 指定分类
fetch('/api/quotes/random?category=game')
  .then(res => res.json())
  .then(data => console.log(data.quote));`)}

        <Title level={5} style={{ marginTop: 16 }}>响应示例</Title>
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
  }
}`)}
      </Card>

      {/* 分页列表 */}
      <Card style={{ marginBottom: 24 }}>
        <Title level={4}>
          <Tag color="green">GET</Tag> /api/quotes
        </Title>
        <Paragraph>分页获取已通过审核的语录列表。支持分类筛选和关键词搜索。</Paragraph>

        <Title level={5}>请求参数</Title>
        <Table
          dataSource={[
            { key: 'page', type: 'number', required: '否', desc: '页码，默认 1' },
            { key: 'page_size', type: 'number', required: '否', desc: '每页数量，默认 20，最大 100' },
            { key: 'category', type: 'string', required: '否', desc: '分类过滤' },
            { key: 'keyword', type: 'string', required: '否', desc: '关键词搜索（模糊匹配 content / from / source）' },
            { key: 'search', type: 'string', required: '否', desc: '关键词搜索，同 keyword（更直观的别名）' },
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
        {codeBlock(`# 分页
curl "${base}/api/quotes?page=1&page_size=10"

# 按分类 + 关键词搜索
curl "${base}/api/quotes?category=novel&search=人"`)}

        <Title level={5} style={{ marginTop: 16 }}>JavaScript 示例</Title>
        {codeBlock(`// 搜索 "命运" 相关的语录
fetch('/api/quotes?search=命运&page=1')
  .then(res => res.json())
  .then(data => {
    console.log(\`共 \${data.total} 条结果\`);
    data.quotes.forEach(q => console.log(q.content));
  });`)}

        <Title level={5} style={{ marginTop: 16 }}>响应示例</Title>
        {codeBlock(`{
  "quotes": [ ... ],
  "total": 42,
  "page": 1,
  "page_size": 10,
  "total_pages": 5
}`)}
      </Card>

      {/* 单条获取 */}
      <Card style={{ marginBottom: 24 }}>
        <Title level={4}>
          <Tag color="green">GET</Tag> /api/quotes/:id
        </Title>
        <Paragraph>通过 UUID 获取单条语录详情。</Paragraph>

        <Title level={5}>请求示例</Title>
        {codeBlock(`curl "${base}/api/quotes/a1b2c3d4-e5f6-7890-abcd-ef1234567890"`)}

        <Title level={5} style={{ marginTop: 16 }}>响应示例</Title>
        {codeBlock(`{
  "quote": {
    "uuid": "a1b2c3d4-...",
    "content": "...",
    "from": "...",
    "category": "anime",
    "source": "...",
    "contributor_id": 100000000,
    "status": "approved",
    "created_at": "...",
    "updated_at": "..."
  }
}`)}
      </Card>

      {/* 分类列表 */}
      <Card style={{ marginBottom: 24 }}>
        <Title level={4}>
          <Tag color="green">GET</Tag> /api/categories
        </Title>
        <Paragraph>获取所有分类及对应语录数量。</Paragraph>

        <Title level={5}>响应示例</Title>
        {codeBlock(`{
  "categories": [
    { "name": "anime", "count": 12, "display_name": "动画" },
    { "name": "game", "count": 8, "display_name": "游戏" },
    { "name": "novel", "count": 5, "display_name": "小说" }
  ]
}`)}
      </Card>

      {/* 排行榜 */}
      <Card style={{ marginBottom: 24 }}>
        <Title level={4}>
          <Tag color="green">GET</Tag> /api/leaderboard
        </Title>
        <Paragraph>获取贡献排行榜，按通过审核的语录数量排序。</Paragraph>

        <Title level={5}>请求参数</Title>
        <Table
          dataSource={[
            { key: 'limit', type: 'number', required: '否', desc: '返回数量，默认 50，最大 100' },
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
        {codeBlock(`curl "${base}/api/leaderboard?limit=10"`)}

        <Title level={5} style={{ marginTop: 16 }}>响应示例</Title>
        {codeBlock(`{
  "leaderboard": [
    { "rank": 1, "user_id": 100000000, "username": "admin", "quote_count": 42 },
    { "rank": 2, "user_id": -2, "username": "官方源", "quote_count": 30 }
  ]
}`)}
      </Card>

      {/* 类别分布 */}
      <Card style={{ marginBottom: 24 }}>
        <Title level={4}>
          <Tag color="green">GET</Tag> /api/quotes/stats/pie
        </Title>
        <Paragraph>获取按分类分组的语录数量统计，用于展示饼图。支持按时间和用户筛选。</Paragraph>

        <Title level={5}>请求参数</Title>
        <Table
          dataSource={[
            { key: 'days', type: 'number', required: '否', desc: '时间范围（近 N 天），不传则统计全部' },
            { key: 'user_id', type: 'number', required: '否', desc: '按用户筛选，不传则统计全部用户' },
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
        {codeBlock(`# 近30天所有分类统计
curl "${base}/api/quotes/stats/pie?days=30"

# 指定用户近7天的分类统计
curl "${base}/api/quotes/stats/pie?days=7&user_id=100000000"`)}

        <Title level={5} style={{ marginTop: 16 }}>响应示例</Title>
        {codeBlock(`{
  "data": [
    { "category": "anime", "count": 12 },
    { "category": "game", "count": 8 },
    { "category": "novel", "count": 5 }
  ]
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

      {/* 匿名投稿 */}
      <Card style={{ marginBottom: 24 }}>
        <Title level={4}>
          <Tag color="orange">POST</Tag> /api/quotes/invite
        </Title>
        <Paragraph>通过邀请码匿名提交语录，提交后进入审核队列。</Paragraph>

        <Title level={5}>请求体 (JSON)</Title>
        <Table
          dataSource={[
            { key: 'content', type: 'string', required: '是', desc: '语录正文' },
            { key: 'category', type: 'string', required: '是', desc: '分类' },
            { key: 'invite_code', type: 'string', required: '是', desc: '有效的邀请码' },
            { key: 'from', type: 'string', required: '否', desc: '出处/人物' },
            { key: 'source', type: 'string', required: '否', desc: '来源链接或说明' },
          ]}
          columns={[
            { title: '字段', dataIndex: 'key', width: 120 },
            { title: '类型', dataIndex: 'type', width: 80 },
            { title: '必填', dataIndex: 'required', width: 60 },
            { title: '说明', dataIndex: 'desc' },
          ]}
          pagination={false}
          size="small"
          style={{ marginBottom: 16 }}
        />

        <Title level={5}>请求示例</Title>
        {codeBlock(`fetch('/api/quotes/invite', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    content: '人如果不牺牲些什么，就什么也得不到。',
    category: 'anime',
    from: '爱德华·艾尔利克',
    source: '《钢之炼金术师》',
    invite_code: 'your-invite-code'
  })
}).then(res => res.json())
  .then(data => console.log(data));`)}
      </Card>

      <Divider />
      <Paragraph type="secondary" style={{ textAlign: 'center' }}>
        Hitokoto Server · 一言 API
      </Paragraph>
    </div>
  );
}
