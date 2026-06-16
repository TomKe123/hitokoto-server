import { useState, useCallback } from 'react';
import { Button, Select, Input, Tag, Space, Typography } from 'antd';
import { PlusOutlined, DeleteOutlined, FolderAddOutlined } from '@ant-design/icons';

const { Text } = Typography;

/* ── Types ── */
export interface Condition {
  type: 'condition';
  keyword: string;
}

export interface ConditionGroup {
  type: 'group';
  logic: 'AND' | 'OR';
  items: (Condition | ConditionGroup)[];
}

export type ConditionItem = Condition | ConditionGroup;

/* ── Flatten groups into search_group[] for the API ── */
export function flattenToSearchGroups(item: ConditionItem): string[] {
  if (item.type === 'condition') {
    const kw = item.keyword.trim();
    return kw ? [kw] : [];
  }

  // group
  const groups = item.items.map(flattenToSearchGroups).filter((g) => g.length > 0);

  if (groups.length === 0) return [];

  if (item.logic === 'AND') {
    // Each sub-group becomes a separate search_group (AND'd)
    return groups.map((g) => g.join(' '));
  }

  // OR — all terms go into the same group (OR'd together)
  return [groups.flat().join(' ')];
}

/* ── Recursive QueryBuilder ── */
function QueryBuilderItem({
  item,
  onChange,
  onDelete,
  depth,
}: {
  item: ConditionItem;
  onChange: (item: ConditionItem) => void;
  onDelete?: () => void;
  depth: number;
}) {
  const addCondition = useCallback(() => {
    if (item.type !== 'group') return;
    const newItem: Condition = { type: 'condition', keyword: '' };
    onChange({ ...item, items: [...item.items, newItem] });
  }, [item, onChange]);

  const addSubGroup = useCallback(() => {
    if (item.type !== 'group') return;
    const newGroup: ConditionGroup = { type: 'group', logic: 'AND', items: [] };
    onChange({ ...item, items: [...item.items, newGroup] });
  }, [item, onChange]);

  if (item.type === 'condition') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Input
          size="small"
          placeholder="输入关键词"
          value={item.keyword}
          onChange={(e) => onChange({ ...item, keyword: e.target.value })}
          style={{ width: 160 }}
          allowClear
        />
        {onDelete && (
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={onDelete}
            style={{ flexShrink: 0 }}
          />
        )}
      </div>
    );
  }

  // group
  const isRoot = !onDelete;
  const isEmpty = item.items.length === 0;

  return (
    <div
      style={{
        border: depth === 0 ? 'none' : '1px solid #e8e8e8',
        borderRadius: 8,
        padding: depth === 0 ? 0 : '8px',
        background: depth === 0 ? 'transparent' : '#fafafa',
      }}
    >
      {/* Group header */}
      {!isRoot && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <Select
            size="small"
            value={item.logic}
            onChange={(v) => onChange({ ...item, logic: v })}
            style={{ width: 70 }}
            options={[
              { value: 'AND', label: 'AND' },
              { value: 'OR', label: 'OR' },
            ]}
          />
          <Tag style={{ margin: 0, fontSize: 11, color: '#999', background: 'transparent', border: 'none', padding: 0 }}>
            子组
          </Tag>
          <div style={{ flex: 1 }} />
          {onDelete && (
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={onDelete}
              style={{ flexShrink: 0 }}
            />
          )}
        </div>
      )}

      {isEmpty && (
        <Text type="secondary" style={{ fontSize: 12, display: 'block', padding: '4px 0' }}>
          暂无条件
        </Text>
      )}

      {/* Items */}
      {item.items.map((child, idx) => (
        <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Connector label */}
          {idx > 0 && (
            <div style={{ paddingLeft: depth === 0 && item.items[idx-1]?.type === 'group' ? 0 : 0 }}>
              <Tag
                color={item.logic === 'AND' ? 'blue' : 'orange'}
                style={{ fontSize: 11, lineHeight: '18px', margin: '4px 0' }}
              >
                {item.logic}
              </Tag>
            </div>
          )}

          <div style={{ paddingLeft: child.type === 'group' ? 0 : 0 }}>
            <QueryBuilderItem
              item={child}
              onChange={(updated) => {
                const next = [...item.items];
                next[idx] = updated;
                onChange({ ...item, items: next });
              }}
              onDelete={
                item.items.length > 1 || isRoot
                  ? () => {
                      const next = item.items.filter((_, i) => i !== idx);
                      onChange({ ...item, items: next });
                    }
                  : undefined
              }
              depth={depth + 1}
            />
          </div>
        </div>
      ))}

      {/* Add buttons */}
      <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
        <Button size="small" icon={<PlusOutlined />} onClick={addCondition}>
          关键词
        </Button>
        <Button size="small" icon={<FolderAddOutlined />} onClick={addSubGroup}>
          子组
        </Button>
      </div>
    </div>
  );
}

/* ── Exported QueryBuilder component ── */
export default function QueryBuilder({
  value,
  onChange,
}: {
  value: ConditionGroup;
  onChange: (v: ConditionGroup) => void;
}) {
  return <QueryBuilderItem item={value} onChange={onChange} depth={0} />;
}
