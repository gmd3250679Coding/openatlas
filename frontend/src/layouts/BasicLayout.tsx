import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  DashboardOutlined, TeamOutlined,
  FileSearchOutlined, HistoryOutlined, ControlOutlined,
  ScheduleOutlined, ToolOutlined, ShopOutlined, BookOutlined, FundOutlined,
  SunOutlined, MoonOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined,
  ApartmentOutlined,
} from '@ant-design/icons';
import { useTheme } from '../main';
import { useAuth } from '../contexts/AuthContext';

const navItems = [
  { key: '/overview', icon: <DashboardOutlined />, label: '工作台' },
  { key: '/workforce', icon: <TeamOutlined />, label: '数智员工' },
  { key: '/jobs', icon: <ScheduleOutlined />, label: '自动任务' },
  { key: '/skills', icon: <ToolOutlined />, label: '技能中心' },
  { key: '/memory', icon: <BookOutlined />, label: '记忆中心' },
];

const adminOnlyItems = [
  { key: '/dashboard', icon: <FundOutlined />, label: 'Dashboard' },
  { key: '/identity', icon: <ApartmentOutlined />, label: '组织权限' },
  { key: '/skill-market', icon: <ShopOutlined />, label: '技能市场' },
  { key: '/audit', icon: <FileSearchOutlined />, label: '审计日志' },
];

const userManageItems = [
  { key: '/history', icon: <HistoryOutlined />, label: '对话历史' },
  { key: '/settings', icon: <ControlOutlined />, label: '设置' },
];

export default function BasicLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isDark, toggle } = useTheme();
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const manageItems = [...(user?.is_admin ? adminOnlyItems : []), ...userManageItems];

  // Ensure data-theme is applied to the layout element on mount/changes,
  // so all CSS-variable-driven children render correctly even before
  // first toggle.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const pageLabel = [...navItems, ...adminOnlyItems, ...userManageItems]
    .find(n => location.pathname.startsWith(n.key))?.label || '详情';

  return (
    <div className="app-layout" data-theme={isDark ? 'dark' : 'light'}>
      {/* Sidebar */}
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">A</div>
          <div className="sidebar-brand">Atlas</div>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-section">
            {!collapsed && <div className="nav-section-title">平台</div>}
            {navItems.map(item => (
              <div
                key={item.key}
                className={`nav-item ${location.pathname === item.key ? 'active' : ''}`}
                onClick={() => navigate(item.key)}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </div>
            ))}
          </div>
          <div className="nav-section">
            {!collapsed && <div className="nav-section-title">管理中心</div>}
            {manageItems.map(item => (
              <div
                key={item.key}
                className={`nav-item nav-sub ${location.pathname === item.key ? 'active' : ''}`}
                onClick={() => navigate(item.key)}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </div>
            ))}
          </div>
        </nav>
      </aside>

      {/* Main */}
      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button className="topbar-toggle" onClick={() => setCollapsed(!collapsed)}>
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </button>
            <div className="topbar-breadcrumb">
              Atlas / <span>{pageLabel}</span>
            </div>
          </div>
          <div className="topbar-right">
            <div className="topbar-status">
              <span className="dot" />
              Runtime healthy
            </div>
            <button className="topbar-btn" onClick={toggle}>
              {isDark ? <SunOutlined /> : <MoonOutlined />}
            </button>
          </div>
        </header>
        <div className="page-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
