import React, { useState, useEffect, useCallback } from 'react';
import { Typography, Card, Tag, Select, Button, Row, Col, Grid, Spin, Space, Input, Tooltip, Segmented, Descriptions, InputNumber } from 'antd';
import { SendOutlined, CopyOutlined, CheckOutlined, CodeFilled } from '@ant-design/icons';
import api from '../utils/api';
import useCategories from '../hooks/useCategories';
import QueryBuilder, { type ConditionGroup, flattenToSearchGroups } from '../components/QueryBuilder';

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

/* ── Endpoint definitions ── */
interface EndpointDef {
  key: string;
  method: string;
  path: string;
  label: string;
  desc: string;
  params: ParamDef[];
}

interface ParamDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select-multiple' | 'condition-group' | 'select-list';
  placeholder?: string;
  hint?: string;
  options?: { value: string; label: string }[];
  defaultValue?: any;
}

const ENDPOINTS: EndpointDef[] = [
  {
    key: 'random',
    method: 'GET',
    path: '/api/quotes/random',
    label: '随机语录',
    desc: '随机获取一条已通过审核的语录，支持分类过滤与关键词搜索',
    params: [
      { key: 'category', label: '分类', type: 'select-multiple', placeholder: '全部', hint: '可多选，OR 逻辑' },
      { key: 'conditionGroup', label: '关键词条件', type: 'condition-group', hint: '添加条件组进行筛选' },
      { key: 'listUuid', label: '指定列表', type: 'select-list', placeholder: '不指定（全部语录）', hint: '选择后仅从该列表中随机获取' },
    ],
  },
  {
    key: 'list',
    method: 'GET',
    path: '/api/quotes',
    label: '语录列表',
    desc: '分页获取语录列表，支持排序、筛选与搜索',
    params: [
      { key: 'category', label: '分类', type: 'select-multiple', placeholder: '全部', hint: '可多选，OR 逻辑' },
      { key: 'conditionGroup', label: '关键词条件', type: 'condition-group', hint: '添加条件组进行筛选' },
      { key: 'page', label: '页码', type: 'number', defaultValue: 1, hint: '从 1 开始' },
      { key: 'page_size', label: '每页数量', type: 'number', defaultValue: 20, hint: '最大 100' },
    ],
  },
  {
    key: 'byId',
    method: 'GET',
    path: '/api/quotes/:id',
    label: '查询语录',
    desc: '通过 UUID 或 ID 获取单条语录详情',
    params: [
      { key: 'id', label: 'UUID / ID', type: 'text', placeholder: '输入语录 UUID 或数字 ID', hint: '例如 a1b2c3d4-... 或 42' },
    ],
  },
  {
    key: 'categories',
    method: 'GET',
    path: '/api/categories',
    label: '分类列表',
    desc: '获取所有可用分类及其对应语录数量',
    params: [],
  },
  {
    key: 'leaderboard',
    method: 'GET',
    path: '/api/leaderboard',
    label: '排行榜',
    desc: '查看贡献最多的用户排行榜',
    params: [
      { key: 'page', label: '页码', type: 'number', defaultValue: 1, hint: '从 1 开始' },
      { key: 'page_size', label: '每页数量', type: 'number', defaultValue: 20, hint: '最大 100' },
    ],
  },
  {
    key: 'pie',
    method: 'GET',
    path: '/api/quotes/stats/pie',
    label: '分类统计',
    desc: '获取各分类的语录数量占比数据',
    params: [],
  },
  {
    key: 'user',
    method: 'GET',
    path: '/api/users/:id',
    label: '用户信息',
    desc: '查看指定用户的公开个人信息',
    params: [
      { key: 'id', label: '用户 ID', type: 'number', placeholder: '输入用户 ID', hint: '用户的数字 ID' },
    ],
  },
  {
    key: 'userQuotes',
    method: 'GET',
    path: '/api/users/:id/quotes',
    label: '用户语录',
    desc: '查看指定用户贡献的语录',
    params: [
      { key: 'id', label: '用户 ID', type: 'number', placeholder: '输入用户 ID', hint: '用户的数字 ID' },
      { key: 'page', label: '页码', type: 'number', defaultValue: 1, hint: '从 1 开始' },
      { key: 'page_size', label: '每页数量', type: 'number', defaultValue: 20, hint: '最大 100' },
    ],
  },
  {
    key: 'publicLists',
    method: 'GET',
    path: '/api/public/lists',
    label: '公共列表',
    desc: '浏览所有公开的语录列表',
    params: [
      { key: 'page', label: '页码', type: 'number', defaultValue: 1, hint: '从 1 开始' },
      { key: 'page_size', label: '每页数量', type: 'number', defaultValue: 20, hint: '最大 100' },
    ],
  },
];

/* ── Generate JS code from condition group ── */
function generateJsCode(conditionGroup: ConditionGroup, selectedCategories: string[], listUuid: string | undefined): string {
  const groups = flattenToSearchGroups(conditionGroup);
  if (groups.length === 0 && selectedCategories.length === 0 && !listUuid) return '';

  const lines: string[] = [];
  lines.push('// 使用 fetch 调用 Hitokoto API');

  const isMultiGroup = groups.length > 1 || (groups.length === 1 && groups[0].split(' ').length > 1);
  const needMultipleRequests = isMultiGroup;

  if (listUuid) {
    // ── List-specific random (may also have categories + search) ──
    lines.push('');
    lines.push('async function fetchHitokoto() {');
    lines.push('  const p = new URLSearchParams();');
    lines.push(`  p.set('list', '${listUuid}');`);
    selectedCategories.forEach((c) => {
      lines.push(`  p.append('category', '${c}');`);
    });
    if (groups.length === 1 && groups[0].split(' ').length === 1) {
      lines.push(`  p.append('search', '${groups[0]}');`);
    } else if (groups.length > 0) {
      lines.push('  // 复杂条件 — 仅使用首组作为示例');
      groups.forEach((g, i) => {
        const terms = g.split(' ');
        lines.push(`// 第 ${i + 1} 组: ${terms.join(' OR ')}`);
      });
      lines.push(`  p.append('search', '${groups[0]}');`);
    }
    lines.push("  const url = '/api/public/random?' + p.toString();");
    lines.push('  const res = await fetch(url);');
    lines.push('  const data = await res.json();');
    lines.push('  return data.quote;');
    lines.push('}');
    lines.push('');
    lines.push('fetchHitokoto().then(q => console.log(q));');
  } else if (needMultipleRequests) {
    // ── Multi-request code ──
    lines.push('');
    lines.push('// 复杂条件：多次请求后在 JS 侧合并');
    lines.push('async function fetchHitokoto() {');
    lines.push('  const baseUrl = \'/api/quotes/random\';');
    for (let i = 0; i < groups.length; i++) {
      lines.push('');
      lines.push(`  // 请求 ${i + 1}`);
      lines.push(`  const p${i} = new URLSearchParams();`);
      selectedCategories.forEach((c) => {
        lines.push(`  p${i}.append('category', '${c}');`);
      });
      const terms = groups[i].split(' ');
      terms.forEach((t) => {
        lines.push(`  p${i}.append('search', '${t}');`);
      });
      lines.push(`  const url${i} = baseUrl + '?' + p${i}.toString();`);
    }
    lines.push('');
    lines.push('  // 并行请求，取第一条结果');
    const urlList = groups.map((_, i) => `url${i}`).join(', ');
    lines.push(`  const promises = [${urlList}].map(u =>`);
    lines.push('    fetch(u).then(r => r.json().then(d => d.quote))');
    lines.push('  );');
    lines.push('  const results = await Promise.all(promises);');
    lines.push('  return results[0];');
    lines.push('}');
    lines.push('');
    lines.push('fetchHitokoto().then(q => console.log(q));');
  } else if (groups.length === 1) {
    const term = groups[0];
    // ── Single search term ──
    lines.push('');
    lines.push('async function fetchHitokoto() {');
    lines.push('  const p = new URLSearchParams();');
    selectedCategories.forEach((c) => {
      lines.push(`  p.append('category', '${c}');`);
    });
    lines.push(`  p.append('search', '${term}');`);
    lines.push("  const url = '/api/quotes/random?' + p.toString();");
    lines.push('  const res = await fetch(url);');
    lines.push('  const data = await res.json();');
    lines.push('  return data.quote;');
    lines.push('}');
    lines.push('');
    lines.push('fetchHitokoto().then(q => console.log(q));');
  } else {
    // ── Categories only, no search terms ──
    lines.push('');
    lines.push('async function fetchHitokoto() {');
    lines.push('  const p = new URLSearchParams();');
    selectedCategories.forEach((c) => {
      lines.push(`  p.append('category', '${c}');`);
    });
    const qs = selectedCategories.length > 0 ? " + '?' + p.toString()" : '';
    lines.push(`  const url = '/api/quotes/random'${qs};`);
    lines.push('  const res = await fetch(url);');
    lines.push('  const data = await res.json();');
    lines.push('  return data.quote;');
    lines.push('}');
    lines.push('');
    lines.push('fetchHitokoto().then(q => console.log(q));');
  }

  return lines.join('\n');
}

/* ── Code window ── */
function CodeWindow({ method, code, loading, label }: { method: string; code: string; loading?: boolean; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #e8e8e8', background: '#1e1e2e', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: '#2d2d3f', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <span style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f56', display: 'inline-block' }} />
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ffbd2e', display: 'inline-block' }} />
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#27c93f', display: 'inline-block' }} />
        </span>
        {method && <Tag color={method === 'GET' ? 'green' : 'blue'} style={{ margin: 0, lineHeight: '18px', fontSize: 11, border: 'none' }}>{method}</Tag>}
        {label && <span style={{ color: '#a0a0b8', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>}
        <div style={{ flex: 1 }} />
        <Tooltip title={copied ? '已复制' : '复制'}>
          <Button type="text" size="small" icon={copied ? <CheckOutlined style={{ color: '#27c93f' }} /> : <CopyOutlined style={{ color: '#a0a0b8' }} />} onClick={handleCopy} style={{ flexShrink: 0 }} />
        </Tooltip>
      </div>
      <div style={{ flex: 1, position: 'relative' }}>
        <pre style={{ margin: 0, padding: '12px 16px', color: '#cdd6f4', fontSize: 13, lineHeight: 1.6, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', minHeight: 80 }}>
          <code>{code}</code>
        </pre>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(30,30,46,0.75)', backdropFilter: 'blur(2px)' }}>
            <Spin style={{ color: '#cdd6f4' }} />
          </div>
        )}
      </div>
    </div>
  );
}

function collectSearchTerms(conditionGroup: ConditionGroup): string[] {
  const groups = flattenToSearchGroups(conditionGroup);
  const terms: string[] = [];
  for (const g of groups) {
    for (const t of g.split(' ')) {
      if (t.trim()) terms.push(t.trim());
    }
  }
  return terms;
}

function buildFullUrl(endpoint: EndpointDef, params: Record<string, any>, selectedCategories: string[], conditionGroup: ConditionGroup, listUuid?: string, token?: string | null): string {
  let path = endpoint.path;
  const queryParams = new URLSearchParams();

  if (endpoint.key === 'random' || endpoint.key === 'list') {
    selectedCategories.forEach((c) => queryParams.append('category', c));
    collectSearchTerms(conditionGroup).forEach((t) => queryParams.append('search', t));
  }

  if (endpoint.key === 'random' && listUuid) {
    path = '/api/public/random';
    queryParams.forEach((_, k) => queryParams.delete(k));
    queryParams.set('list', listUuid);
  }

  if (endpoint.key === 'list' || endpoint.key === 'leaderboard' || endpoint.key === 'publicLists') {
    if (params.page) queryParams.set('page', String(params.page));
    if (params.page_size) queryParams.set('page_size', String(params.page_size));
  }

  if (endpoint.key === 'user' || endpoint.key === 'userQuotes') {
    path = path.replace(':id', String(params.id));
    if (endpoint.key === 'userQuotes') {
      if (params.page) queryParams.set('page', String(params.page));
      if (params.page_size) queryParams.set('page_size', String(params.page_size));
    }
  }

  if (endpoint.key === 'byId') {
    path = path.replace(':id', params.id || '');
  }

  if (token) queryParams.set('token', token);

  const qs = queryParams.toString();
  return `${path}${qs ? '?' + qs : ''}`;
}

async function executeRequest(endpoint: EndpointDef, params: Record<string, any>, selectedCategories: string[], conditionGroup: ConditionGroup, listUuid?: string, token?: string | null) {
  const axiosParams: Record<string, any> = {};

  if (endpoint.key === 'random' || endpoint.key === 'list') {
    if (selectedCategories.length > 0) axiosParams.category = selectedCategories;
    const terms = collectSearchTerms(conditionGroup);
    if (terms.length > 0) axiosParams.search = terms;
  }

  if (endpoint.key === 'random' && listUuid) {
    const res = await api.get('/public/random', {
      params: {
        list: listUuid,
        ...(token ? { token } : {}),
      },
    });
    return res.data;
  }

  if (endpoint.key === 'list') {
    if (params.page) axiosParams.page = params.page;
    if (params.page_size) axiosParams.page_size = params.page_size;
  }

  if (endpoint.key === 'byId') {
    const res = await api.get(`/quotes/${params.id || ''}`);
    return res.data;
  }

  if (endpoint.key === 'user') {
    const res = await api.get(`/users/${params.id}`);
    return res.data;
  }

  if (endpoint.key === 'userQuotes') {
    const res = await api.get(`/users/${params.id}/quotes`, {
      params: { page: params.page || 1, page_size: params.page_size || 20 },
    });
    return res.data;
  }

  if (endpoint.key === 'leaderboard') {
    const res = await api.get('/leaderboard', {
      params: { page: params.page || 1, page_size: params.page_size || 20 },
    });
    return res.data;
  }

  if (endpoint.key === 'publicLists') {
    const res = await api.get('/public/lists', {
      params: { page: params.page || 1, page_size: params.page_size || 20 },
    });
    return res.data;
  }

  const pathPart = endpoint.key === 'categories' ? '/categories' :
    endpoint.key === 'pie' ? '/quotes/stats/pie' :
    endpoint.path.replace('/api/', '');

  const res = await api.get(pathPart, {
    params: { ...(token ? { token } : {}), ...axiosParams },
    paramsSerializer: { indexes: null },
  });
  return res.data;
}

const categoryColors: Record<string, string> = {
  anime: 'volcano', manga: 'orange', novel: 'blue', game: 'green', movie: 'purple', music: 'pink', other: 'default',
};

export default function PlaygroundPage() {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const { categories } = useCategories();

  const [selectedEndpoint, setSelectedEndpoint] = useState('random');
  const endpoint = ENDPOINTS.find((e) => e.key === selectedEndpoint) || ENDPOINTS[0];

  const [response, setResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [responseRaw, setResponseRaw] = useState(false);

  // Shared params
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const rootGroup: ConditionGroup = { type: 'group', logic: 'AND', items: [] };
  const [conditionGroup, setConditionGroup] = useState<ConditionGroup>(rootGroup);

  // Dynamic params
  const [textParams, setTextParams] = useState<Record<string, string>>({});
  const [numParams, setNumParams] = useState<Record<string, number>>({});

  // Token dedup
  const API_TOKEN_KEY = 'api_token';
  const [currentToken, setCurrentToken] = useState<string | null>(() => localStorage.getItem(API_TOKEN_KEY));

  const clearToken = () => {
    localStorage.removeItem(API_TOKEN_KEY);
    setCurrentToken(null);
  };

  const [listUuid, setListUuid] = useState<string | undefined>();
  const [listOptions, setListOptions] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    api.get('/public/lists', { params: { page: 1, page_size: 200 } })
      .then((res) => {
        const lists = (res.data.lists || []).map((l: any) => ({
          value: l.uuid,
          label: `${l.name}${l.owner ? ` (${l.owner})` : ''}${l.item_count != null ? ` · ${l.item_count}条` : ''}`,
        }));
        setListOptions(lists);
      })
      .catch(() => {});
  }, []);

  const fetchApi = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResponse(null);
    const token = localStorage.getItem(API_TOKEN_KEY);
    try {
      const data = await executeRequest(
        endpoint,
        { ...textParams, ...numParams },
        selectedCategories,
        conditionGroup,
        listUuid,
        token,
      );
      setResponse(data);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || '请求失败');
    } finally {
      setLoading(false);
    }
  }, [endpoint, textParams, numParams, selectedCategories, conditionGroup, listUuid]);

  useEffect(() => {
    if (response?.token) {
      setCurrentToken(response.token);
    }
  }, [response]);

  useEffect(() => {
    setTextParams({});
    setNumParams({});
    setResponse(null);
    setError(null);
    setConditionGroup(rootGroup);
    setSelectedCategories([]);
    setListUuid(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEndpoint]);

  const fullUrl = buildFullUrl(endpoint, { ...textParams, ...numParams }, selectedCategories, conditionGroup, listUuid, localStorage.getItem(API_TOKEN_KEY));
  const searchGroups = flattenToSearchGroups(conditionGroup);
  const paramCount = selectedCategories.length + searchGroups.length +
    (listUuid ? 1 : 0) +
    (endpoint.params.some((p) => p.key === 'page' && (numParams.page ?? 1) > 1) ? 1 : 0) +
    (endpoint.params.some((p) => p.key === 'page_size' && (numParams.page_size ?? 20) !== 20) ? 1 : 0) +
    (textParams.id ? 1 : 0) +
    (numParams.id ? 1 : 0);

  const tokenComment = currentToken
    ? `// 去重 Token: ${currentToken.slice(0, 8)}…${currentToken.slice(-4)} — Ctrl+F5 硬刷新可重置 Token，获取全新的随机语录\n`
    : '';

  const responseJson = response
    ? tokenComment + JSON.stringify(response, null, 2)
    : error
      ? `// ${error}`
      : '// 点击"发送"获取响应';

  // Generate JS code from conditions
  const jsCode = generateJsCode(conditionGroup, selectedCategories, listUuid);

  return (
    <div>
      {/* ── Endpoint selector ── */}
      <Card style={{ marginBottom: 20, borderRadius: 10 }} styles={{ body: { padding: isMobile ? '12px 16px' : '14px 24px' } }}>
        <div style={{ marginBottom: 12 }}>
          <Space align="center" style={{ marginBottom: 4 }}>
            <CodeFilled style={{ fontSize: 18, color: '#863bff' }} />
            <Title level={4} style={{ margin: 0 }}>API Playground</Title>
          </Space>
          <Text type="secondary" style={{ fontSize: 13 }}>选择一个接口，填写参数后发送请求，实时查看返回结果</Text>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {ENDPOINTS.map((ep) => (
            <Tag
              key={ep.key}
              color={selectedEndpoint === ep.key ? '#863bff' : 'default'}
              style={{ cursor: 'pointer', padding: '2px 10px', fontSize: 13, borderRadius: 12 }}
              onClick={() => setSelectedEndpoint(ep.key)}
            >
              <Tag color="green" style={{ margin: 0, marginRight: 4, fontSize: 10, lineHeight: '16px', border: 'none' }}>
                {ep.method}
              </Tag>
              {ep.label}
            </Tag>
          ))}
        </div>

        <div style={{ background: '#f5f0ff', borderRadius: 6, padding: '8px 12px', marginBottom: 12 }}>
          <Space>
            <Tag color="green" style={{ margin: 0 }}>{endpoint.method}</Tag>
            <code style={{ fontSize: 13, color: '#555' }}>{endpoint.path}</code>
          </Space>
          <div style={{ marginTop: 4 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>{endpoint.desc}</Text>
          </div>
        </div>

        {/* ── Parameters ── */}
        {endpoint.params.length > 0 && (
          <div style={{ background: '#fafafa', borderRadius: 8, padding: isMobile ? 12 : 16, marginBottom: 12 }}>
            <Row gutter={[12, 12]} align="bottom">
              {endpoint.params.map((param) => (
                <Col xs={24} sm={param.type === 'condition-group' ? 24 : 8} key={param.key}>
                  {param.type === 'select-multiple' && param.key === 'category' && (
                    <>
                      <div style={{ marginBottom: 4 }}>
                        <Text strong style={{ fontSize: 13 }}>{param.label}</Text>
                        {param.hint && <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>({param.hint})</Text>}
                      </div>
                      <Select
                        mode="multiple"
                        style={{ width: '100%' }}
                        placeholder={param.placeholder || ''}
                        value={selectedCategories}
                        onChange={setSelectedCategories}
                        options={categories.map((c) => ({
                          value: c.name,
                          label: `${c.display_name || c.name}${c.count !== undefined ? ` (${c.count})` : ''}`,
                        }))}
                        allowClear
                        maxTagCount={2}
                        size="middle"
                      />
                    </>
                  )}
                  {param.type === 'condition-group' && (
                    <>
                      <div style={{ marginBottom: 4 }}>
                        <Text strong style={{ fontSize: 13 }}>{param.label}</Text>
                        {param.hint && <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>({param.hint})</Text>}
                      </div>
                      <div style={{ background: '#fff', borderRadius: 6, padding: '6px 8px', border: '1px solid #d9d9d9' }}>
                        <QueryBuilder value={conditionGroup} onChange={setConditionGroup} />
                      </div>
                    </>
                  )}
                  {param.type === 'text' && (
                    <>
                      <div style={{ marginBottom: 4 }}>
                        <Text strong style={{ fontSize: 13 }}>{param.label}</Text>
                      </div>
                      <Input
                        placeholder={param.placeholder || ''}
                        value={textParams[param.key] ?? ''}
                        onChange={(e) => setTextParams((prev) => ({ ...prev, [param.key]: e.target.value }))}
                        size="middle"
                        allowClear
                      />
                    </>
                  )}
                  {param.type === 'number' && (
                    <>
                      <div style={{ marginBottom: 4 }}>
                        <Text strong style={{ fontSize: 13 }}>{param.label}</Text>
                        {param.hint && <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>({param.hint})</Text>}
                      </div>
                      <InputNumber
                        style={{ width: '100%' }}
                        min={1}
                        placeholder={String(param.defaultValue ?? '')}
                        value={numParams[param.key] ?? param.defaultValue}
                        onChange={(v) => setNumParams((prev) => ({ ...prev, [param.key]: v ?? param.defaultValue }))}
                        size="middle"
                      />
                    </>
                  )}
                  {param.type === 'select-list' && (
                    <>
                      <div style={{ marginBottom: 4 }}>
                        <Text strong style={{ fontSize: 13 }}>{param.label}</Text>
                        {param.hint && <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>({param.hint})</Text>}
                      </div>
                      <Select
                        style={{ width: '100%' }}
                        placeholder={param.placeholder || ''}
                        value={listUuid}
                        onChange={setListUuid}
                        options={listOptions}
                        allowClear
                        showSearch
                        filterOption={(input, option) =>
                          (option?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
                        }
                        notFoundContent="暂无公开列表"
                        size="middle"
                      />
                    </>
                  )}
                </Col>
              ))}
            </Row>
          </div>
        )}

        {/* ── Token dedup ── */}
        <div style={{ background: '#fafafa', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
          <Row gutter={[12, 8]} align="middle">
            <Col flex="auto">
              <div>
                <Space size={4}>
                  <Text strong style={{ fontSize: 13 }}>去重 Token</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {currentToken
                      ? `当前: ${currentToken.slice(0, 8)}…${currentToken.slice(-4)}`
                      : '首次请求后自动获取，避免重复'}
                  </Text>
                </Space>
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    浏览器中 Ctrl+F5 硬刷新可重置 Token，获取全新随机语录
                  </Text>
                </div>
              </div>
            </Col>
            <Col>
              {currentToken && (
                <Button size="small" onClick={clearToken}>
                  清除 Token
                </Button>
              )}
            </Col>
          </Row>
        </div>

        <Button type="primary" icon={<SendOutlined />} onClick={fetchApi} loading={loading} block size="middle" style={{ borderRadius: 8 }}>
          发送请求
        </Button>
      </Card>

      {/* ── Left: JS code / URL  ·  Right: Response ── */}
      <Card style={{ marginBottom: 20, borderRadius: 10 }} styles={{ body: { padding: isMobile ? '12px 16px' : '16px 24px' }, }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <div style={{ marginBottom: 6 }}>
              <Text strong style={{ fontSize: 13 }}>
                {jsCode ? 'JavaScript 代码' : '请求地址'}
              </Text>
            </div>
            <CodeWindow
              method={jsCode ? '' : endpoint.method}
              label={jsCode ? 'fetch.js' : ''}
              code={jsCode || `${endpoint.method} ${window.location.origin}${fullUrl}`}
            />
          </Col>
          <Col xs={24} lg={12}>
            <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text strong style={{ fontSize: 13, flex: 1 }}>响应结果</Text>
              {response && (
                <Segmented
                  size="small"
                  options={[
                    { value: false, label: '纯文本' },
                    { value: true, label: '可视化' },
                  ]}
                  value={responseRaw}
                  onChange={setResponseRaw}
                />
              )}
            </div>
            {error ? (
              <div style={{
                background: '#fff2f0',
                borderRadius: 8,
                padding: '12px 16px',
                border: '1px solid #ffccc7',
              }}>
                <Space>
                  <span style={{ color: '#ff4d4f', fontWeight: 600, fontSize: 14 }}>请求失败</span>
                  <Text type="danger" style={{ fontSize: 13 }}>{error}</Text>
                </Space>
              </div>
            ) : responseRaw && response ? (
              <div style={{ background: '#fafafa', borderRadius: 8, padding: '0 16px 16px', border: '1px solid #e8e8e8' }}>
                <Descriptions column={1} size="small" colon={false}
                  labelStyle={{ color: '#666', fontWeight: 500, width: 90, paddingBottom: 6 }}
                  contentStyle={{ paddingBottom: 6 }}
                >
                  {renderResponsePreview(endpoint.key, response)}
                </Descriptions>
              </div>
            ) : (
              <CodeWindow method={endpoint.method} code={responseJson} loading={loading && !!response} label="response.json" />
            )}
          </Col>
        </Row>
      </Card>
    </div>
  );
}

function renderResponsePreview(key: string, data: any): React.ReactNode {
  if (!data) return <Text type="secondary">暂无数据</Text>;

  if (key === 'random' && data.quote) {
    const q = data.quote;
    return (
      <>
        <Descriptions.Item label="内容"><Text style={{ fontSize: 15, lineHeight: 1.6 }}>{q.content}</Text></Descriptions.Item>
        <Descriptions.Item label="分类"><Tag color={categoryColors[q.category] || 'default'}>{q.category}</Tag></Descriptions.Item>
        {q.from && <Descriptions.Item label="作者">{q.from}</Descriptions.Item>}
        {q.source && <Descriptions.Item label="出处">{q.source}</Descriptions.Item>}
        <Descriptions.Item label="UUID"><Text copyable style={{ fontSize: 12 }}>{q.uuid}</Text></Descriptions.Item>
        <Descriptions.Item label="token">{data.token}</Descriptions.Item>
        <Descriptions.Item label="状态">
          <Tag color={q.status === 'approved' ? 'green' : q.status === 'pending' ? 'orange' : 'red'}>
            {q.status === 'approved' ? '已通过' : q.status === 'pending' ? '待审核' : '已驳回'}
          </Tag>
        </Descriptions.Item>
      </>
    );
  }

  if (key === 'byId' && data.quote) {
    const q = data.quote;
    return (
      <>
        <Descriptions.Item label="内容"><Text style={{ fontSize: 15, lineHeight: 1.6 }}>{q.content}</Text></Descriptions.Item>
        <Descriptions.Item label="分类"><Tag color={categoryColors[q.category] || 'default'}>{q.category}</Tag></Descriptions.Item>
        {q.from && <Descriptions.Item label="作者">{q.from}</Descriptions.Item>}
        {q.source && <Descriptions.Item label="出处">{q.source}</Descriptions.Item>}
        <Descriptions.Item label="UUID"><Text copyable style={{ fontSize: 12 }}>{q.uuid}</Text></Descriptions.Item>
        <Descriptions.Item label="状态">
          <Tag color={q.status === 'approved' ? 'green' : q.status === 'pending' ? 'orange' : 'red'}>
            {q.status === 'approved' ? '已通过' : q.status === 'pending' ? '待审核' : '已驳回'}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="贡献者 ID">{q.contributor_id}</Descriptions.Item>
      </>
    );
  }

  if (key === 'list' && data.quotes) {
    return (
      <>
        <Descriptions.Item label="总数">{data.total}</Descriptions.Item>
        <Descriptions.Item label="页码">{data.page} / {data.total_pages}</Descriptions.Item>
        <Descriptions.Item label="返回条数">{data.quotes.length}</Descriptions.Item>
        <Descriptions.Item label="语录">
          <div style={{ maxHeight: 200, overflow: 'auto', fontSize: 13, lineHeight: 1.8 }}>
            {data.quotes.slice(0, 10).map((q: any) => (
              <div key={q.uuid} style={{ marginBottom: 6, padding: '4px 8px', background: '#f5f5f5', borderRadius: 4 }}>
                <div>{q.content.length > 60 ? q.content.slice(0, 60) + '…' : q.content}</div>
                <Tag color={categoryColors[q.category] || 'default'} style={{ marginTop: 2, fontSize: 11 }}>
                  {q.category}
                </Tag>
                <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>—— {q.from || '未知'}</Text>
              </div>
            ))}
            {data.quotes.length > 10 && <Text type="secondary">… 还有 {data.quotes.length - 10} 条</Text>}
          </div>
        </Descriptions.Item>
      </>
    );
  }

  if (key === 'categories' && data.categories) {
    return (
      <Descriptions.Item label="分类列表">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {data.categories.map((c: any) => (
            <Tag key={c.name} color={categoryColors[c.name] || 'default'}>
              {c.display_name || c.name} ({c.count ?? '?'})
            </Tag>
          ))}
        </div>
      </Descriptions.Item>
    );
  }

  if (key === 'pie' && data.series) {
    return (
      <>
        <Descriptions.Item label="统计">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {data.series?.map((s: any) => (
              <Tag key={s.name}>{s.name}: {s.value}</Tag>
            ))}
          </div>
        </Descriptions.Item>
      </>
    );
  }

  if (key === 'user' && data.user) {
    const u = data.user;
    return (
      <>
        <Descriptions.Item label="用户名">{u.username}</Descriptions.Item>
        <Descriptions.Item label="角色">
          <Tag color={u.role === 'admin' ? 'red' : 'blue'}>{u.role}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="语录数">{u.quote_count ?? '?'}</Descriptions.Item>
        <Descriptions.Item label="注册时间">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '未知'}</Descriptions.Item>
      </>
    );
  }

  if (key === 'userQuotes' && data.quotes) {
    return (
      <>
        <Descriptions.Item label="总数">{data.total}</Descriptions.Item>
        <Descriptions.Item label="页码">{data.page} / {data.total_pages}</Descriptions.Item>
        <Descriptions.Item label="返回条数">{data.quotes?.length || 0}</Descriptions.Item>
      </>
    );
  }

  if (key === 'leaderboard' && data.leaderboard) {
    return (
      <Descriptions.Item label="排行榜">
        <div style={{ maxHeight: 240, overflow: 'auto', fontSize: 13, lineHeight: 1.8 }}>
          {data.leaderboard.map((u: any, i: number) => (
            <div key={u.user_id || i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
              <Text strong style={{ width: 24, color: i < 3 ? '#faad14' : '#999' }}>#{i + 1}</Text>
              <span>{u.username}</span>
              <Tag>{u.quote_count} 条</Tag>
            </div>
          ))}
        </div>
      </Descriptions.Item>
    );
  }

  if (key === 'publicLists' && data.lists) {
    return (
      <Descriptions.Item label="公共列表">
        <div style={{ maxHeight: 240, overflow: 'auto', fontSize: 13, lineHeight: 1.8 }}>
          {data.lists.map((l: any) => (
            <div key={l.id} style={{ padding: '4px 0' }}>
              <Text strong>{l.name}</Text>
              {l.description && <Text type="secondary" style={{ marginLeft: 8 }}>{l.description}</Text>}
            </div>
          ))}
        </div>
      </Descriptions.Item>
    );
  }

  return (
    <>
      {Object.entries(data).map(([k, v]) => (
        <Descriptions.Item label={k} key={k}>
          {typeof v === 'object' && v !== null
            ? <Text copyable style={{ fontSize: 12 }}>{JSON.stringify(v).slice(0, 200)}</Text>
            : String(v)}
        </Descriptions.Item>
      ))}
    </>
  );
}
