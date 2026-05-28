import { Typography, Card, Tag, Table, Divider, Alert } from 'antd';

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
  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <Title level={2}>Hitokoto API</Title>
      <Paragraph type="secondary">
        一言 API 提供随机语录获取、分页查询、分类浏览等功能。所有接口均以 JSON 格式返回，无需认证。
      </Paragraph>

      <Alert
        type="info"
        message="所有 GET 请求无需认证，可直接在浏览器中访问。POST 请求需要携带邀请码。"
        style={{ marginBottom: 24 }}
      />

      {/* 随机获取 */}
      <Card style={{ marginBottom: 24 }}>
        <Title level={4}>
          <Tag color="green">GET</Tag> /api/quotes/random
        </Title>
        <Paragraph>随机获取一条已通过审核的语录。</Paragraph>

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
        {codeBlock(`curl "http://localhost:8080/api/quotes/random"
curl "http://localhost:8080/api/quotes/random?category=anime"`)}

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
        <Paragraph>分页获取已通过审核的语录列表。</Paragraph>

        <Title level={5}>请求参数</Title>
        <Table
          dataSource={[
            { key: 'page', type: 'number', required: '否', desc: '页码，默认 1' },
            { key: 'page_size', type: 'number', required: '否', desc: '每页数量，默认 20，最大 100' },
            { key: 'category', type: 'string', required: '否', desc: '分类过滤' },
            { key: 'keyword', type: 'string', required: '否', desc: '关键词搜索（模糊匹配）' },
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
        {codeBlock(`curl "http://localhost:8080/api/quotes?page=1&page_size=10&category=novel"`)}

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
        {codeBlock(`curl "http://localhost:8080/api/quotes/a1b2c3d4-e5f6-7890-abcd-ef1234567890"`)}

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
    { "name": "anime", "count": 12 },
    { "name": "game", "count": 8 },
    { "name": "novel", "count": 5 }
  ]
}`)}
      </Card>

      {/* 分类对照表 */}
      <Card style={{ marginBottom: 24 }}>
        <Title level={4}>分类对照表</Title>
        <Table
          dataSource={[
            { param: 'anime', label: '动画' },
            { param: 'comic', label: '漫画' },
            { param: 'game', label: '游戏' },
            { param: 'novel', label: '小说' },
            { param: 'movie', label: '电影' },
            { param: 'music', label: '音乐' },
            { param: 'other', label: '其他' },
          ]}
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
