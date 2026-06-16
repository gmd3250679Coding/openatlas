import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Tree,
  Typography,
  message,
} from 'antd';
import type { DataNode } from 'antd/es/tree';
import {
  createAdminUser,
  createOrgUnit,
  deleteAdminUser,
  deleteOrgUnit,
  fetchAdminUsers,
  fetchAdminUserDetail,
  fetchAdminTenantIsolation,
  fetchIdentityOverview,
  fetchMe,
  fetchOrgUnits,
  fetchPermissionMatrix,
  fetchTenants,
  moveAdminUsersOrg,
  patchPermissionMatrix,
  patchTenant,
  patchAdminUser,
  patchOrgUnit,
} from '../services/api';

type TenantRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  plan: string;
  user_count?: number;
  org_unit_count?: number;
  employee_count?: number;
  session_count?: number;
  max_sessions?: number | null;
  max_employees?: number | null;
  runtime?: {
    status?: string;
    port?: number;
    gateway_base_url?: string;
    hermes_home?: string;
    health_checked_at?: string | null;
  };
};

type OrgRow = {
  id: string;
  tenant_id: string;
  parent_id?: string | null;
  name: string;
  code: string;
  description?: string;
  status: string;
  sort_order: number;
  user_count?: number;
  child_count?: number;
};

type UserRow = {
  id: string;
  tenant_id: string;
  tenant_name?: string;
  org_unit_id?: string | null;
  org_unit_name?: string;
  email: string;
  username: string;
  role: string;
  is_active: boolean;
  created_at?: string;
  last_login_at?: string | null;
};

type PermissionCapability = {
  key: string;
  label: string;
  group: string;
  allowed: boolean;
  default_allowed: boolean;
  overridden: boolean;
};

type PermissionRole = {
  role: string;
  label: string;
  capabilities: PermissionCapability[];
};

const ROLE_LABEL: Record<string, string> = {
  system_admin: '系统管理员',
  tenant_admin: '租户管理员',
  user: '普通用户',
};

const ROLE_COLOR: Record<string, string> = {
  system_admin: 'purple',
  tenant_admin: 'blue',
  user: 'default',
};

function buildOrgTree(rows: OrgRow[]): DataNode[] {
  const byParent = new Map<string, OrgRow[]>();
  rows.forEach((row) => {
    const key = row.parent_id || 'root';
    byParent.set(key, [...(byParent.get(key) || []), row]);
  });
  const walk = (parent: string): DataNode[] => (byParent.get(parent) || [])
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map((row) => ({
      key: row.id,
      title: `${row.name} (${row.user_count || 0})`,
      children: walk(row.id),
    }));
  return walk('root');
}

function fmtDate(v?: string | null) {
  if (!v) return '-';
  return new Date(v).toLocaleString('zh-CN', { hour12: false });
}

export default function IdentityAdmin() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [me, setMe] = useState<any>(null);
  const [overview, setOverview] = useState<any>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | undefined>();
  const [userSearch, setUserSearch] = useState('');
  const [orgModalOpen, setOrgModalOpen] = useState(false);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [tenantModalOpen, setTenantModalOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<OrgRow | null>(null);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [editingTenant, setEditingTenant] = useState<TenantRow | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [moveTargetOrgId, setMoveTargetOrgId] = useState<string | undefined>();
  const [userDetail, setUserDetail] = useState<any>(null);
  const [userDetailOpen, setUserDetailOpen] = useState(false);
  const [tenantIsolation, setTenantIsolation] = useState<any>(null);
  const [tenantIsolationOpen, setTenantIsolationOpen] = useState(false);
  const [permissionMatrix, setPermissionMatrix] = useState<{ roles: PermissionRole[]; capabilities: any[]; tenant_id?: string | null } | null>(null);
  const [orgForm] = Form.useForm();
  const [userForm] = Form.useForm();
  const [tenantForm] = Form.useForm();

  const currentTenantId = me?.tenant?.id || me?.user?.tenant_id;
  const isSystemAdmin = me?.user?.role === 'system_admin' || me?.role === 'system_admin';

  const loadAll = async () => {
    setLoading(true);
    try {
      const meRow = await fetchMe();
      setMe(meRow);
      const [overviewRow, tenantRows, orgRows, userRows] = await Promise.all([
        fetchIdentityOverview(),
        fetchTenants(),
        fetchOrgUnits(),
        fetchAdminUsers(),
      ]);
      setOverview(overviewRow);
      setTenants(tenantRows);
      setOrgs(orgRows);
      setUsers(userRows);
      fetchPermissionMatrix().then(setPermissionMatrix).catch(() => undefined);
    } catch (err: any) {
      message.error(err?.message || '加载组织权限失败');
    } finally {
      setLoading(false);
    }
  };

  const reloadOrgAndUsers = async () => {
    const [overviewRow, orgRows, userRows, tenantRows] = await Promise.all([
      fetchIdentityOverview(),
      fetchOrgUnits(),
      fetchAdminUsers({ org_unit_id: selectedOrgId, q: userSearch }),
      fetchTenants(),
    ]);
    setOverview(overviewRow);
    setOrgs(orgRows);
    setUsers(userRows);
    setTenants(tenantRows);
    fetchPermissionMatrix().then(setPermissionMatrix).catch(() => undefined);
  };

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (loading) return;
    fetchAdminUsers({ org_unit_id: selectedOrgId, q: userSearch })
      .then(setUsers)
      .catch((err) => message.error(err?.message || '刷新用户失败'));
  }, [selectedOrgId, userSearch]);

  const orgTree = useMemo(() => buildOrgTree(orgs), [orgs]);
  const orgOptions = useMemo(() => orgs.map((o) => ({ label: `${o.name} · ${o.code}`, value: o.id })), [orgs]);
  const tenantOptions = useMemo(() => tenants.map((t) => ({ label: `${t.name} · ${t.slug}`, value: t.id })), [tenants]);

  const orgById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs]);

  const openCreateOrg = () => {
    setEditingOrg(null);
    orgForm.setFieldsValue({ parent_id: selectedOrgId, status: 'active', sort_order: 0, tenant_id: currentTenantId });
    setOrgModalOpen(true);
  };

  const openEditOrg = (row: OrgRow) => {
    setEditingOrg(row);
    orgForm.setFieldsValue(row);
    setOrgModalOpen(true);
  };

  const saveOrg = async () => {
    const values = await orgForm.validateFields();
    setSaving(true);
    try {
      if (editingOrg) await patchOrgUnit(editingOrg.id, values);
      else await createOrgUnit(values);
      message.success(editingOrg ? '组织已更新' : '组织已创建');
      setOrgModalOpen(false);
      await reloadOrgAndUsers();
    } catch (err: any) {
      message.error(err?.message || '保存组织失败');
    } finally {
      setSaving(false);
    }
  };

  const moveOrg = async (row: OrgRow, direction: -1 | 1) => {
    try {
      await patchOrgUnit(row.id, { sort_order: Math.max(0, (row.sort_order || 0) + direction) });
      await reloadOrgAndUsers();
    } catch (err: any) {
      message.error(err?.message || '调整组织排序失败');
    }
  };

  const handleOrgDrop = async (info: any) => {
    const draggedId = String(info.dragNode.key);
    const targetId = String(info.node.key);
    const dragged = orgById.get(draggedId);
    const target = orgById.get(targetId);
    if (!dragged || !target || dragged.id === target.id) return;
    const parentId = info.dropToGap ? (target.parent_id || null) : target.id;
    try {
      await patchOrgUnit(dragged.id, {
        parent_id: parentId,
        sort_order: Math.max(0, (target.sort_order || 0) + (info.dropPosition > 0 ? 1 : 0)),
      });
      message.success('组织结构已调整');
      await reloadOrgAndUsers();
    } catch (err: any) {
      message.error(err?.message || '移动组织失败');
    }
  };

  const openCreateUser = () => {
    setEditingUser(null);
    userForm.setFieldsValue({
      tenant_id: currentTenantId,
      org_unit_id: selectedOrgId,
      role: 'user',
      is_active: true,
      password: 'openatlas123',
    });
    setUserModalOpen(true);
  };

  const openEditTenant = (row: TenantRow) => {
    setEditingTenant(row);
    tenantForm.setFieldsValue({
      name: row.name,
      status: row.status,
      plan: row.plan,
      max_sessions: row.max_sessions,
      max_employees: row.max_employees,
    });
    setTenantModalOpen(true);
  };

  const saveTenant = async () => {
    if (!editingTenant) return;
    const values = await tenantForm.validateFields();
    setSaving(true);
    try {
      await patchTenant(editingTenant.id, values);
      message.success('租户配置已更新');
      setTenantModalOpen(false);
      await reloadOrgAndUsers();
    } catch (err: any) {
      message.error(err?.message || '保存租户失败');
    } finally {
      setSaving(false);
    }
  };

  const openTenantIsolation = async (row: TenantRow) => {
    setTenantIsolationOpen(true);
    setTenantIsolation(null);
    try {
      setTenantIsolation(await fetchAdminTenantIsolation(row.id));
    } catch (err: any) {
      message.error(err?.message || '加载隔离证据失败');
    }
  };

  const openEditUser = (row: UserRow) => {
    setEditingUser(row);
    userForm.setFieldsValue({ ...row, password: undefined });
    setUserModalOpen(true);
  };

  const openUserDetail = async (row: UserRow) => {
    setUserDetailOpen(true);
    setUserDetail(null);
    try {
      setUserDetail(await fetchAdminUserDetail(row.id));
    } catch (err: any) {
      message.error(err?.message || '加载用户详情失败');
    }
  };

  const saveUser = async () => {
    const values = await userForm.validateFields();
    setSaving(true);
    try {
      const body = editingUser
        ? Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== ''))
        : values;
      if (editingUser) await patchAdminUser(editingUser.id, body);
      else await createAdminUser(body);
      message.success(editingUser ? '用户已更新' : '用户已创建');
      setUserModalOpen(false);
      await reloadOrgAndUsers();
    } catch (err: any) {
      message.error(err?.message || '保存用户失败');
    } finally {
      setSaving(false);
    }
  };

  const moveSelectedUsers = async () => {
    if (!selectedUserIds.length) {
      message.warning('请先选择用户');
      return;
    }
    setSaving(true);
    try {
      await moveAdminUsersOrg({ user_ids: selectedUserIds, org_unit_id: moveTargetOrgId || null });
      message.success(`已迁移 ${selectedUserIds.length} 个用户`);
      setSelectedUserIds([]);
      setMoveTargetOrgId(undefined);
      await reloadOrgAndUsers();
    } catch (err: any) {
      message.error(err?.message || '迁移组织失败');
    } finally {
      setSaving(false);
    }
  };

  const togglePermission = async (role: string, capability: string, allowed: boolean) => {
    setSaving(true);
    try {
      const updated = await patchPermissionMatrix({ role, capability, allowed });
      setPermissionMatrix(updated);
      message.success('权限策略已更新');
    } catch (err: any) {
      message.error(err?.message || '更新权限失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 60, textAlign: 'center' }}><Spin /></div>;
  }

  return (
    <div className="atlas-page identity-admin-page">
      <div className="identity-admin-header">
        <div>
          <h1 className="atlas-page-title">组织与权限</h1>
          <p className="atlas-page-desc">管理租户、组织架构、系统用户与企业权限边界。</p>
        </div>
        <Space>
          <Button onClick={loadAll}>刷新</Button>
          <Button type="primary" onClick={openCreateUser}>邀请用户</Button>
        </Space>
      </div>

      <div className="atlas-stats identity-admin-stats">
        <div className="atlas-stat">
          <span className="atlas-stat-label">租户</span>
          <span className="atlas-stat-value">{overview?.tenants ?? tenants.length}</span>
          <span className="atlas-stat-delta up">{isSystemAdmin ? '全局视图' : '当前租户'}</span>
        </div>
        <div className="atlas-stat">
          <span className="atlas-stat-label">组织节点</span>
          <span className="atlas-stat-value">{overview?.org_units ?? orgs.length}</span>
          <span className="atlas-stat-delta up">含部门/团队</span>
        </div>
        <div className="atlas-stat">
          <span className="atlas-stat-label">用户</span>
          <span className="atlas-stat-value">{overview?.users ?? users.length}</span>
          <span className="atlas-stat-delta up">{overview?.active_users ?? users.filter((u) => u.is_active).length} 活跃</span>
        </div>
        <div className="atlas-stat">
          <span className="atlas-stat-label">当前角色</span>
          <span className="atlas-stat-value identity-admin-role-value">{ROLE_LABEL[me?.user?.role] || me?.user?.role || '-'}</span>
          <span className="atlas-stat-delta up">{me?.tenant?.name || '-'}</span>
        </div>
      </div>

      <Tabs
        className="identity-admin-tabs"
        items={[
          {
            key: 'tenants',
            label: '租户管理',
            children: (
              <Table
                rowKey="id"
                dataSource={tenants}
                pagination={false}
                columns={[
                  {
                    title: '租户',
                    dataIndex: 'name',
                    render: (_: any, row: TenantRow) => (
                      <div>
                        <strong>{row.name}</strong>
                        <div className="identity-muted">{row.slug}</div>
                      </div>
                    ),
                  },
                  { title: '状态', dataIndex: 'status', render: (v: string) => <Tag color={v === 'active' ? 'green' : 'orange'}>{v}</Tag> },
                  { title: '套餐', dataIndex: 'plan', render: (v: string) => <Tag color="blue">{v}</Tag> },
                  {
                    title: '资源',
                    render: (_: any, row: TenantRow) => (
                      <Space size={4} wrap>
                        <Tag>用户 {row.user_count ?? 0}</Tag>
                        <Tag>组织 {row.org_unit_count ?? 0}</Tag>
                        <Tag>员工 {row.employee_count ?? 0}</Tag>
                        <Tag>会话 {row.session_count ?? 0}</Tag>
                      </Space>
                    ),
                  },
                  {
                    title: 'Runtime',
                    render: (_: any, row: TenantRow) => (
                      <div>
                        <Tag color={row.runtime?.status === 'running' ? 'green' : 'default'}>{row.runtime?.status || 'none'}</Tag>
                        <span className="identity-muted">{row.runtime?.port ? `:${row.runtime.port}` : '-'}</span>
                      </div>
                    ),
                  },
                  {
                    title: '隔离目录',
                    render: (_: any, row: TenantRow) => <span className="identity-path">{row.runtime?.hermes_home || '-'}</span>,
                  },
                  {
                    title: '操作',
                    render: (_: any, row: TenantRow) => (
                      <Space>
                        <Button size="small" onClick={() => openTenantIsolation(row)}>隔离</Button>
                        <Button size="small" onClick={() => openEditTenant(row)} disabled={!isSystemAdmin}>编辑</Button>
                      </Space>
                    ),
                  },
                ]}
              />
            ),
          },
          {
            key: 'orgs',
            label: '组织管理',
            children: (
              <div className="identity-split">
                <div className="identity-tree-panel">
                  <div className="identity-panel-title">组织树</div>
                  <Tree
                    treeData={orgTree}
                    defaultExpandAll
                    draggable
                    blockNode
                    selectedKeys={selectedOrgId ? [selectedOrgId] : []}
                    onSelect={(keys) => setSelectedOrgId(keys[0] as string | undefined)}
                    onDrop={handleOrgDrop}
                  />
                  <Button style={{ marginTop: 12 }} onClick={() => setSelectedOrgId(undefined)}>查看全部</Button>
                </div>
                <div className="identity-table-panel">
                  <div className="identity-toolbar">
                    <div>
                      <strong>组织节点</strong>
                      <div className="identity-muted">支持拖拽调整层级，也可编辑编码、状态、排序和成员归属。</div>
                    </div>
                    <Button type="primary" onClick={openCreateOrg}>新增组织</Button>
                  </div>
                  <Table
                    rowKey="id"
                    dataSource={selectedOrgId ? orgs.filter((o) => o.id === selectedOrgId || o.parent_id === selectedOrgId) : orgs}
                    pagination={{ pageSize: 8 }}
                    columns={[
                      { title: '名称', dataIndex: 'name' },
                      { title: '编码', dataIndex: 'code', render: (v: string) => <span className="identity-code">{v}</span> },
                      { title: '状态', dataIndex: 'status', render: (v: string) => <Tag color={v === 'active' ? 'green' : 'default'}>{v}</Tag> },
                      { title: '成员', dataIndex: 'user_count' },
                      { title: '子节点', dataIndex: 'child_count' },
                      {
                        title: '操作',
                        render: (_: any, row: OrgRow) => (
                          <Space>
                            <Button size="small" onClick={() => openEditOrg(row)}>编辑</Button>
                            <Button size="small" onClick={() => moveOrg(row, -1)}>上移</Button>
                            <Button size="small" onClick={() => moveOrg(row, 1)}>下移</Button>
                            <Popconfirm title="确认删除该组织？" onConfirm={async () => {
                              try {
                                await deleteOrgUnit(row.id);
                                message.success('组织已删除');
                                await reloadOrgAndUsers();
                              } catch (err: any) {
                                message.error(err?.message || '删除失败');
                              }
                            }}>
                              <Button size="small" danger disabled={(row.user_count || 0) > 0 || (row.child_count || 0) > 0}>删除</Button>
                            </Popconfirm>
                          </Space>
                        ),
                      },
                    ]}
                  />
                </div>
              </div>
            ),
          },
          {
            key: 'users',
            label: '用户管理',
            children: (
              <>
                <div className="identity-toolbar">
                  <Space>
                    <Input.Search
                      allowClear
                      placeholder="搜索姓名或邮箱"
                      style={{ width: 260 }}
                      onSearch={setUserSearch}
                      onChange={(e) => !e.target.value && setUserSearch('')}
                    />
                    <Select
                      allowClear
                      placeholder="按组织筛选"
                      style={{ width: 260 }}
                      options={orgOptions}
                      value={selectedOrgId}
                      onChange={setSelectedOrgId}
                    />
                  </Space>
                  <Space wrap>
                    <Select
                      allowClear
                      placeholder="迁移到组织"
                      style={{ width: 220 }}
                      options={orgOptions}
                      value={moveTargetOrgId}
                      onChange={setMoveTargetOrgId}
                    />
                    <Button disabled={!selectedUserIds.length} loading={saving} onClick={moveSelectedUsers}>
                      迁移选中
                    </Button>
                    <Button type="primary" onClick={openCreateUser}>邀请用户</Button>
                  </Space>
                </div>
                {selectedUserIds.length > 0 && (
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message={`已选择 ${selectedUserIds.length} 个用户，可批量迁移到新的组织节点。`}
                  />
                )}
                <Table
                  rowKey="id"
                  dataSource={users}
                  rowSelection={{
                    selectedRowKeys: selectedUserIds,
                    onChange: (keys) => setSelectedUserIds(keys.map(String)),
                    getCheckboxProps: (row: UserRow) => ({ disabled: row.id === me?.user?.id }),
                  }}
                  pagination={{ pageSize: 10 }}
                  columns={[
                    {
                      title: '用户',
                      render: (_: any, row: UserRow) => (
                        <div>
                          <strong>{row.username}</strong>
                          <div className="identity-muted">{row.email}</div>
                        </div>
                      ),
                    },
                    { title: '组织', dataIndex: 'org_unit_name', render: (v: string) => v || '-' },
                    { title: '角色', dataIndex: 'role', render: (v: string) => <Tag color={ROLE_COLOR[v]}>{ROLE_LABEL[v] || v}</Tag> },
                    { title: '状态', dataIndex: 'is_active', render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? '启用' : '停用'}</Tag> },
                    { title: '最近登录', dataIndex: 'last_login_at', render: fmtDate },
                    {
                      title: '操作',
                      render: (_: any, row: UserRow) => (
                        <Space>
                          <Button size="small" onClick={() => openUserDetail(row)}>详情</Button>
                          <Button size="small" onClick={() => openEditUser(row)}>编辑</Button>
                          <Button size="small" onClick={async () => {
                            try {
                              await patchAdminUser(row.id, { is_active: !row.is_active });
                              message.success(row.is_active ? '用户已停用' : '用户已启用');
                              await reloadOrgAndUsers();
                            } catch (err: any) {
                              message.error(err?.message || '更新失败');
                            }
                          }}>
                            {row.is_active ? '停用' : '启用'}
                          </Button>
                          <Popconfirm title="确认移除该用户？历史会话和审计会保留。" onConfirm={async () => {
                            try {
                              await deleteAdminUser(row.id);
                              message.success('用户已移除');
                              await reloadOrgAndUsers();
                            } catch (err: any) {
                              message.error(err?.message || '移除失败');
                            }
                          }}>
                            <Button size="small" danger disabled={!row.is_active}>移除</Button>
                          </Popconfirm>
                        </Space>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
          {
            key: 'matrix',
            label: '权限矩阵',
            children: (
              <>
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message="权限矩阵采用默认角色能力 + 租户覆盖项。开关会落库并写入审计，后续可接入接口级鉴权。"
                />
                <Table
                  rowKey="key"
                  pagination={false}
                  dataSource={permissionMatrix?.capabilities || []}
                  columns={[
                    { title: '能力域', dataIndex: 'group', width: 120, render: (v: string) => <Tag>{v}</Tag> },
                    { title: '能力', dataIndex: 'label' },
                    ...((permissionMatrix?.roles || []).map((role) => ({
                      title: role.label,
                      render: (_: any, cap: any) => {
                        const item = role.capabilities.find((c) => c.key === cap.key);
                        return (
                          <Space>
                            <Switch
                              size="small"
                              checked={!!item?.allowed}
                              disabled={saving || (role.role === 'system_admin' && !isSystemAdmin)}
                              onChange={(checked) => togglePermission(role.role, cap.key, checked)}
                            />
                            {item?.overridden && <Tag color="purple">已覆盖</Tag>}
                          </Space>
                        );
                      },
                    }))),
                  ]}
                />
              </>
            ),
          },
        ]}
      />

      <Modal
        title={editingOrg ? '编辑组织' : '新增组织'}
        open={orgModalOpen}
        onCancel={() => setOrgModalOpen(false)}
        onOk={saveOrg}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={orgForm} layout="vertical">
          {isSystemAdmin && <Form.Item name="tenant_id" label="租户"><Select options={tenantOptions} /></Form.Item>}
          <Form.Item name="parent_id" label="上级组织"><Select allowClear options={orgOptions.filter((o) => o.value !== editingOrg?.id)} /></Form.Item>
          <Form.Item name="name" label="组织名称" rules={[{ required: true, message: '请输入组织名称' }]}><Input /></Form.Item>
          <Form.Item name="code" label="组织编码"><Input placeholder="如 SALES / HR / OPS" /></Form.Item>
          <Form.Item name="description" label="说明"><Input.TextArea rows={3} /></Form.Item>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="status" label="状态" style={{ width: '50%' }}><Select options={[{ label: '启用', value: 'active' }, { label: '停用', value: 'disabled' }]} /></Form.Item>
            <Form.Item name="sort_order" label="排序" style={{ width: '50%' }}><InputNumber style={{ width: '100%' }} /></Form.Item>
          </Space.Compact>
        </Form>
      </Modal>

      <Modal
        title={editingUser ? '编辑用户' : '邀请用户'}
        open={userModalOpen}
        onCancel={() => setUserModalOpen(false)}
        onOk={saveUser}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={userForm} layout="vertical">
          {isSystemAdmin && <Form.Item name="tenant_id" label="租户"><Select options={tenantOptions} /></Form.Item>}
          <Form.Item name="org_unit_id" label="所属组织"><Select allowClear options={orgOptions} /></Form.Item>
          {!editingUser && <Form.Item name="email" label="邮箱" rules={[{ required: true, message: '请输入邮箱' }]}><Input /></Form.Item>}
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}><Input /></Form.Item>
          <Form.Item name="password" label={editingUser ? '重置密码' : '初始密码'} rules={editingUser ? [] : [{ required: true, message: '请输入初始密码' }]}><Input.Password placeholder={editingUser ? '留空则不修改' : ''} /></Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select options={[
              ...(isSystemAdmin ? [{ label: '系统管理员', value: 'system_admin' }] : []),
              { label: '租户管理员', value: 'tenant_admin' },
              { label: '普通用户', value: 'user' },
            ]} />
          </Form.Item>
          <Form.Item name="is_active" label="账号启用" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑租户"
        open={tenantModalOpen}
        onCancel={() => setTenantModalOpen(false)}
        onOk={saveTenant}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={tenantForm} layout="vertical">
          <Form.Item name="name" label="租户名称" rules={[{ required: true, message: '请输入租户名称' }]}>
            <Input />
          </Form.Item>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="status" label="状态" style={{ width: '50%' }}>
              <Select options={[
                { label: '启用', value: 'active' },
                { label: '暂停', value: 'suspended' },
                { label: '归档', value: 'archived' },
              ]} />
            </Form.Item>
            <Form.Item name="plan" label="套餐" style={{ width: '50%' }}>
              <Select options={[
                { label: 'Trial', value: 'free' },
                { label: 'Starter', value: 'starter' },
                { label: 'Standard', value: 'professional' },
                { label: 'Enterprise', value: 'enterprise' },
                { label: 'Isolation Smoke', value: 'isolation-smoke' },
              ]} />
            </Form.Item>
          </Space.Compact>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="max_sessions" label="会话上限" style={{ width: '50%' }}>
              <InputNumber min={0} style={{ width: '100%' }} placeholder="不填为不限" />
            </Form.Item>
            <Form.Item name="max_employees" label="员工上限" style={{ width: '50%' }}>
              <InputNumber min={0} style={{ width: '100%' }} placeholder="不填为不限" />
            </Form.Item>
          </Space.Compact>
        </Form>
      </Modal>

      <Drawer
        title="用户详情"
        width={560}
        open={userDetailOpen}
        onClose={() => setUserDetailOpen(false)}
      >
        {!userDetail ? (
          <Spin />
        ) : (
          <Space direction="vertical" size={18} style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="用户名">{userDetail.user?.username}</Descriptions.Item>
              <Descriptions.Item label="邮箱">{userDetail.user?.email}</Descriptions.Item>
              <Descriptions.Item label="租户">{userDetail.user?.tenant_name}</Descriptions.Item>
              <Descriptions.Item label="组织">{userDetail.user?.org_unit_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="角色">
                <Tag color={ROLE_COLOR[userDetail.user?.role]}>{ROLE_LABEL[userDetail.user?.role] || userDetail.user?.role}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={userDetail.user?.is_active ? 'green' : 'red'}>{userDetail.user?.is_active ? '启用' : '停用'}</Tag>
              </Descriptions.Item>
            </Descriptions>

            <div className="identity-evidence-grid">
              {[
                ['会话', userDetail.counts?.sessions],
                ['文件', userDetail.counts?.files],
                ['记忆', userDetail.counts?.memories],
                ['Skill 绑定', userDetail.counts?.skill_bindings],
                ['审计事件', userDetail.counts?.audit_events],
              ].map(([label, value]) => (
                <div className="identity-evidence-card" key={String(label)}>
                  <span>{label}</span>
                  <strong>{value ?? 0}</strong>
                </div>
              ))}
            </div>

            <div>
              <div className="identity-panel-title">最近会话</div>
              {userDetail.recent_sessions?.length ? (
                <List
                  size="small"
                  dataSource={userDetail.recent_sessions}
                  renderItem={(item: any) => (
                    <List.Item>
                      <List.Item.Meta
                        title={item.title}
                        description={`${item.task_status || '-'} · ${item.message_count || 0} 条 · ${fmtDate(item.updated_at)}`}
                      />
                    </List.Item>
                  )}
                />
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
            </div>

            <div>
              <div className="identity-panel-title">最近审计</div>
              {userDetail.recent_audits?.length ? (
                <List
                  size="small"
                  dataSource={userDetail.recent_audits}
                  renderItem={(item: any) => (
                    <List.Item>
                      <List.Item.Meta
                        title={<Typography.Text code>{item.action}</Typography.Text>}
                        description={`${item.resource_type || '-'} · ${fmtDate(item.created_at)}`}
                      />
                    </List.Item>
                  )}
                />
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
            </div>
          </Space>
        )}
      </Drawer>

      <Drawer
        title="租户隔离验证"
        width={640}
        open={tenantIsolationOpen}
        onClose={() => setTenantIsolationOpen(false)}
      >
        {!tenantIsolation ? (
          <Spin />
        ) : (
          <Space direction="vertical" size={18} style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="租户">{tenantIsolation.tenant?.name} / {tenantIsolation.tenant?.slug}</Descriptions.Item>
              <Descriptions.Item label="Runtime">{tenantIsolation.tenant?.runtime?.status || 'none'} {tenantIsolation.tenant?.runtime?.port ? `:${tenantIsolation.tenant.runtime.port}` : ''}</Descriptions.Item>
              <Descriptions.Item label="Hermes Home"><Typography.Text copyable>{tenantIsolation.paths?.hermes_home}</Typography.Text></Descriptions.Item>
              <Descriptions.Item label="文件根目录"><Typography.Text copyable>{tenantIsolation.paths?.upload_root}</Typography.Text></Descriptions.Item>
              <Descriptions.Item label="Gateway"><Typography.Text copyable>{tenantIsolation.paths?.runtime_base_url || '-'}</Typography.Text></Descriptions.Item>
            </Descriptions>

            <div className="identity-evidence-grid">
              {Object.entries(tenantIsolation.counts || {}).map(([key, value]) => (
                <div className="identity-evidence-card" key={key}>
                  <span>{key}</span>
                  <strong>{String(value)}</strong>
                </div>
              ))}
            </div>

            <div>
              <div className="identity-panel-title">隔离检查</div>
              <List
                dataSource={tenantIsolation.checks || []}
                renderItem={(item: any) => (
                  <List.Item>
                    <List.Item.Meta
                      title={<Space><Tag color={item.status === 'ok' ? 'green' : 'orange'}>{item.status}</Tag>{item.label}</Space>}
                      description={<Typography.Text type="secondary">{item.detail}</Typography.Text>}
                    />
                  </List.Item>
                )}
              />
            </div>
          </Space>
        )}
      </Drawer>
    </div>
  );
}
