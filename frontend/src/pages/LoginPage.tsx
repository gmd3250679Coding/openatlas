import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';

/* ── Styles ── */

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#1a1a2e',
    position: 'relative',
    overflow: 'hidden',
  },
  glowTop: {
    position: 'absolute',
    top: '-30%',
    left: '-10%',
    width: '600px',
    height: '600px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(79,70,229,0.15) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  glowBottom: {
    position: 'absolute',
    bottom: '-20%',
    right: '-10%',
    width: '500px',
    height: '500px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(139,127,232,0.10) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  card: {
    position: 'relative',
    zIndex: 1,
    width: 400,
    padding: '48px 40px',
    borderRadius: 16,
    background: 'rgba(22, 33, 62, 0.65)',
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
    border: '1px solid rgba(255,255,255,0.08)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
  },
  brand: {
    textAlign: 'center' as const,
    marginBottom: 40,
  },
  logo: {
    fontSize: 36,
    fontWeight: 700,
    color: '#F5F5F7',
    letterSpacing: 4,
    margin: 0,
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
  },
  subtitle: {
    fontSize: 14,
    color: '#98989E',
    marginTop: 8,
    letterSpacing: 2,
    fontWeight: 400,
  },
  input: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: 8,
    height: 44,
    color: '#F5F5F7',
  },
  button: {
    width: '100%',
    height: 44,
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    background: 'linear-gradient(135deg, #4F46E5 0%, #8B7FE8 100%)',
    border: 'none',
    marginTop: 8,
  },
  error: {
    textAlign: 'center' as const,
    color: '#F87171',
    fontSize: 13,
    marginBottom: 16,
    minHeight: 20,
  },
  demoHint: {
    marginTop: 16,
    textAlign: 'center' as const,
    color: '#B6B6C2',
    fontSize: 12,
    lineHeight: 1.6,
  },
};

/* ── Component ── */

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();

  const onFinish = async (values: { username: string; password: string }) => {
    setError('');
    setLoading(true);
    try {
      await login(values.username, values.password);
      messageApi.success('登录成功');
      navigate('/overview', { replace: true });
    } catch (err: any) {
      const msg = err?.message || '登录失败，请检查用户名和密码';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.glowTop} />
      <div style={styles.glowBottom} />
      {contextHolder}
      <div style={styles.card}>
        <div style={styles.brand}>
          <h1 style={styles.logo}>ATLAS</h1>
          <p style={styles.subtitle}>企业数智劳动力总调度</p>
        </div>

        <div style={styles.error}>{error}</div>

        <Form
          name="login"
          onFinish={onFinish}
          autoComplete="on"
          layout="vertical"
          requiredMark={false}
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input
              prefix={<UserOutlined style={{ color: '#6E6E73' }} />}
              placeholder="用户名"
              autoComplete="username"
              style={styles.input}
              size="large"
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#6E6E73' }} />}
              placeholder="密码"
              autoComplete="current-password"
              style={styles.input}
              size="large"
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              style={styles.button}
            >
              {loading ? '登录中...' : '登录'}
            </Button>
          </Form.Item>
        </Form>
        <div style={styles.demoHint}>
          演示账号 admin@demo.openatlas / openatlas
        </div>
      </div>
    </div>
  );
}
