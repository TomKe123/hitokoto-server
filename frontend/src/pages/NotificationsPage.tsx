import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  List, Typography, Tag, Button, Spin, Pagination, Empty, message, Grid,
} from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, BellOutlined,
} from '@ant-design/icons';
import api from '../utils/api';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Text, Title } = Typography;
const { useBreakpoint } = Grid;

interface Notification {
  id: number;
  user_id: number;
  quote_uuid: string;
  type: 'approved' | 'rejected';
  title: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const fetchNotifications = () => {
    setLoading(true);
    api.get('/notifications', { params: { page, page_size: pageSize } })
      .then((res) => {
        setNotifications(res.data.notifications || []);
        setTotal(res.data.total || 0);
        setUnreadCount(res.data.unread_count || 0);
      })
      .catch(() => message.error('加载通知失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchNotifications();
  }, [page, pageSize]);

  const handleMarkAllRead = () => {
    api.put('/notifications/read-all')
      .then(() => {
        message.success('已全部标为已读');
        setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
        setUnreadCount(0);
      })
      .catch(() => message.error('操作失败'));
  };

  const handleClick = (notif: Notification) => {
    if (!notif.is_read) {
      api.put(`/notifications/${notif.id}/read`).catch(() => {});
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }
    // Rejected notifications navigate to edit page for resubmission
    if (notif.type === 'rejected') {
      navigate(`/quotes/${notif.quote_uuid}/edit`);
    } else {
      navigate(`/quotes/${notif.quote_uuid}`);
    }
  };

  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          <BellOutlined style={{ marginRight: 8 }} />
          消息通知
        </Title>
        {unreadCount > 0 && (
          <Button size="small" onClick={handleMarkAllRead}>
            全部标为已读
          </Button>
        )}
      </div>

      {loading ? (
        <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />
      ) : notifications.length === 0 ? (
        <Empty description="暂无通知" style={{ marginTop: 80 }} />
      ) : (
        <List
          dataSource={notifications}
          renderItem={(item) => (
            <List.Item
              style={{
                cursor: 'pointer',
                background: item.is_read ? '#fff' : '#f6f0ff',
                padding: '12px 16px',
                borderRadius: 8,
                marginBottom: 4,
                transition: 'background 0.2s',
              }}
              onClick={() => handleClick(item)}
            >
              <List.Item.Meta
                avatar={
                  item.type === 'approved' ? (
                    <CheckCircleOutlined style={{ fontSize: 22, color: '#52c41a', marginTop: 4 }} />
                  ) : (
                    <CloseCircleOutlined style={{ fontSize: 22, color: '#ff4d4f', marginTop: 4 }} />
                  )
                }
                title={
                  <span>
                    {item.title}
                    {!item.is_read && (
                      <Tag color="purple" style={{ marginLeft: 8, fontSize: 10 }}>未读</Tag>
                    )}
                  </span>
                }
                description={
                  <div>
                    <Text style={{ fontSize: 13, color: '#666' }}>{item.content}</Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {dayjs(item.created_at).fromNow()}
                    </Text>
                  </div>
                }
              />
            </List.Item>
          )}
        />
      )}

      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <Pagination
          current={page}
          total={total}
          pageSize={pageSize}
          onChange={(p, ps) => { setPage(p); setPageSize(ps); }}
          showTotal={(t) => `共 ${t} 条`}
          showSizeChanger
          pageSizeOptions={['10', '20', '50']}
          responsive
          size={isMobile ? 'small' : undefined}
        />
      </div>
    </div>
  );
}
