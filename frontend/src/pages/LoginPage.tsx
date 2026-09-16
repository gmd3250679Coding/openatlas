import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Form, Input, Button, message, Select } from 'antd';
import { ApartmentOutlined, LockOutlined, UserOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';

type AuthMode = 'login' | 'register';
type AuthEntrance = 'landing' | 'credentials';
type PetSpec = { src: string; large?: boolean };

const PET_BASE = '/assets/marmot-pet';
const statePet = (name: string) => `${PET_BASE}/e_pet_v2_state_${name}.svg`;
const animPet = (name: string) => `${PET_BASE}/v2_animation_states/transparent/e_pet_v2_anim_transparent_${name}.webp`;

const paradeRows: PetSpec[][] = [
  [
    { src: animPet('programmer'), large: true },
    { src: animPet('document') },
    { src: animPet('phd'), large: true },
    { src: animPet('writer') },
    { src: animPet('artist'), large: true },
    { src: animPet('lecturer') },
  ],
  [
    { src: animPet('writer') },
    { src: animPet('artist'), large: true },
    { src: animPet('lecturer') },
    { src: animPet('programmer') },
    { src: animPet('document'), large: true },
    { src: animPet('phd') },
  ],
  [
    { src: statePet('thinking') },
    { src: statePet('money'), large: true },
    { src: statePet('lovestruck') },
    { src: statePet('talking_a'), large: true },
    { src: statePet('blink') },
    { src: statePet('happy') },
  ],
  [
    { src: animPet('writer'), large: true },
    { src: animPet('artist'), large: true },
    { src: animPet('lecturer'), large: false },
    { src: animPet('document') },
    { src: animPet('phd'), large: true },
    { src: animPet('programmer'), large: false },
  ],
  [
    { src: statePet('sleeping') },
    { src: statePet('thinking'), large: true },
    { src: statePet('talking_b') },
    { src: statePet('happy'), large: true },
    { src: statePet('money') },
    { src: statePet('breathing'), large: true },
  ],
];

const tenantOptions = [
  { value: 'demo', label: 'Demo Tenant' },
];

const TRIAL_GUIDE_PATH = '/openatlas-trial-guide-20260621/';

function friendlyAuthError(err: unknown, mode: AuthMode) {
  const raw = err && typeof err === 'object' && 'message' in err
    ? String((err as { message?: string }).message || '')
    : String(err || '');
  const lower = raw.toLowerCase();
  if (/api 暂时不可达|failed to fetch|load failed|networkerror|network request failed/.test(lower)) {
    return '暂时连接不上 InsightLab 服务。请确认后端已启动，并使用可访问入口访问；如果当前是腾讯云域名被拦截，请先用公网 IP。';
  }
  if (/api 401|unauthorized|invalid credentials/.test(lower)) {
    return '账号或密码不正确，请检查后重试。';
  }
  if (/api 403|user disabled/.test(lower)) {
    return '该账号当前不可用，请联系管理员确认权限或账号状态。';
  }
  if (/api 409|already exists|duplicate|已注册/.test(lower)) {
    return '该用户名或邮箱已注册，请直接登录或换一个账号。';
  }
  return mode === 'register' ? '注册失败，请换一个用户名或邮箱后重试。' : '登录失败，请检查用户名、密码和企业空间。';
}

export default function LoginPage() {
  const [mode, setMode] = useState<AuthMode>('login');
  const location = useLocation();
  const returnPath = typeof location.state?.from === 'string' && location.state.from.startsWith('/')
    ? location.state.from
    : '/overview';
  const [authEntrance, setAuthEntrance] = useState<AuthEntrance>(returnPath === '/overview' ? 'landing' : 'credentials');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();

  const onFinish = async (values: { username: string; password: string; tenant?: string }) => {
    setError('');
    setLoading(true);
    const username = String(values.username || '').trim();
    const password = String(values.password || '');
    try {
      if (mode === 'register') {
        await register(username, password);
        messageApi.success('注册成功，已进入工作台');
      } else {
        await login(username, password);
        messageApi.success('登录成功');
      }
      navigate(returnPath, { replace: true });
    } catch (err: unknown) {
      setError(friendlyAuthError(err, mode));
    } finally {
      setLoading(false);
    }
  };

  const isRegister = mode === 'register';
  const awaken = () => setAuthEntrance('credentials');

  return (
    <div className={`atlas-auth-page ${authEntrance === 'credentials' ? 'is-login' : 'is-landing'}`}>
      {contextHolder}
      <div className="atlas-auth-bg">
        <div className="atlas-auth-grid" />
      </div>
      <a
        className="atlas-auth-guide-link"
        href={TRIAL_GUIDE_PATH}
        aria-label="打开 InsightLab 试用文档"
      >
        试用文档
      </a>

      {authEntrance === 'landing' ? (
        <section
          className="atlas-auth-landing-stage"
          data-testid="auth-wake-login"
          onClick={awaken}
          onPointerUp={awaken}
          onMouseUp={awaken}
        >
          <div className="atlas-auth-moon" aria-hidden="true" />
          <div className="atlas-auth-moon-glow" aria-hidden="true" />
          <section className="atlas-auth-marmot-desk" aria-hidden="true">
            <img
              className="atlas-auth-marmot"
              src={statePet('sleeping')}
              alt=""
            />
          </section>
          <section className="atlas-auth-landing-copy">
            <h2>编排、协作、交付</h2>
            <p>高效管理数智团队，精准交付业务结果</p>
            <button
              type="button"
              className="atlas-auth-enter-tip"
              onClick={(event) => {
                event.stopPropagation();
                awaken();
              }}
              aria-label="唤醒登录"
            >
              点击任意处唤醒并登录
            </button>
          </section>
        </section>
      ) : (
        <div className="atlas-auth-login-stage">
          <div className="atlas-auth-login-parade-wrap" aria-hidden="true">
            <div className="atlas-auth-parade" aria-hidden="true">
              {paradeRows.map((row, rowIndex) => (
                <div
                  key={`row-${rowIndex}`}
                  className={`atlas-auth-pet-lane ${rowIndex % 2 === 0 ? 'lane-left' : 'lane-right'}`}
                >
                  <div className="atlas-auth-pet-track">
                    {[...row, ...row].map((pet, index) => (
                      <span
                        className={`atlas-auth-pet ${pet.large || index % 3 === 1 ? 'is-large' : ''}`}
                        key={`${pet.src}-${index}`}
                      >
                        <img src={pet.src} alt="" />
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="atlas-auth-pet-ghost" aria-hidden="true">
              <img src={statePet('thinking')} alt="" />
            </div>
          </div>
          <div className="atlas-auth-orb" />
          <section className="atlas-auth-hero atlas-auth-hero-hidden" aria-label="InsightLab 登录">
            <div className="atlas-auth-copy">
              <h2>编排、协作、交付</h2>
              <p>高效管理数智团队，精准交付业务结果</p>
            </div>
          </section>
          <section className="atlas-auth-card-shell atlas-auth-card-shell-login" aria-label={isRegister ? '注册' : '登录'}>
            <div className="atlas-auth-card">
              <div className="atlas-auth-tabs">
                <button
                  type="button"
                  className={mode === 'login' ? 'active' : ''}
                  onClick={() => { setMode('login'); setError(''); }}
                >
                  登录
                </button>
                <button
                  type="button"
                  className={mode === 'register' ? 'active' : ''}
                  onClick={() => { setMode('register'); setError(''); }}
                >
                  开放注册
                </button>
              </div>

              <div className="atlas-auth-error">{error}</div>

              <Form
                name="atlas-auth"
                onFinish={onFinish}
                autoComplete="on"
                layout="vertical"
                requiredMark={false}
                initialValues={{ tenant: 'demo' }}
              >
                <Form.Item
                  name="tenant"
                  label="企业空间"
                  rules={[{ required: true, message: '请选择企业空间' }]}
                >
                  <Select
                    className="atlas-auth-tenant-select"
                    classNames={{ popup: { root: 'atlas-auth-tenant-popup' } }}
                    prefix={<ApartmentOutlined />}
                    size="large"
                    options={tenantOptions}
                  />
                </Form.Item>

                <Form.Item
                  name="username"
                  label="用户名 / 邮箱"
                  rules={[{ required: true, message: '请输入用户名' }]}
                >
	                  <Input
	                    id="atlas-auth_username"
	                    prefix={<UserOutlined />}
	                    placeholder="demo@demo.openatlas"
                    autoComplete="username"
                    size="large"
                  />
                </Form.Item>

                <Form.Item
                  name="password"
                  label="密码"
                  rules={[
                    { required: true, message: '请输入密码' },
                    { min: 4, message: '密码至少 4 位' },
                  ]}
                >
                  <Input.Password
                    id="atlas-auth_password"
                    prefix={<LockOutlined />}
                    placeholder="openatlas"
                    autoComplete={isRegister ? 'new-password' : 'current-password'}
                    size="large"
                  />
                </Form.Item>

                <Button
                  type="primary"
                  htmlType="submit"
                  loading={loading}
                  className="atlas-auth-submit"
                >
                  {loading ? (isRegister ? '注册中...' : '登录中...') : (isRegister ? '注册并进入 InsightLab' : '进入 InsightLab')}
                </Button>
              </Form>

	              <div className="atlas-auth-footnote">
	                <span>演示账号</span>
	                <strong>demo@demo.openatlas / openatlas</strong>
	              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
