import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, Table, Tag, Button, Select, Space, Popconfirm, message, Tooltip, Tabs, Switch, Input, Checkbox } from 'antd';
import { CheckOutlined, CloseOutlined, ReloadOutlined, RobotOutlined } from '@ant-design/icons';
import api from '../utils/api';
import dayjs from 'dayjs';

interface ReviewChange {
  id: number;
  quote_id: number;
  quote_uuid: string;
  quote_content: string;
  quote_from: string;
  approved: boolean;
  confidence: 'high' | 'medium' | 'low' | string;
  reason: string;
  status: string;
  batch_run: string;
  created_at: string;
}

interface Counts {
  pending: number;
  approved: number;
  rejected: number;
  skipped: number;
}

interface ReviewLogEntry {
  quote_uuid: string;
  content: string;
  from: string;
  approved: boolean;
  confidence: string;
  reason: string;
  is_error: boolean;
  error?: string;
  change_id?: number;
  skipped?: boolean;
  auto_applied?: boolean;
  applied_status?: string;
}

interface ReviewMsg {
  type: 'start' | 'log' | 'done' | 'stopped' | 'paused' | 'resumed' | 'error';
  total?: number;
  processed?: number;
  log?: ReviewLogEntry;
  message?: string;
  batch_run?: string;
}

const confidenceColor: Record<string, string> = { high: 'green', medium: 'orange', low: 'red' };
const statusColor: Record<string, string> = { pending: 'orange', approved: 'green', rejected: 'red', skipped: 'default' };
const statusLabel: Record<string, string> = { pending: '待审核', approved: '已采纳', rejected: '已忽略', skipped: '已跳过' };

// errMessage pulls the server-provided error string off a failed request.
function errMessage(err: unknown, fallback = '操作失败'): string {
  const e = err as { response?: { data?: { error?: string } } };
  return e?.response?.data?.error || fallback;
}

// verdictTag renders the AI's approve/reject verdict.
function verdictTag(approved: boolean) {
  return approved ? <Tag color="green">通过</Tag> : <Tag color="red">不通过</Tag>;
}

// PLACEHOLDER_REVIEW_BATCH_PANEL

// ─── Batch review panel ───────────────────────────────────────────────────────

function ReviewBatchPanel({ onBatchDone }: { onBatchDone?: () => void }) {
  const wsRef = useRef<WebSocket | null>(null);
  const logsBottomRef = useRef<HTMLDivElement>(null);
  const [jobState, setJobState] = useState<'idle' | 'running' | 'paused' | 'done' | 'stopped'>('idle');
  const jobStateRef = useRef<'idle' | 'running' | 'paused' | 'done' | 'stopped'>('idle');
  const [processed, setProcessed] = useState(0);
  const [total, setTotal] = useState(0);
  const [logs, setLogs] = useState<ReviewLogEntry[]>([]);
  const [wsError, setWsError] = useState('');
  const [batchRun, setBatchRun] = useState('');

  // Filter: restricts which quotes enter the batch review run.
  const [filterStatus, setFilterStatus] = useState<string>('pending');
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [filterKeyword, setFilterKeyword] = useState('');
  const [filterOnlyUnreviewed, setFilterOnlyUnreviewed] = useState(false);
  const [categoryOptions, setCategoryOptions] = useState<{ value: string; label: string }[]>([]);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Build the filter payload sent to the backend (omitting empty fields).
  const buildFilter = useCallback(() => {
    const f: { status?: string; categories?: string[]; search?: string[]; only_unreviewed?: boolean } = {};
    if (filterStatus) f.status = filterStatus;
    if (filterCategories.length > 0) f.categories = filterCategories;
    const kw = filterKeyword.trim();
    if (kw) f.search = kw.split(/\s+/);
    if (filterOnlyUnreviewed) f.only_unreviewed = true;
    return f;
  }, [filterStatus, filterCategories, filterKeyword, filterOnlyUnreviewed]);

  const getWsUrl = () => {
    const token = localStorage.getItem('access_token') || '';
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const base = api.defaults.baseURL || '/api';
    let host: string, path: string;
    try {
      const u = new URL(base, window.location.href);
      host = u.host;
      path = u.pathname.replace(/\/api\/?$/, '');
    } catch {
      host = window.location.host; path = '';
    }
    return proto + '://' + host + path + '/api/admin/ai/review-batch/ws?token=' + encodeURIComponent(token);
  };

  const connectWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onopen = wsRef.current.onmessage = wsRef.current.onerror = wsRef.current.onclose = null;
      if (wsRef.current.readyState !== WebSocket.CLOSED) wsRef.current.close();
    }
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;
    ws.onmessage = (e: MessageEvent) => {
      let msg: ReviewMsg;
      try { msg = JSON.parse(e.data as string) as ReviewMsg; } catch { return; }
      if (msg.type === 'start') {
        setTotal(msg.total ?? 0); setProcessed(0); setLogs([]);
        setBatchRun(msg.batch_run ?? '');
        setJobState('running'); jobStateRef.current = 'running'; setWsError('');
      } else if (msg.type === 'log') {
        if (msg.processed !== undefined) setProcessed(msg.processed);
        if (msg.total !== undefined) setTotal(msg.total);
        if (msg.log) setLogs((prev) => [...prev, msg.log!]);
      } else if (msg.type === 'paused') {
        if (msg.processed !== undefined) setProcessed(msg.processed);
        setJobState('paused'); jobStateRef.current = 'paused';
      } else if (msg.type === 'resumed') {
        setJobState('running'); jobStateRef.current = 'running';
      } else if (msg.type === 'done') {
        if (msg.processed !== undefined) setProcessed(msg.processed);
        setJobState('done'); jobStateRef.current = 'done';
        onBatchDone?.();
      } else if (msg.type === 'stopped') {
        if (msg.processed !== undefined) setProcessed(msg.processed);
        setJobState('stopped'); jobStateRef.current = 'stopped';
        onBatchDone?.();
      } else if (msg.type === 'error') {
        setWsError(msg.message || '任务出错');
        setJobState('idle'); jobStateRef.current = 'idle';
      }
    };
    ws.onerror = () => { setWsError('WebSocket 连接失败'); setJobState('idle'); jobStateRef.current = 'idle'; };
    ws.onclose = () => { if (jobStateRef.current === 'running') { setJobState('stopped'); jobStateRef.current = 'stopped'; } };
    return ws;
  }, [onBatchDone]);

  useEffect(() => {
    api.get('/admin/ai/review/batch/status').then((r) => {
      const s = r.data;
      if (s.running || (s.done && (s.processed ?? 0) > 0)) {
        setTotal(s.total ?? 0); setProcessed(s.processed ?? 0); setBatchRun(s.batch_run ?? '');
        if (s.done) {
          const st = s.stopped ? 'stopped' : 'done';
          setJobState(st); jobStateRef.current = st;
        } else {
          const st = s.paused ? 'paused' : 'running';
          setJobState(st); jobStateRef.current = st;
          connectWs();
        }
      }
    }).catch(() => {});
    // Load category options for the filter selector.
    api.get('/categories').then((r) => {
      const cats = (r.data.categories || []) as { name: string; display_name?: string }[];
      setCategoryOptions(cats.map((c) => ({
        value: c.name,
        label: c.display_name && c.display_name !== c.name ? `${c.name}（${c.display_name}）` : c.name,
      })));
    }).catch(() => {});
    return () => { wsRef.current?.close(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced preview of how many quotes match the current filter.
  useEffect(() => {
    const active = jobState === 'running' || jobState === 'paused';
    const handle = setTimeout(() => {
      if (active) { setPreviewCount(null); return; }
      setPreviewLoading(true);
      api.post('/admin/ai/review/batch/preview', buildFilter())
        .then((r) => setPreviewCount(r.data.count ?? 0))
        .catch(() => setPreviewCount(null))
        .finally(() => setPreviewLoading(false));
    }, active ? 0 : 400);
    return () => clearTimeout(handle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterCategories, filterKeyword, filterOnlyUnreviewed, jobState]);

  const handleStart = () => {
    if (previewCount === 0) {
      message.warning('没有符合当前筛选条件的语录，请调整筛选条件');
      return;
    }
    setWsError(''); setLogs([]); setProcessed(0); setTotal(0);
    const ws = connectWs();
    const send = () => ws.send(JSON.stringify({ action: 'start', filter: buildFilter() }));
    if (ws.readyState === WebSocket.OPEN) send(); else ws.onopen = send;
  };
  const handleStop = () => wsRef.current?.send(JSON.stringify({ action: 'stop' }));
  const handlePause = async () => { try { await api.post('/admin/ai/review/batch/pause'); } catch (err) { message.error(errMessage(err, '暂停失败')); } };
  const handleResume = async () => { try { await api.post('/admin/ai/review/batch/resume'); } catch (err) { message.error(errMessage(err, '恢复失败')); } };

  useEffect(() => { logsBottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs.length]);

  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
  const isRunning = jobState === 'running';
  const isPaused = jobState === 'paused';
  const hasResult = isRunning || isPaused || jobState === 'done' || jobState === 'stopped';

  return (
    <div>
      <div style={{ marginBottom: 12, color: 'var(--surface-muted-text)', fontSize: 13 }}>
        批量审核会对符合下方筛选条件的语录逐条调用 AI 判定。判定结果进入下方列表待人工采纳；若已在设置中开启「自动应用」，达标判定会直接更新语录状态。
      </div>

      {!isRunning && !isPaused && (
        <div style={{ marginBottom: 16, padding: '12px 14px', background: 'var(--surface-subtle, #f6f8fa)', border: '1px solid var(--border-light, #e0e0e0)', borderRadius: 8 }}>
          <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 10 }}>筛选要审核的语录（留空状态则处理全部状态）</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <Select
              allowClear
              placeholder="状态（全部）"
              style={{ width: 140 }}
              value={filterStatus || undefined}
              onChange={(v) => setFilterStatus(v ?? '')}
              options={[
                { value: 'pending', label: '待审核' },
                { value: 'approved', label: '已通过' },
                { value: 'rejected', label: '已驳回' },
              ]}
            />
            <Select
              mode="multiple"
              allowClear
              placeholder="分类（全部）"
              style={{ minWidth: 220, maxWidth: 360 }}
              value={filterCategories}
              onChange={setFilterCategories}
              options={categoryOptions}
              maxTagCount="responsive"
              filterOption={(input, opt) => (opt?.label as string ?? '').toLowerCase().includes(input.toLowerCase())}
            />
            <Input
              allowClear
              placeholder="关键词（内容/出处，空格分隔）"
              style={{ width: 240 }}
              value={filterKeyword}
              onChange={(e) => setFilterKeyword(e.target.value)}
            />
            <Checkbox checked={filterOnlyUnreviewed} onChange={(e) => setFilterOnlyUnreviewed(e.target.checked)}>
              仅未审核过的语录
            </Checkbox>
          </div>
          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--surface-muted-text)' }}>
            {previewLoading
              ? '正在统计匹配数量…'
              : previewCount === null
                ? '无法获取匹配数量'
                : <>匹配 <strong style={{ color: 'var(--text-primary)' }}>{previewCount}</strong> 条语录将进入审核</>}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {!isRunning && !isPaused
          ? <Button type="primary" icon={<RobotOutlined />} onClick={handleStart} loading={previewLoading}>启动批量 AI 审核</Button>
          : <>
              {isRunning && <Button onClick={handlePause}>暂停</Button>}
              {isPaused && <Button type="primary" onClick={handleResume}>继续</Button>}
              <Button danger onClick={handleStop}>停止</Button>
            </>
        }
        {hasResult && (
          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 14 }}>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{processed}</span>
            <span style={{ color: 'var(--surface-muted-text)', margin: '0 4px' }}>/</span>
            <span style={{ fontWeight: 600 }}>{total}</span>
            <span style={{ color: 'var(--surface-muted-text)', marginLeft: 6 }}>
              {jobState === 'done' ? '已完成'
                : jobState === 'stopped' ? '已停止'
                : jobState === 'paused' ? '已暂停'
                : percent + '%'}
            </span>
          </span>
        )}
      </div>

      {wsError && (
        <div style={{ color: 'var(--error-text, #ff4d4f)', background: 'var(--error-bg, #fff2f0)', border: '1px solid var(--error-border, #ffccc7)', borderRadius: 6, padding: '6px 12px', marginBottom: 12, fontSize: 13 }}>
          {wsError}
        </div>
      )}

      {hasResult && (
        <div style={{ height: 6, background: 'var(--border-light, #f0f0f0)', borderRadius: 3, overflow: 'hidden', marginBottom: 12 }}>
          <div style={{
            height: '100%', width: percent + '%', borderRadius: 3, transition: 'width 0.25s ease',
            background: jobState === 'stopped' ? '#faad14' : jobState === 'done' ? '#52c41a' : jobState === 'paused' ? '#722ed1' : '#1677ff',
          }} />
        </div>
      )}

      {logs.length > 0 && (
        <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--border-light, #f0f0f0)', borderRadius: 8, padding: 8, fontSize: 13 }}>
          {logs.map((l, i) => (
            <div key={i} style={{ padding: '4px 6px', borderBottom: '1px solid var(--border-light, #f5f5f5)' }}>
              {l.from && <span style={{ color: 'var(--surface-muted-text)', marginRight: 6 }}>[{l.from}]</span>}
              <span>{l.content}</span>
              {l.is_error
                ? <Tag color="red" style={{ marginLeft: 6 }}>错误{l.error ? `：${l.error}` : ''}</Tag>
                : l.skipped
                  ? <Tag style={{ marginLeft: 6 }}>跳过</Tag>
                  : <>
                      <span style={{ marginLeft: 6 }}>{verdictTag(l.approved)}</span>
                      {l.confidence && <Tag color={confidenceColor[l.confidence] ?? 'default'}>{l.confidence}</Tag>}
                      {l.auto_applied && <Tag color="blue">已自动{l.applied_status === 'rejected' ? '驳回' : '通过'}</Tag>}
                      {l.reason && <span style={{ color: 'var(--surface-muted-text)' }}>· {l.reason}</span>}
                    </>
              }
            </div>
          ))}
          <div ref={logsBottomRef} />
        </div>
      )}

      {(hasResult || batchRun) && (
        <div style={{ marginTop: 12 }}>
          <span style={{ color: 'var(--surface-muted-text)', fontSize: 13 }}>
            本批次标识：{batchRun || '—'}
          </span>
        </div>
      )}
    </div>
  );
}

// PLACEHOLDER_REVIEW_PANEL

// ─── Review change list panel ─────────────────────────────────────────────────

function ReviewListPanel({ batchRunFilter, refreshKey }: { batchRunFilter?: string; refreshKey?: number }) {
  const [changes, setChanges] = useState<ReviewChange[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState<Counts>({ pending: 0, approved: 0, rejected: 0, skipped: 0 });
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [applyAllConfidence, setApplyAllConfidence] = useState<'high' | 'medium' | 'low'>('high');
  const [applyAllReject, setApplyAllReject] = useState(false);
  const [applyAllLoading, setApplyAllLoading] = useState(false);

  const fetchCounts = useCallback(() => {
    const params: Record<string, string> = {};
    if (batchRunFilter) params.batch_run = batchRunFilter;
    api.get('/admin/ai/review/changes/counts', { params }).then((r) => setCounts(r.data.counts || {})).catch(() => {});
  }, [batchRunFilter]);

  const fetchChanges = useCallback(() => {
    setLoading(true);
    const params: Record<string, string | number> = { status: statusFilter, page, page_size: pageSize };
    if (batchRunFilter) params.batch_run = batchRunFilter;
    api.get('/admin/ai/review/changes', { params })
      .then((r) => { setChanges(r.data.changes || []); setTotal(r.data.total || 0); })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  }, [statusFilter, page, pageSize, batchRunFilter]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on filter/page change
  useEffect(() => { fetchChanges(); fetchCounts(); }, [fetchChanges, fetchCounts, refreshKey]);

  const handleAdopt = async (id: number) => {
    setActionLoading(id);
    try {
      const res = await api.post(`/admin/ai/review/changes/${id}/approve`);
      message.success(res.data.quote_status === 'rejected' ? '已采纳：语录驳回' : '已采纳：语录通过');
      fetchChanges(); fetchCounts();
    } catch (err) {
      message.error(errMessage(err));
    } finally {
      setActionLoading(null);
    }
  };

  const handleDismiss = async (id: number) => {
    setActionLoading(id);
    try {
      await api.post(`/admin/ai/review/changes/${id}/reject`);
      message.success('已忽略该 AI 判定');
      fetchChanges(); fetchCounts();
    } catch (err) {
      message.error(errMessage(err));
    } finally {
      setActionLoading(null);
    }
  };

  const handleBulk = async (action: 'apply' | 'dismiss') => {
    if (selectedIds.length === 0) return;
    setBulkLoading(true);
    try {
      const res = await api.post('/admin/ai/review/changes/bulk', { ids: selectedIds, action });
      if (action === 'apply') {
        message.success(`批量采纳：${res.data.applied} 条${res.data.failed ? `，失败 ${res.data.failed} 条` : ''}`);
      } else {
        message.success(`批量忽略：${res.data.affected} 条`);
      }
      setSelectedIds([]);
      fetchChanges(); fetchCounts();
    } catch (err) {
      message.error(errMessage(err));
    } finally {
      setBulkLoading(false);
    }
  };

  // Apply every pending decision meeting the chosen confidence threshold.
  const handleApplyAll = async () => {
    setApplyAllLoading(true);
    try {
      const body: Record<string, string | boolean> = { confidence: applyAllConfidence, allow_reject: applyAllReject };
      if (batchRunFilter) body.batch_run = batchRunFilter;
      const res = await api.post('/admin/ai/review/changes/approve-all', body);
      const { applied = 0, skipped = 0, failed = 0 } = res.data || {};
      message.success(
        `已采纳 ${applied} 条` +
        (skipped ? `，未达标/保留 ${skipped} 条` : '') +
        (failed ? `，失败 ${failed} 条` : '')
      );
      setSelectedIds([]);
      fetchChanges(); fetchCounts();
    } catch (err) {
      message.error(errMessage(err));
    } finally {
      setApplyAllLoading(false);
    }
  };

  const columns = [
    {
      title: '语录',
      key: 'quote',
      width: 320,
      ellipsis: true,
      render: (_: unknown, r: ReviewChange) => (
        <span>
          {r.quote_from && <span style={{ color: 'var(--surface-muted-text)', marginRight: 6 }}>[{r.quote_from}]</span>}
          <Tooltip title={r.quote_content}>{r.quote_content}</Tooltip>
        </span>
      ),
    },
    {
      title: 'AI 判定',
      key: 'verdict',
      width: 100,
      render: (_: unknown, r: ReviewChange) => verdictTag(r.approved),
    },
    {
      title: '置信度',
      dataIndex: 'confidence',
      key: 'confidence',
      width: 90,
      render: (v: string) => <Tag color={confidenceColor[v] ?? 'default'}>{v || '—'}</Tag>,
    },
    {
      title: '理由',
      dataIndex: 'reason',
      key: 'reason',
      width: 260,
      ellipsis: true,
      render: (v: string) => <Tooltip title={v}>{v || '—'}</Tooltip>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (s: string) => <Tag color={statusColor[s]}>{statusLabel[s] || s}</Tag>,
    },
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 110,
      render: (t: string) => dayjs(t).format('MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      fixed: 'right' as const,
      render: (_: unknown, r: ReviewChange) => (
        r.status === 'pending' ? (
          <Space>
            <Tooltip title={r.approved ? '采纳：将语录设为通过' : '采纳：将语录驳回'}>
              <Button
                size="small" type="primary" icon={<CheckOutlined />}
                loading={actionLoading === r.id}
                onClick={() => handleAdopt(r.id)}
              >采纳</Button>
            </Tooltip>
            <Popconfirm title="忽略此 AI 判定？语录状态不变" onConfirm={() => handleDismiss(r.id)}>
              <Button size="small" danger icon={<CloseOutlined />} loading={actionLoading === r.id}>忽略</Button>
            </Popconfirm>
          </Space>
        ) : null
      ),
    },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        {(['pending', 'approved', 'rejected'] as const).map((s) => (
          <Tag key={s} color={statusColor[s]}
            style={{ cursor: 'pointer', fontSize: 13, padding: '2px 10px' }}
            onClick={() => { setStatusFilter(s); setPage(1); }}
          >
            {statusLabel[s]} {counts[s] ?? 0}
          </Tag>
        ))}
        <Button size="small" icon={<ReloadOutlined />} onClick={() => { fetchChanges(); fetchCounts(); }}>刷新</Button>
      </Space>

      <Card styles={{ body: { padding: 0 } }}>
        <div style={{ padding: '12px 16px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Select value={statusFilter} style={{ width: 120 }}
            onChange={(v) => { setStatusFilter(v); setPage(1); setSelectedIds([]); }}
            options={[
              { value: 'pending', label: '待审核' },
              { value: 'approved', label: '已采纳' },
              { value: 'rejected', label: '已忽略' },
            ]}
          />
          {selectedIds.length > 0 && statusFilter === 'pending' && (
            <Space>
              <Button type="primary" size="small" loading={bulkLoading} onClick={() => handleBulk('apply')}>
                批量采纳 ({selectedIds.length})
              </Button>
              <Popconfirm title={`批量忽略 ${selectedIds.length} 条？`} onConfirm={() => handleBulk('dismiss')}>
                <Button danger size="small" loading={bulkLoading}>批量忽略</Button>
              </Popconfirm>
              <Button size="small" onClick={() => setSelectedIds([])}>取消</Button>
            </Space>
          )}
          {selectedIds.length === 0 && statusFilter === 'pending' && (
            <Space size={6} wrap style={{ marginLeft: 'auto' }}>
              <span style={{ color: 'var(--surface-muted-text)', fontSize: 13 }}>按置信度采纳全部：</span>
              <Select value={applyAllConfidence} size="small" style={{ width: 200 }}
                onChange={(v) => setApplyAllConfidence(v)}
                options={[
                  { value: 'high', label: '仅高置信度（high）' },
                  { value: 'medium', label: '中及以上（medium、high）' },
                  { value: 'low', label: '低及以上（low、medium、high）' },
                ]}
              />
              <Tooltip title="开启后达标的「不通过」判定也会被采纳（驳回语录）；默认仅采纳「通过」判定">
                <Space size={4}>
                  <Switch size="small" checked={applyAllReject} onChange={setApplyAllReject} />
                  <span style={{ fontSize: 12, color: 'var(--surface-muted-text)' }}>含驳回</span>
                </Space>
              </Tooltip>
              <Popconfirm
                title="采纳全部达标判定"
                description={`将采纳${batchRunFilter ? '本批次' : '全部'}待审核中、达到所选置信度的判定${applyAllReject ? '（含驳回）' : '（仅通过）'}。`}
                okText="确认采纳" cancelText="取消"
                onConfirm={handleApplyAll}
              >
                <Button type="primary" size="small" loading={applyAllLoading}>采纳全部达标</Button>
              </Popconfirm>
            </Space>
          )}
        </div>

        <Table
          dataSource={changes}
          columns={columns}
          rowKey="id"
          loading={loading}
          rowSelection={statusFilter === 'pending' ? {
            selectedRowKeys: selectedIds,
            onChange: (keys) => setSelectedIds(keys as number[]),
          } : undefined}
          pagination={{
            current: page, total, pageSize,
            onChange: (p, ps) => { setPage(p); if (ps !== pageSize) { setPageSize(ps); setPage(1); } setSelectedIds([]); },
            showTotal: (t) => `共 ${t} 条`,
            showSizeChanger: true,
            pageSizeOptions: ['20', '50', '100', '200'],
            size: 'small',
          }}
          scroll={{ x: 1100 }}
          size="small"
        />
      </Card>
    </div>
  );
}

// PLACEHOLDER_MAIN

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AIReviewPage() {
  const [searchParams] = useSearchParams();
  const batchRunFromUrl = searchParams.get('batch_run') || '';
  const [activeTab, setActiveTab] = useState(batchRunFromUrl ? 'batch' : 'all');
  const [refreshKey, setRefreshKey] = useState(0);

  const tabs = [
    {
      key: 'all',
      label: '全部判定',
      children: <ReviewListPanel refreshKey={refreshKey} />,
    },
    {
      key: 'batch',
      label: '批量审核',
      children: (
        <div>
          <Card style={{ marginBottom: 16 }}>
            <ReviewBatchPanel onBatchDone={() => setRefreshKey((k) => k + 1)} />
          </Card>
          <ReviewListPanel refreshKey={refreshKey} />
        </div>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>AI 内容审核</div>
        <div style={{ color: 'var(--surface-muted-text)', fontSize: 13 }}>
          AI 按管理员设定的标准判定语录是否通过；判定默认需人工采纳后才更新语录状态，启用自动应用后达标判定将直接生效
        </div>
      </div>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabs}
      />
    </div>
  );
}
