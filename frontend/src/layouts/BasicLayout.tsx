import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  DashboardOutlined, TeamOutlined,
  FileSearchOutlined, HistoryOutlined, ControlOutlined,
  ScheduleOutlined, ToolOutlined, ShopOutlined, BookOutlined, FundOutlined,
  SunOutlined, MoonOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined,
  ApartmentOutlined,
  BulbOutlined,
  FileProtectOutlined,
  FilePptOutlined,
  FileWordOutlined,
} from '@ant-design/icons';
import { useTheme } from '../main';
import { useAuth } from '../contexts/AuthContext';

const navItems = [
  { key: '/overview', icon: <DashboardOutlined />, label: '工作台' },
  { key: '/workforce', icon: <TeamOutlined />, label: '数智员工' },
  { key: '/whiteboard', icon: <BulbOutlined />, label: '创意白板' },
  { key: '/presentation-canvas', icon: <FilePptOutlined />, label: 'AIPPT' },
  { key: '/official-writing', icon: <FileWordOutlined />, label: '公文写作' },
  { key: '/contract-review', icon: <FileProtectOutlined />, label: '合同审核' },
  { key: '/skills', icon: <ToolOutlined />, label: '技能中心' },
];

const adminOnlyItems = [
  { key: '/dashboard', icon: <FundOutlined />, label: 'Dashboard' },
  { key: '/identity', icon: <ApartmentOutlined />, label: '组织权限' },
  { key: '/jobs', icon: <ScheduleOutlined />, label: '自动任务' },
  { key: '/memory', icon: <BookOutlined />, label: '记忆中心' },
  { key: '/audit', icon: <FileSearchOutlined />, label: '审计日志' },
  { key: '/settings', icon: <ControlOutlined />, label: '设置' },
];

const userManageItems = [
  { key: '/skill-market', icon: <ShopOutlined />, label: '技能市场' },
  { key: '/history', icon: <HistoryOutlined />, label: '对话历史' },
];

export default function BasicLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isDark, toggle } = useTheme();
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= 768;
  });
  const platformItems = navItems;
  const manageItems = user?.is_admin ? [...adminOnlyItems, ...userManageItems] : userManageItems;
  const isMobileNavOpen = typeof window !== 'undefined' && window.innerWidth <= 768 && !collapsed;

  // Ensure data-theme is applied to the layout element on mount/changes,
  // so all CSS-variable-driven children render correctly even before
  // first toggle.
  useEffect(() => {
    const theme = isDark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
  }, [isDark]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth <= 768) setCollapsed(true);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const navigateFromSidebar = (path: string) => {
    navigate(path);
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      setCollapsed(true);
    }
  };

  const pageLabel = [...platformItems, ...adminOnlyItems, ...userManageItems]
    .find(n => location.pathname.startsWith(n.key))?.label || '详情';

  return (
    <div className="app-layout" data-theme={isDark ? 'dark' : 'light'}>
      {isMobileNavOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="关闭侧边导航"
          onClick={() => setCollapsed(true)}
        />
      )}
      {/* Sidebar */}
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">A</div>
          <div className="sidebar-brand">Atlas</div>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-section">
            {!collapsed && <div className="nav-section-title">平台</div>}
            {platformItems.map(item => (
              <div
                key={item.key}
                className={`nav-item ${location.pathname === item.key ? 'active' : ''}`}
                onClick={() => navigateFromSidebar(item.key)}
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
                onClick={() => navigateFromSidebar(item.key)}
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
            <button
              className="topbar-toggle"
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? '展开侧边导航' : '收起侧边导航'}
              title={collapsed ? '展开侧边导航' : '收起侧边导航'}
            >
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
            <button
              className="topbar-btn"
              onClick={toggle}
              aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'}
              title={isDark ? '切换到浅色模式' : '切换到深色模式'}
            >
              {isDark ? <SunOutlined /> : <MoonOutlined />}
            </button>
          </div>
        </header>
        <div className={`page-content ${location.pathname.startsWith('/contract-review') || location.pathname.startsWith('/official-writing') || location.pathname.startsWith('/presentation-canvas') ? 'page-content--contained' : ''}`}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
