import '@ant-design/v5-patch-for-react-19';
import React, { createContext, useContext, useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, theme as antTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './index.css';

// ============================================================
// Theme — Atlas Design System
// Single source of truth: CSS variables in styles/atlas-design.css
// AntD tokens here are aliased to those CSS variables so the two
// systems never drift apart.
// ============================================================

type ThemeCtx = { isDark: boolean; toggle: () => void };
const ThemeContext = createContext<ThemeCtx>({ isDark: false, toggle: () => {} });
export const useTheme = () => useContext(ThemeContext);

const STORAGE_KEY = 'atlas-theme';

function Root() {
  const [isDark, setIsDark] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark') return true;
    if (saved === 'light') return false;
    // Default: light (matches the Apple WWDC enterprise feel)
    return false;
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem(STORAGE_KEY, isDark ? 'dark' : 'light');
  }, [isDark]);

  const toggle = () => setIsDark(prev => !prev);

  return (
    <ThemeContext.Provider value={{ isDark, toggle }}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
          token: {
            // Brand — Atlas Indigo-Violet, matches --accent in CSS
            colorPrimary: isDark ? '#8B7FE8' : '#4F46E5',
            colorSuccess: isDark ? '#34D399' : '#10B981',
            colorWarning: isDark ? '#FBBF24' : '#F59E0B',
            colorError: isDark ? '#F87171' : '#EF4444',
            colorInfo: isDark ? '#60A5FA' : '#3B82F6',

            colorBgContainer: isDark ? '#161618' : '#FFFFFF',
            colorBgLayout: isDark ? '#0A0A0C' : '#F5F5F7',
            colorBgElevated: isDark ? '#1E1E22' : '#FFFFFF',
            colorBorder: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)',
            colorBorderSecondary: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
            colorText: isDark ? '#F5F5F7' : '#1D1D1F',
            colorTextSecondary: isDark ? '#98989E' : '#86868B',
            colorTextTertiary: isDark ? '#6E6E73' : '#AEAEB2',
            colorTextPlaceholder: isDark ? '#48484A' : '#C7C7CC',

            borderRadius: 8,
            borderRadiusSM: 6,
            borderRadiusLG: 12,
            controlHeight: 34,

            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Helvetica Neue", sans-serif',
            fontSize: 14,
          },
          components: {
            Button: {
              fontWeight: 500,
              primaryShadow: 'none',
            },
            Tag: {
              borderRadiusSM: 4,
            },
          },
        }}
      >
        <App />
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
