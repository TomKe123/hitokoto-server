import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, Table, Tag, Button, Select, Space, Popconfirm, message, Tooltip, Modal, Typography, Tabs, Descriptions, Checkbox } from 'antd';
import { CheckOutlined, CloseOutlined, InfoCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import api from '../utils/api';
import dayjs from 'dayjs';

const { Text } = Typography;

interface SuggestionItem {
  name: string;
  display_name: string;
  is_new: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

interface AIChange {
  id: number;
  quote_id: number;
  quote_uuid: string;
  quote_content: string;
  quote_from: string;
  old_category: string;
  new_category: string;
  is_new: boolean;
  suggestions_list: SuggestionItem[];
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

const confidenceColor: Record<string, string> = { high: 'green', medium: 'orange', low: 'red' };
const statusColor: Record<string, string> = { pending: 'orange', approved: 'green', rejected: 'red', skipped: 'default' };
const statusLabel: Record<string, string> = { pending: '待审核', approved: '已通过', rejected: '已驳回', skipped: '已跳过' };

// errMessage pulls the server-provided error string off a failed request, with a fallback.
function errMessage(err: unknown, fallback = '操作失败'): string {
  const e = err as { response?: { data?: { error?: string } } };
  return e?.response?.data?.error || fallback;
}

// ─── Change Review Panel ──────────────────────────────────────────────────────

function ChangeReviewPanel({ batchRunFilter }: { batchRunFilter?: string }) {
  const [changes, setChanges] = useState<AIChange[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState<Counts>({ pending: 0, approved: 0, rejected: 0, skipped: 0 });
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [detailChange, setDetailChange] = useState<AIChange | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [approveAllConfidence, setApproveAllConfidence] = useState<'high' | 'medium' | 'low'>('high');
  const [approveAllLoading, setApproveAllLoading] = useState(false);

  const fetchCounts = useCallback(() => {
    const params: Record<string, string> = {};
    if (batchRunFilter) params.batch_run = batchRunFilter;
    api.get('/admin/ai/changes/counts', { params }).then((r) => setCounts(r.data.counts || {})).catch(() => {});
  }, [batchRunFilter]);

  const fetchChanges = useCallback(() => {
    setLoading(true);
    const params: Record<string, string | number> = { status: statusFilter, page, page_size: pageSize };
    if (batchRunFilter) params.batch_run = batchRunFilter;
    api.get('/admin/ai/changes', { params })
      .then((r) => { setChanges(r.data.changes || []); setTotal(r.data.total || 0); })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  }, [statusFilter, page, pageSize, batchRunFilter]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on filter/page change
  useEffect(() => { fetchChanges(); fetchCounts(); }, [fetchChanges, fetchCounts]);

  // Open the detail modal, preselecting the primary suggestion for adoption.
  const openDetail = (change: AIChange) => {
    const first = (change.suggestions_list || [])[0];
    setSelectedSuggestions(first ? [first.name] : []);
    setDetailChange(change);
  };

  const handleApprove = async (id: number, catOverride?: string, displayOverride?: string) => {
    setActionLoading(id);
    try {
      const res = await api.post(`/admin/ai/changes/${id}/approve`, {
        category_name: catOverride || '',
        category_display_name: displayOverride || '',
      });
      message.success(`已通过 → ${res.data.category}`);
      fetchChanges(); fetchCounts();
    } catch (err) {
      message.error(errMessage(err));
    } finally {
      setActionLoading(null);
      setDetailChange(null);
    }
  };

  // Adopt several suggestions at once — assigns multiple categories to the quote.
  const handleApproveMulti = async (id: number, items: SuggestionItem[]) => {
    if (items.length === 0) return;
    setActionLoading(id);
    try {
      const res = await api.post(`/admin/ai/changes/${id}/approve`, {
        categories: items.map((s) => ({ name: s.name, display_name: s.display_name })),
      });
      message.success(`已通过 → ${res.data.category}`);
      fetchChanges(); fetchCounts();
    } catch (err) {
      message.error(errMessage(err));
    } finally {
      setActionLoading(null);
      setDetailChange(null);
    }
  };

  const handleReject = async (id: number) => {
    setActionLoading(id);
    try {
      await api.post(`/admin/ai/changes/${id}/reject`);
      message.success('已驳回');
      fetchChanges(); fetchCounts();
    } catch (err) {
      message.error(errMessage(err));
    } finally {
      setActionLoading(null);
      setDetailChange(null);
    }
  };

  const handleBulk = async (action: 'approve' | 'reject') => {
    if (selectedIds.length === 0) return;
    setBulkLoading(true);
    try {
      const res = await api.post('/admin/ai/changes/bulk', { ids: selectedIds, action });
      if (action === 'approve') {
        message.success(`批量通过：${res.data.approved} 条${res.data.failed ? `，失败 ${res.data.failed} 条` : ''}`);
      } else {
        message.success(`批量驳回：${res.data.affected} 条`);
      }
      setSelectedIds([]);
      fetchChanges(); fetchCounts();
    } catch (err) {
      message.error(errMessage(err));
    } finally {
      setBulkLoading(false);
    }
  };

  // Approve every pending change whose suggestions meet the chosen confidence
  // threshold (inclusive of higher tiers), across all pages.
  const handleApproveAll = async () => {
    setApproveAllLoading(true);
    try {
      const body: Record<string, string> = { confidence: approveAllConfidence };
      if (batchRunFilter) body.batch_run = batchRunFilter;
      const res = await api.post('/admin/ai/changes/approve-all', body);
      const { approved = 0, skipped = 0, failed = 0 } = res.data || {};
      message.success(
        `已通过 ${approved} 条` +
        (skipped ? `，未达置信度跳过 ${skipped} 条` : '') +
        (failed ? `，失败 ${failed} 条` : '')
      );
      setSelectedIds([]);
      fetchChanges(); fetchCounts();
    } catch (err) {
      message.error(errMessage(err));
    } finally {
      setApproveAllLoading(false);
    }
  };

  const columns = [
    {
      title: '语录',
      key: 'quote',
      ellipsis: true,
      render: (_: unknown, r: AIChange) => (
        <span>
          {r.quote_from && <Text type="secondary" style={{ marginRight: 6 }}>[{r.quote_from}]</Text>}
          <Tooltip title={r.quote_content}>{r.quote_content}</Tooltip>
        </span>
      ),
    },
    {
      title: '原分类',
      dataIndex: 'old_category',
      key: 'old_category',
      width: 90,
      render: (v: string) => <Tag>{v || '—'}</Tag>,
    },
    {
      title: 'AI 建议',
      key: 'suggestions',
      width: 240,
      render: (_: unknown, r: AIChange) => (
        <Space size={4} wrap>
          {(r.suggestions_list || []).map((s, i) => (
            <Tooltip key={i} title={`理由：${s.reason || '无'} · 置信度：${s.confidence}`}>
              <Tag color={i === 0 ? (s.is_new ? 'blue' : 'green') : 'default'} style={{ cursor: 'default' }}>
                {s.name}
                {s.display_name && s.display_name !== s.name ? `（${s.display_name}）` : ''}
                {s.is_new ? ' ✦' : ''}
                <span style={{ marginLeft: 4, fontSize: 10, color: confidenceColor[s.confidence] }}>
                  {s.confidence}
                </span>
              </Tag>
            </Tooltip>
          ))}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
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
      width: 170,
      render: (_: unknown, r: AIChange) => (
        <Space>
          {r.status === 'pending' && (
            <>
              <Button
                size="small" type="primary" icon={<CheckOutlined />}
                loading={actionLoading === r.id}
                onClick={() => {
                  if ((r.suggestions_list || []).length > 1) openDetail(r);
                  else handleApprove(r.id);
                }}
              >通过</Button>
              <Popconfirm title="驳回此 AI 建议？" onConfirm={() => handleReject(r.id)}>
                <Button size="small" danger icon={<CloseOutlined />} loading={actionLoading === r.id}>驳回</Button>
              </Popconfirm>
            </>
          )}
          <Button size="small" icon={<InfoCircleOutlined />} onClick={() => openDetail(r)} />
        </Space>
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

      <Card bodyStyle={{ padding: 0 }}>
        <div style={{ padding: '12px 16px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Select value={statusFilter} style={{ width: 120 }}
            onChange={(v) => { setStatusFilter(v); setPage(1); setSelectedIds([]); }}
            options={[
              { value: 'pending', label: '待审核' },
              { value: 'approved', label: '已通过' },
              { value: 'rejected', label: '已驳回' },
            ]}
          />
          {selectedIds.length > 0 && statusFilter === 'pending' && (
            <Space>
              <Button type="primary" size="small" loading={bulkLoading} onClick={() => handleBulk('approve')}>
                批量通过 ({selectedIds.length})
              </Button>
              <Popconfirm title={`批量驳回 ${selectedIds.length} 条？`} onConfirm={() => handleBulk('reject')}>
                <Button danger size="small" loading={bulkLoading}>批量驳回</Button>
              </Popconfirm>
              <Button size="small" onClick={() => setSelectedIds([])}>取消</Button>
            </Space>
          )}
          {selectedIds.length === 0 && statusFilter === 'pending' && (
            <Space size={6} wrap style={{ marginLeft: 'auto' }}>
              <span style={{ color: 'var(--surface-muted-text)', fontSize: 13 }}>按置信度通过全部：</span>
              <Select value={approveAllConfidence} size="small" style={{ width: 200 }}
                onChange={(v) => setApproveAllConfidence(v)}
                options={[
                  { value: 'high', label: '仅高置信度（high）' },
                  { value: 'medium', label: '中及以上（medium、high）' },
                  { value: 'low', label: '低及以上（low、medium、high）' },
                ]}
              />
              <Popconfirm
                title="通过全部达标变更"
                description={`将通过${batchRunFilter ? '本批次' : '全部'}待审核中、达到所选置信度的变更，并为语录分配所有达标分类。`}
                okText="确认通过" cancelText="取消"
                onConfirm={handleApproveAll}
              >
                <Button type="primary" size="small" loading={approveAllLoading}>通过全部达标</Button>
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
          scroll={{ x: 900 }}
          size="small"
        />
      </Card>

      {detailChange && (
        <Modal
          title="AI 分类详情"
          open
          onCancel={() => setDetailChange(null)}
          footer={null}
          width={600}
        >
          <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="语录内容">
              {detailChange.quote_from && <Text type="secondary">[{detailChange.quote_from}] </Text>}
              {detailChange.quote_content}
            </Descriptions.Item>
            <Descriptions.Item label="原分类">
              <Tag>{detailChange.old_category || '—'}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={statusColor[detailChange.status]}>{statusLabel[detailChange.status] || detailChange.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="时间">{dayjs(detailChange.created_at).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
          </Descriptions>

          <div style={{ fontWeight: 500, marginBottom: 8 }}>
            AI 给出的所有建议
            {detailChange.status === 'pending' && <span style={{ color: 'var(--surface-muted-text)', fontWeight: 400, fontSize: 12, marginLeft: 8 }}>勾选可一次性为该语录分配多个分类，或点「采纳」仅添加单个</span>}
          </div>
          <Space direction="vertical" style={{ width: '100%' }}>
            {(detailChange.suggestions_list || []).map((s, i) => {
              const checked = selectedSuggestions.includes(s.name);
              const toggle = () => setSelectedSuggestions((prev) =>
                prev.includes(s.name) ? prev.filter((n) => n !== s.name) : [...prev, s.name]
              );
              return (
              <div key={i} style={{
                padding: '10px 14px',
                border: `1px solid ${i === 0 ? 'var(--colorPrimary, #1677ff)' : 'var(--border-light, #e0e0e0)'}`,
                borderRadius: 6,
                background: i === 0 ? 'var(--blue-bg, #f0f7ff)' : undefined,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    {detailChange.status === 'pending' && (
                      <Checkbox checked={checked} onChange={toggle} style={{ marginTop: 2 }} />
                    )}
                    <div style={{ flex: 1 }}>
                    <Space size={4} wrap>
                      <Tag color={i === 0 ? (s.is_new ? 'blue' : 'green') : 'default'}>
                        {s.name}{s.is_new ? ' ✦' : ''}
                      </Tag>
                      {s.display_name && s.display_name !== s.name && (
                        <Tag color="default">{s.display_name}</Tag>
                      )}
                      <Tag color={confidenceColor[s.confidence] ?? 'default'}>
                        置信度：{s.confidence}
                      </Tag>
                      {s.is_new && <Tag color="volcano">新分类</Tag>}
                    </Space>
                    {s.reason && (
                      <div style={{ color: 'var(--surface-muted-text)', fontSize: 13, marginTop: 6 }}>
                        理由：{s.reason}
                      </div>
                    )}
                    </div>
                  </div>
                  {detailChange.status === 'pending' && (
                    <Button
                      type={i === 0 ? 'primary' : 'default'}
                      size="small"
                      style={{ marginLeft: 12, flexShrink: 0 }}
                      loading={actionLoading === detailChange.id}
                      onClick={() => handleApprove(detailChange.id, s.name, s.display_name)}
                    >
                      采纳
                    </Button>
                  )}
                </div>
              </div>
              );
            })}
          </Space>
          {detailChange.status === 'pending' && (
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Popconfirm title="驳回此 AI 建议？" onConfirm={() => handleReject(detailChange.id)}>
                <Button danger>驳回全部</Button>
              </Popconfirm>
              <Button
                type="primary"
                disabled={selectedSuggestions.length === 0}
                loading={actionLoading === detailChange.id}
                onClick={() => handleApproveMulti(
                  detailChange.id,
                  (detailChange.suggestions_list || []).filter((s) => selectedSuggestions.includes(s.name)),
                )}
              >
                采纳所选 ({selectedSuggestions.length})
              </Button>
              <Button onClick={() => setDetailChange(null)}>关闭</Button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AIChangesPage() {
  const [searchParams] = useSearchParams();
  const batchRunFromUrl = searchParams.get('batch_run') || '';
  const [activeTab, setActiveTab] = useState(batchRunFromUrl ? 'batch' : 'all');

  const tabs = [
    {
      key: 'all',
      label: '全部变更',
      children: <ChangeReviewPanel />,
    },
    {
      key: 'batch',
      label: '本次批次变更',
      children: <ChangeReviewPanel batchRunFilter={batchRunFromUrl || undefined} />,
      disabled: !batchRunFromUrl,
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>AI 分类审核</div>
        <div style={{ color: 'var(--surface-muted-text)', fontSize: 13 }}>
          所有 AI 分类建议均需人工审核后才会更新语录分类
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
