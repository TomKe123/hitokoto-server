import { useState, useEffect } from 'react';
import {
  Typography, Spin, Card, List, Tag, Button, Space, Grid, message, Popconfirm, Switch, Modal,
  Input, Empty, Divider, Pagination, Select,
} from 'antd';
import {
  ArrowLeftOutlined, DeleteOutlined, LockOutlined, UnlockOutlined, KeyOutlined, CopyOutlined, ShareAltOutlined,
  FolderAddOutlined, PlusOutlined, LinkOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

interface ListData {
  list: {
    id: number;
    uuid: string;
    name: string;
    description: string;
    is_public: boolean;
    item_count: number;
    type: string;
    reference_count: number;
    created_at: string;
    updated_at: string;
  };
  items: ListItemData[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  list_tree?: ReferenceTreeNode[];
}

interface ReferenceTreeNode {
  list_id: number;
  list_name: string;
  list_uuid: string;
  type: string;
  children?: ReferenceTreeNode[];
}

interface ListItemData {
  id: number;
  quote_id: number;
  quote_uuid?: string;
  quote_content?: string;
  quote_from?: string;
  sort_order: number;
  source_list_id?: number;
  source_list_name?: string;
  source_list_uuid?: string;
  source_list_user_id?: number;
}

interface ReferenceData {
  id: number;
  target_list_id: number;
  target_name: string;
  target_uuid: string;
  created_at: string;
}

interface UserList {
  id: number;
  name: string;
  type: string;
  uuid: string;
}

export default function ListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const { user } = useAuth();

  const [data, setData] = useState<ListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editPublic, setEditPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [apiKeyText, setApiKeyText] = useState('');
  const [references, setReferences] = useState<ReferenceData[]>([]);
  const [refModalOpen, setRefModalOpen] = useState(false);
  const [addRefModalOpen, setAddRefModalOpen] = useState(false);
  const [targetListUuid, setTargetListUuid] = useState<string | undefined>(undefined);
  const [refLoading, setRefLoading] = useState(false);
  const [userLists, setUserLists] = useState<UserList[]>([]);
  const [userListsLoading, setUserListsLoading] = useState(false);

  const getItemsForList = (listId: number): ListItemData[] => {
    if (!data) return [];
    return data.items.filter((item) => item.source_list_id === listId);
  };

  const renderChildTree = (nodes: ReferenceTreeNode[], depth: number): React.ReactNode => {
    if (!nodes || nodes.length === 0) return null;
    const marginLeft = depth * 20;
    return (
      <div>
        {nodes.map((node) => {
          const listItems = getItemsForList(node.list_id);
          const hasChildren = node.children && node.children.length > 0;
          // Skip empty leaf nodes (no items and no children)
          if (listItems.length === 0 && !hasChildren) return null;
          return (
            <div key={node.list_id} style={{ marginLeft, marginBottom: 6 }}>
              <Card
                size="small"
                styles={{ body: { padding: '8px 12px' } }}
                title={
                  <Space size={4} style={{ fontSize: 13 }}>
                    <FolderAddOutlined style={{ color: '#722ed1', fontSize: 13 }} />
                    <Text strong style={{ fontSize: 13 }}>{node.list_name}</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>({listItems.length} 条)</Text>
                    {node.type === 'aggregated' && <Tag color="purple" style={{ fontSize: 10, lineHeight: '16px', marginLeft: 2 }}>汇聚</Tag>}
                  </Space>
                }
              >
                {listItems.length > 0 && (
                  <List
                    size="small"
                    dataSource={listItems}
                    renderItem={(item, index) => {
                      const canManage = item.source_list_user_id != null && item.source_list_user_id === user?.id;
                      return (
                        <List.Item
                          style={{ padding: '4px 0' }}
                          actions={canManage ? [
                            <Popconfirm
                              key="remove"
                              title="确定从来源列表中移除此语录？"
                              onConfirm={() => handleRemoveFromSource(node.list_id, item.id)}
                            >
                              <Button type="link" size="small" danger icon={<DeleteOutlined />} style={{ height: 20 }} />
                            </Popconfirm>,
                          ] : undefined}
                        >
                          <List.Item.Meta
                            style={{ marginBlock: 0 }}
                            title={
                              <Space size={4}>
                                <span style={{ color: '#999', fontWeight: 600, fontSize: 12 }}>{index + 1}.</span>
                                {item.quote_content
                                  ? <span style={{ fontSize: 13 }}>{item.quote_content}</span>
                                  : <Text italic type="secondary" style={{ fontSize: 13 }}>语录 #{item.quote_id}</Text>
                                }
                              </Space>
                            }
                            description={
                              <span style={{ fontSize: 12 }}>
                                {item.quote_from && <>—— {item.quote_from} · </>}
                                {item.quote_uuid && (
                                  <Text type="secondary" style={{ cursor: 'pointer', fontSize: 12 }} onClick={() => navigate(`/quotes/${item.quote_uuid}`)}>
                                    查看原文
                                  </Text>
                                )}
                              </span>
                            }
                          />
                        </List.Item>
                      );
                    }}
                  />
                )}
                {listItems.length === 0 && !hasChildren && (
                  <Text type="secondary" style={{ fontSize: 12 }}>此列表无语录</Text>
                )}
                {hasChildren && renderChildTree(node.children!, depth + 1)}
              </Card>
            </div>
          );
        })}
      </div>
    );
  };

  const fetchList = () => {
    if (!id) return;
    setLoading(true);
    api.get(`/lists/${id}`, { params: { page, page_size: pageSize } })
      .then((res) => setData(res.data))
      .catch(() => message.error('加载列表失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchList(); }, [id, page]);

  const fetchReferences = () => {
    if (!data) return;
    api.get(`/lists/${data.list.id}/references`)
      .then((res) => setReferences(res.data.references || []))
      .catch(() => message.error('加载引用列表失败'));
  };

  const handleAddReference = async () => {
    if (!data || !targetListUuid) return;
    setRefLoading(true);
    try {
      await api.post(`/lists/${data.list.id}/references`, { target_list_uuid: targetListUuid });
      message.success('引用添加成功');
      setAddRefModalOpen(false);
      setTargetListUuid(undefined);
      fetchReferences();
      fetchList();
    } catch (err: any) {
      message.error(err.response?.data?.error || '添加引用失败');
    } finally {
      setRefLoading(false);
    }
  };

  const handleRemoveReference = async (refId: number) => {
    if (!data) return;
    try {
      await api.delete(`/lists/${data.list.id}/references/${refId}`);
      message.success('引用已移除');
      fetchReferences();
      fetchList();
    } catch (err: any) {
      message.error(err.response?.data?.error || '移除引用失败');
    }
  };

  const fetchUserLists = (currentRefs: ReferenceData[]) => {
    setUserListsLoading(true);
    api.get('/lists')
      .then((res) => {
        const allLists: UserList[] = (res.data.lists || []).map((l: any) => ({
          id: l.id,
          name: l.name,
          type: l.type,
          uuid: l.uuid,
        }));
        // Filter out: the current list itself, and already referenced lists
        const referencedIds = new Set(currentRefs.map((r) => r.target_list_id));
        if (data) referencedIds.add(data.list.id);
        setUserLists(allLists.filter((l) => !referencedIds.has(l.id)));
      })
      .catch(() => message.error('加载列表失败'))
      .finally(() => setUserListsLoading(false));
  };

  const handleSave = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const body: any = {};
      if (editName !== data.list.name) body.name = editName;
      if (editDesc !== (data.list.description || '')) body.description = editDesc;
      if (editPublic !== data.list.is_public) body.is_public = editPublic;

      const res = await api.put(`/lists/${data.list.id}`, body);
      setEditing(false);
      message.success('列表已更新');

      if (editPublic === false && data.list.is_public && res.data.api_key) {
        setApiKeyText(res.data.api_key);
        setApiKeyModalOpen(true);
      }
      fetchList();
    } catch (err: any) {
      message.error(err.response?.data?.error || '更新失败');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveItem = async (itemId: number) => {
    if (!data) return;
    try {
      await api.delete(`/lists/${data.list.id}/items/${itemId}`);
      message.success('已移除');
      fetchList();
    } catch (err: any) {
      message.error(err.response?.data?.error || '移除失败');
    }
  };

  const handleRemoveFromSource = async (sourceListId: number, itemId: number) => {
    try {
      await api.delete(`/lists/${sourceListId}/items/${itemId}`);
      message.success('已从来源列表中移除');
      fetchList();
    } catch (err: any) {
      message.error(err.response?.data?.error || '移除失败');
    }
  };

  const handleRegenerateKey = async () => {
    if (!data) return;
    try {
      const res = await api.post(`/lists/${data.list.id}/regenerate-key`);
      setApiKeyText(res.data.api_key);
      setApiKeyModalOpen(true);
    } catch (err: any) {
      message.error(err.response?.data?.error || '重新生成失败');
    }
  };

  const copyApiKey = () => {
    navigator.clipboard.writeText(apiKeyText);
    message.success('API Key 已复制');
  };

  const shareUrl = data ? `${window.location.origin}/shared/${data.list.uuid}` : '';

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '80px 0' }}><Spin size="large" /></div>;
  }

  if (!data) {
    return <Empty description="列表不存在" />;
  }

  const { list } = data;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/lists')}>
          返回列表
        </Button>
      </div>

      {/* List Info */}
      <Card style={{ marginBottom: 16 }}>
        {editing ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="名称" />
            <Input.TextArea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={2} placeholder="描述" />
            <Space>
              <Text>公开列表：</Text>
              <Switch
                checked={editPublic}
                onChange={setEditPublic}
                checkedChildren={<UnlockOutlined />}
                unCheckedChildren={<LockOutlined />}
              />
            </Space>
            <Space>
              <Button onClick={() => setEditing(false)}>取消</Button>
              <Button type="primary" loading={saving} onClick={handleSave}>保存</Button>
            </Space>
          </Space>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <Title level={4} style={{ margin: 0 }}>
                  {list.name}
                  <Tag icon={list.is_public ? <UnlockOutlined /> : <LockOutlined />} color={list.is_public ? 'blue' : 'orange'} style={{ marginLeft: 8 }}>
                    {list.is_public ? '公开' : '私有'}
                  </Tag>
                  {list.type === 'aggregated' && (
                    <Tag icon={<FolderAddOutlined />} color="purple" style={{ marginLeft: 4 }}>汇聚</Tag>
                  )}
                </Title>
                <Text type="secondary">{list.description || '暂无描述'}</Text>
                <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
                  {list.type === 'aggregated'
                    ? `引用 ${list.reference_count} 个列表 · 创建于 ${dayjs(list.created_at).format('YYYY-MM-DD')}`
                    : `共 ${list.item_count} 条语录 · 创建于 ${dayjs(list.created_at).format('YYYY-MM-DD')}`
                  }
                </div>
              </div>
              <Space>
                <Button size="small" onClick={() => {
                  setEditing(true);
                  setEditName(list.name);
                  setEditDesc(list.description || '');
                  setEditPublic(list.is_public);
                }}>编辑</Button>
                {!list.is_public && (
                  <Button size="small" icon={<KeyOutlined />} onClick={handleRegenerateKey}>重设 Key</Button>
                )}
              </Space>
            </div>
            <Divider />
            <Space>
              <Button icon={<ShareAltOutlined />} onClick={() => {
                navigator.clipboard.writeText(shareUrl);
                message.success('分享链接已复制');
              }} size="small">
                复制分享链接
              </Button>
              {!list.is_public && (
                <Button icon={<KeyOutlined />} size="small" onClick={() => {
                  setApiKeyText('需要重新生成以查看');
                  handleRegenerateKey();
                }}>
                  获取 API Key
                </Button>
              )}
              {list.type === 'aggregated' && (
                <Button icon={<PlusOutlined />} size="small" onClick={() => {
                  fetchReferences();
                  setRefModalOpen(true);
                }}>
                  管理引用
                </Button>
              )}
            </Space>
          </div>
        )}
      </Card>

      {/* Items */}
      <Title level={5}>
        {list.type === 'aggregated' ? '汇聚语录' : '语录列表'}
      </Title>
      {data.items.length === 0 ? (
        <Empty description={list.type === 'aggregated' ? '此汇聚列表暂无语录，请添加引用' : '此列表暂无语录'} />
      ) : list.type === 'aggregated' ? (
        /* Aggregated: root items flat + child lists as compact tree */
        <>
          {(() => {
            const rootItems = data.items.filter((i) => i.source_list_id === list.id);
            return rootItems.length > 0 ? (
              <List
                size="small"
                dataSource={rootItems}
                renderItem={(item, index) => (
                  <List.Item
                    style={{ padding: '4px 0' }}
                    actions={[
                      <Popconfirm
                        key="remove"
                        title="确定移除此语录？"
                        onConfirm={() => handleRemoveItem(item.id)}
                      >
                        <Button type="link" size="small" danger icon={<DeleteOutlined />} style={{ height: 20 }} />
                      </Popconfirm>,
                    ]}
                  >
                    <List.Item.Meta
                      style={{ marginBlock: 0 }}
                      title={
                        <Space size={4}>
                          <span style={{ color: '#999', fontWeight: 600, fontSize: 12 }}>{index + 1}.</span>
                          {item.quote_content
                            ? <span style={{ fontSize: 13 }}>{item.quote_content}</span>
                            : <Text italic type="secondary" style={{ fontSize: 13 }}>语录 #{item.quote_id}</Text>
                          }
                        </Space>
                      }
                      description={
                        <span style={{ fontSize: 12 }}>
                          {item.quote_from && <>—— {item.quote_from} · </>}
                          {item.quote_uuid && (
                            <Text type="secondary" style={{ cursor: 'pointer', fontSize: 12 }} onClick={() => navigate(`/quotes/${item.quote_uuid}`)}>
                              查看原文
                            </Text>
                          )}
                        </span>
                      }
                    />
                  </List.Item>
                )}
              />
            ) : null;
          })()}
          {data.list_tree && data.list_tree.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {renderChildTree(data.list_tree, 0)}
            </div>
          )}
          {data.items.length === 0 && (
            <Empty description="此汇聚列表暂无语录，请添加引用" />
          )}
          {data.items.length > 0 && (
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <Pagination
                current={data.page}
                total={data.total}
                pageSize={data.page_size}
                onChange={(p) => setPage(p)}
                showTotal={(total) => `共 ${total} 条`}
                responsive
                size="small"
              />
            </div>
          )}
        </>
      ) : (
        /* Normal list: flat list */
        <>
          <List
            dataSource={data.items}
            renderItem={(item, index) => (
              <List.Item
                actions={[
                  <Popconfirm
                    key="remove"
                    title="确定移除此语录？"
                    onConfirm={() => handleRemoveItem(item.id)}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />}>移除</Button>
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      <span style={{ color: '#999', fontWeight: 600 }}>
                        {(data.page - 1) * data.page_size + index + 1}
                      </span>
                      {item.quote_content
                        ? <span>{item.quote_content}</span>
                        : <Text italic type="secondary">语录 #{item.quote_id}</Text>
                      }
                    </Space>
                  }
                  description={
                    <span>
                      {item.quote_from && <>—— {item.quote_from} · </>}
                      {item.quote_uuid && (
                        <Text
                          type="secondary"
                          style={{ cursor: 'pointer' }}
                          onClick={() => navigate(`/quotes/${item.quote_uuid}`)}
                        >
                          查看原文
                        </Text>
                      )}
                    </span>
                  }
                />
              </List.Item>
            )}
          />
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <Pagination
              current={data.page}
              total={data.total}
              pageSize={data.page_size}
              onChange={(p) => setPage(p)}
              showTotal={(total) => `共 ${total} 条`}
              responsive
              size={isMobile ? 'small' : undefined}
            />
          </div>
        </>
      )}

      {/* Reference Management Modal */}
      <Modal
        title="管理引用列表"
        open={refModalOpen}
        onCancel={() => { setRefModalOpen(false); }}
        footer={null}
        width={520}
        destroyOnClose
      >
        {references.length === 0 ? (
          <Empty description="暂无引用的列表" />
        ) : (
          <List
            dataSource={references}
            renderItem={(ref) => (
              <List.Item
                actions={[
                  <Popconfirm
                    key="remove"
                    title="确定移除此引用？"
                    onConfirm={() => handleRemoveReference(ref.id)}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />}>移除</Button>
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  avatar={<LinkOutlined style={{ fontSize: 18, color: '#722ed1' }} />}
                  title={ref.target_name || `列表 #${ref.target_list_id}`}
                  description={`ID: ${ref.target_list_id} · 添加于 ${dayjs(ref.created_at).format('YYYY-MM-DD')}`}
                />
              </List.Item>
            )}
          />
        )}
        <Divider />
        <Button type="dashed" block icon={<PlusOutlined />} onClick={() => {
          fetchUserLists(references);
          setAddRefModalOpen(true);
        }}>
          添加引用
        </Button>
      </Modal>

      {/* Add Reference Modal */}
      <Modal
        title="添加引用"
        open={addRefModalOpen}
        onCancel={() => { setAddRefModalOpen(false); setTargetListUuid(undefined); }}
        onOk={handleAddReference}
        confirmLoading={refLoading}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text strong>从你的列表中选择：</Text>
          <Select
            style={{ width: '100%' }}
            placeholder="请选择列表"
            loading={userListsLoading}
            value={userLists.some((l) => l.uuid === targetListUuid) ? targetListUuid : undefined}
            onChange={(val) => setTargetListUuid(val)}
            showSearch
            optionFilterProp="label"
            allowClear
          >
            {userLists.map((l) => (
              <Select.Option key={l.uuid} value={l.uuid} label={`${l.name} (${l.uuid.slice(0, 8)}...)`}>
                <Space>
                  {l.name}
                  <Text type="secondary" style={{ fontSize: 12 }}>ID: {l.id}</Text>
                  {l.type === 'aggregated' && <Tag color="purple" style={{ fontSize: 10, lineHeight: '16px' }}>汇聚</Tag>}
                </Space>
              </Select.Option>
            ))}
          </Select>
          {userLists.length === 0 && !userListsLoading && (
            <Text type="warning">没有可添加的列表（所有列表已被引用或是当前列表本身）</Text>
          )}

          <Divider style={{ margin: '8px 0' }} />
          <Text strong>或输入其他用户的公开列表 UUID：</Text>
          <Input
            style={{ width: '100%', fontFamily: 'monospace' }}
            placeholder="列表的 UUID (例如：xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)"
            value={userLists.some((l) => l.uuid === targetListUuid) ? '' : targetListUuid}
            onChange={(e) => {
              const val = e.target.value.trim();
              if (val) setTargetListUuid(val);
              else setTargetListUuid(undefined);
            }}
            allowClear
          />
          <Text type="secondary">
            你可以引用自己拥有的列表，也可以引用其他用户的<strong>公开列表</strong>。输入列表的 UUID 来引用他人的公开列表。
          </Text>
        </Space>
      </Modal>

      {/* API Key Modal */}
      <Modal
        title="API Key"
        open={apiKeyModalOpen}
        onCancel={() => { setApiKeyModalOpen(false); setApiKeyText(''); }}
        footer={
          <Space>
            <Button onClick={() => { setApiKeyModalOpen(false); setApiKeyText(''); }}>关闭</Button>
            <Button type="primary" icon={<CopyOutlined />} onClick={copyApiKey}>复制 Key</Button>
          </Space>
        }
      >
        <div style={{ marginBottom: 12 }}>
          <Text type="warning" strong>
            ⚠️ 此 API Key 仅在此刻显示一次，请立即保存！
          </Text>
        </div>
        <Input.TextArea
          value={apiKeyText}
          readOnly
          rows={2}
          style={{ fontFamily: 'monospace', fontSize: 13 }}
          onClick={(e) => (e.target as HTMLTextAreaElement).select()}
        />
      </Modal>
    </div>
  );
}
