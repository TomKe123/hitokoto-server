import { useState, useEffect } from 'react';
import {
  Card, Row, Col, Tag, Typography, Empty, Spin, Grid, message, Pagination, Space, Button, Modal, Select, Divider, Input, Popconfirm,
} from 'antd';
import {
  UnlockOutlined, FolderAddOutlined, UserOutlined, PlusOutlined, DeleteOutlined, LockOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

interface PublicListInfo {
  id: number;
  uuid: string;
  name: string;
  description: string;
  is_public: boolean;
  blocked: boolean;
  item_count: number;
  type: string;
  owner: string;
  created_at: string;
  updated_at: string;
}

interface UserAggList {
  id: number;
  name: string;
}

export default function PublicListsPage() {
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const { user } = useAuth();

  const [lists, setLists] = useState<PublicListInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTrigger, setSearchTrigger] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [targetPublicList, setTargetPublicList] = useState<PublicListInfo | null>(null);
  const [userAggLists, setUserAggLists] = useState<UserAggList[]>([]);
  const [selectedAggListId, setSelectedAggListId] = useState<number | undefined>(undefined);
  const [addLoading, setAddLoading] = useState(false);
  const [aggListsLoading, setAggListsLoading] = useState(false);

  // Admin management
  const isAdmin = user?.role === 'admin';
  const [blockTarget, setBlockTarget] = useState<PublicListInfo | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const [blockModalOpen, setBlockModalOpen] = useState(false);
  const [blockingSubmit, setBlockingSubmit] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const fetchLists = () => {
    setLoading(true);
    if (searchTrigger) {
      api.get('/public/lists/search', { params: { q: searchTrigger, page, page_size: pageSize } })
        .then((res) => {
          setLists(res.data.lists || []);
          setTotal(res.data.total || 0);
          setIsSearching(true);
        })
        .catch(() => message.error('搜索失败'))
        .finally(() => setLoading(false));
    } else {
      api.get('/public/lists', { params: { page, page_size: pageSize } })
        .then((res) => {
          setLists((res.data.lists || []).filter((l: any) => l.item_count > 0 || l.reference_count > 0));
          setTotal(res.data.total || 0);
          setIsSearching(false);
        })
        .catch(() => message.error('加载公共列表失败'))
        .finally(() => setLoading(false));
    }
  };

  useEffect(() => { fetchLists(); }, [page, searchTrigger]);

  const openAddModal = (e: React.MouseEvent, targetList: PublicListInfo) => {
    e.stopPropagation();
    if (!user) {
      message.info('请先登录');
      navigate('/login');
      return;
    }
    setTargetPublicList(targetList);
    setSelectedAggListId(undefined);
    setAddModalOpen(true);
    setAggListsLoading(true);
    api.get('/lists')
      .then((res) => {
        const allLists: UserAggList[] = (res.data.lists || [])
          .filter((l: any) => l.type === 'aggregated')
          .map((l: any) => ({ id: l.id, name: l.name }));
        setUserAggLists(allLists);
        if (allLists.length === 0) {
          message.info('你还没有汇聚列表，请先创建一个');
        }
      })
      .catch(() => message.error('加载列表失败'))
      .finally(() => setAggListsLoading(false));
  };

  const handleAddReference = async () => {
    if (!targetPublicList || !selectedAggListId) return;
    setAddLoading(true);
    try {
      await api.post(`/lists/${selectedAggListId}/references`, {
        target_list_uuid: targetPublicList.uuid,
      });
      message.success(`已将「${targetPublicList.name}」添加为引用`);
      setAddModalOpen(false);
      setTargetPublicList(null);
      setSelectedAggListId(undefined);
    } catch (err: any) {
      message.error(err.response?.data?.error || '添加失败');
    } finally {
      setAddLoading(false);
    }
  };

  // Admin action helpers
  const handleUnblock = (id: number) => {
    setActionLoading(id);
    api.put(`/admin/lists/${id}/unblock`)
      .then(() => {
        message.success('列表已解封');
        fetchLists();
      })
      .catch((err: any) => message.error(err.response?.data?.error || '解封失败'))
      .finally(() => setActionLoading(null));
  };

  const handleDeleteList = (id: number) => {
    setActionLoading(id);
    api.delete(`/admin/lists/${id}`)
      .then(() => {
        message.success('列表已删除');
        fetchLists();
      })
      .catch((err: any) => message.error(err.response?.data?.error || '删除失败'))
      .finally(() => setActionLoading(null));
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 0' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>公共列表</Title>
        <Text type="secondary">浏览所有用户分享的公开列表</Text>
        <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
          <Input.Search
            placeholder="搜索列表名称..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); if (!e.target.value) { setSearchTrigger(''); setPage(1); } }}
            onSearch={(value) => { setSearchQuery(value); setSearchTrigger(value); setPage(1); }}
            style={{ maxWidth: 300 }}
            allowClear
          />
          {isSearching && (
            <Button onClick={() => { setSearchQuery(''); setSearchTrigger(''); setPage(1); }}>清除搜索</Button>
          )}
        </div>
      </div>

      {lists.length === 0 ? (
        <Empty description="暂无公开列表" />
      ) : (
        <Row gutter={[16, 16]}>
          {lists.map((list) => (
            <Col xs={24} sm={12} lg={8} key={list.uuid}>
              <Card
                hoverable
                onClick={() => navigate(`/shared/${list.uuid}`)}
                style={{ height: '100%' }}
                styles={{ body: { padding: 16 } }}
                actions={
                  user
                    ? [
                        <Button
                          key="add"
                          type="link"
                          size="small"
                          icon={<PlusOutlined />}
                          onClick={(e) => openAddModal(e, list)}
                        >
                          添加引用
                        </Button>,
                        ...(isAdmin ? [
                          list.blocked ? (
                            <Button
                              key="unblock"
                              type="link"
                              size="small"
                              style={{ color: '#52c41a' }}
                              loading={actionLoading === list.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUnblock(list.id);
                              }}
                            >
                              解封
                            </Button>
                          ) : (
                            <Button
                              key="block"
                              type="link"
                              size="small"
                              icon={<LockOutlined />}
                              onClick={(e) => {
                                e.stopPropagation();
                                setBlockTarget(list);
                                setBlockReason('');
                                setBlockModalOpen(true);
                              }}
                            >
                              屏蔽
                            </Button>
                          ),
                          <Popconfirm
                            key="delete"
                            title="确定删除此列表？"
                            description="此操作不可恢复"
                            onConfirm={() => handleDeleteList(list.id)}
                            okText="删除"
                            cancelText="取消"
                            okButtonProps={{ danger: true }}
                          >
                            <Button
                              type="link"
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              loading={actionLoading === list.id}
                              onClick={(e) => e.stopPropagation()}
                            >
                              删除
                            </Button>
                          </Popconfirm>,
                        ] : []),
                      ]
                    : undefined
                }
              >
                <Card.Meta
                  title={
                    <Space size={4} style={{ flexWrap: 'wrap' }}>
                      <Text strong style={{ fontSize: 14, color: list.blocked ? '#ff4d4f' : undefined }}>
                        {list.blocked ? '🔇 ' : ''}{list.name}
                      </Text>
                      {list.blocked ? (
                        <Tag color="red" style={{ fontSize: 10, lineHeight: '16px' }}>已屏蔽</Tag>
                      ) : (
                        <Tag icon={<UnlockOutlined />} color="blue" style={{ fontSize: 10, lineHeight: '16px' }}>
                          公开
                        </Tag>
                      )}
                      {list.type === 'aggregated' && (
                        <Tag icon={<FolderAddOutlined />} color="purple" style={{ fontSize: 10, lineHeight: '16px' }}>汇聚</Tag>
                      )}
                    </Space>
                  }
                  description={
                    <div>
                      <Text type="secondary" style={{ fontSize: 13 }}>
                        {list.description || '暂无描述'}
                      </Text>
                      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--surface-muted-text)' }}>
                        <UserOutlined style={{ marginRight: 4 }} />
                        {list.owner || '未知'} · {list.item_count} 条语录
                      </div>
                    </div>
                  }
                />
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {total > pageSize && (
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <Pagination
            current={page}
            total={total}
            pageSize={pageSize}
            onChange={(p) => setPage(p)}
            showTotal={(total) => `共 ${total} 个列表`}
            responsive
            size={isMobile ? 'small' : undefined}
          />
        </div>
      )}

      {/* Block list modal (admin) */}
      <Modal
        title={`屏蔽列表 - ${blockTarget?.name || ''}`}
        open={blockModalOpen}
        onCancel={() => { setBlockModalOpen(false); setBlockReason(''); }}
        onOk={async () => {
          if (!blockTarget) return;
          setBlockingSubmit(true);
          try {
            await api.put(`/admin/lists/${blockTarget.id}/block`, { reason: blockReason });
            message.success('列表已屏蔽');
            setBlockModalOpen(false);
            fetchLists();
          } catch (err: any) {
            message.error(err.response?.data?.error || '屏蔽失败');
          } finally {
            setBlockingSubmit(false);
          }
        }}
        confirmLoading={blockingSubmit}
        okText="确认屏蔽"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <div style={{ marginTop: 16 }}>
          <div style={{ background: 'var(--error-bg)', border: '1px solid var(--error-border)', borderRadius: 6, padding: 12, marginBottom: 16 }}>
            屏蔽后该列表将无法通过公开链接访问，列表所有者将收到通知。
          </div>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>屏蔽原因（选填）</div>
          <Input.TextArea
            value={blockReason}
            onChange={(e) => setBlockReason(e.target.value)}
            placeholder="输入屏蔽原因，将随通知发送给列表所有者"
            maxLength={500}
            rows={3}
          />
        </div>
      </Modal>

      {/* Add to aggregated list modal */}
      <Modal
        title="添加引用"
        open={addModalOpen}
        onCancel={() => { setAddModalOpen(false); setTargetPublicList(null); setSelectedAggListId(undefined); }}
        onOk={handleAddReference}
        confirmLoading={addLoading}
        okText="添加"
        okButtonProps={{ disabled: !selectedAggListId }}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text>
            将 <Text strong>{targetPublicList?.name}</Text> 添加为引用：
          </Text>
          <Select
            style={{ width: '100%' }}
            placeholder="选择你的汇聚列表"
            loading={aggListsLoading}
            value={selectedAggListId}
            onChange={(val) => setSelectedAggListId(val)}
            showSearch
            optionFilterProp="label"
          >
            {userAggLists.map((l) => (
              <Select.Option key={l.id} value={l.id} label={l.name}>
                {l.name}
              </Select.Option>
            ))}
          </Select>
          {userAggLists.length === 0 && !aggListsLoading && (
            <Text type="warning">你还没有汇聚列表，请先在"我的列表"中创建一个</Text>
          )}
          <Divider />
          <Text type="secondary" style={{ fontSize: 12 }}>
            系统会自动处理循环引用和重复语录。
          </Text>
        </Space>
      </Modal>
    </div>
  );
}
