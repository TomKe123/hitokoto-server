import { useState, useEffect } from 'react';
import {
  Card, Row, Col, Tag, Typography, Empty, Spin, Grid, message, Pagination, Space, Button, Modal, Select, Divider,
} from 'antd';
import {
  UnlockOutlined, FolderAddOutlined, UserOutlined, PlusOutlined,
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

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [targetPublicList, setTargetPublicList] = useState<PublicListInfo | null>(null);
  const [userAggLists, setUserAggLists] = useState<UserAggList[]>([]);
  const [selectedAggListId, setSelectedAggListId] = useState<number | undefined>(undefined);
  const [addLoading, setAddLoading] = useState(false);
  const [aggListsLoading, setAggListsLoading] = useState(false);

  const fetchLists = () => {
    setLoading(true);
    api.get('/public/lists', { params: { page, page_size: pageSize } })
      .then((res) => {
        setLists((res.data.lists || []).filter((l: any) => l.item_count > 0 || l.reference_count > 0));;
        setTotal(res.data.total || 0);
      })
      .catch(() => message.error('加载公共列表失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchLists(); }, [page]);

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
      message.success(`已将「${targetPublicList.name}」添加到汇聚列表`);
      setAddModalOpen(false);
      setTargetPublicList(null);
      setSelectedAggListId(undefined);
    } catch (err: any) {
      message.error(err.response?.data?.error || '添加失败');
    } finally {
      setAddLoading(false);
    }
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
                actions={user ? [
                  <Button
                    key="add"
                    type="link"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={(e) => openAddModal(e, list)}
                  >
                    添加到汇聚列表
                  </Button>,
                ] : undefined}
              >
                <Card.Meta
                  title={
                    <Space size={4} style={{ flexWrap: 'wrap' }}>
                      <Text strong style={{ fontSize: 14 }}>{list.name}</Text>
                      <Tag icon={<UnlockOutlined />} color="blue" style={{ fontSize: 10, lineHeight: '16px', marginLeft: 2 }}>
                        公开
                      </Tag>
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
                      <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
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

      {/* Add to aggregated list modal */}
      <Modal
        title="添加到汇聚列表"
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
            将 <Text strong>{targetPublicList?.name}</Text> 添加到：
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
