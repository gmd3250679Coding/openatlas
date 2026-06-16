import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const EMAIL = process.env.OPENATLAS_E2E_EMAIL || 'admin@demo.openatlas';
const PASSWORD = process.env.OPENATLAS_E2E_PASSWORD || 'openatlas';
const DB_PATH = process.env.OPENATLAS_SQLITE_PATH || '/Users/macbook/.openatlas/backend-data/openatlas.db';
const OUT_DIR = path.resolve(process.cwd(), '../output/playwright');
const SHOT_DIR = path.join(OUT_DIR, 'screenshots');
const REPORT_PATH = path.join(OUT_DIR, 'power-user-audit-report.md');

type Severity = 'P0' | 'P1' | 'P2' | 'P3';
type Issue = {
  severity: Severity;
  area: string;
  title: string;
  detail: string;
  evidence?: string;
};

type SeededSessions = {
  replyOnlyId: string;
  artifactId: string;
  runningId: string;
  query: string;
};

function sqlQuote(value: string) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runSql(sql: string) {
  execFileSync('sqlite3', ['-cmd', '.timeout 15000', DB_PATH, sql], { encoding: 'utf8' });
}

function queryJson<T = any>(sql: string): T[] {
  const out = execFileSync('sqlite3', ['-cmd', '.timeout 15000', '-json', DB_PATH, sql], { encoding: 'utf8' }).trim();
  return out ? JSON.parse(out) : [];
}

function push(issues: Issue[], issue: Issue) {
  const key = `${issue.severity}|${issue.area}|${issue.title}|${issue.detail}`;
  if (!issues.some((item) => `${item.severity}|${item.area}|${item.title}|${item.detail}` === key)) {
    issues.push(issue);
  }
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('用户名').fill(EMAIL);
  await page.getByPlaceholder('密码').fill(PASSWORD);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/overview/, { timeout: 20_000 });
}

function seedSessions(): SeededSessions {
  cleanupSeededSessions();

  const [user] = queryJson<{ id: string; tenant_id: string }>(
    "select id, tenant_id from users where email='admin@demo.openatlas' limit 1;",
  );
  if (!user) throw new Error('missing demo admin user');

  const [employee] = queryJson<{ id: string; display_name: string }>(
    `select id, display_name from digital_employees where tenant_id=${sqlQuote(user.tenant_id)} and status='active' order by display_name limit 1;`,
  );
  if (!employee) throw new Error('missing active employee in demo tenant');

  const now = new Date().toISOString();
  const query = '调研A股云鼎科技公司，形成投资尽调报告，用HTML展示';
  const attachment = {
    id: `audit-file-${Date.now()}`,
    name: '云鼎科技年报2024.pdf',
    original_name: '云鼎科技年报2024.pdf',
    mime_type: 'application/pdf',
    status: 'extracted',
    summary: '年报核心财务、主营业务、风险提示已提取。',
    snippets: [{ index: 1, text: '云鼎科技主营业务包含信息技术服务与能源数字化。' }],
  };

  const sessions = {
    replyOnlyId: randomUUID(),
    artifactId: randomUUID(),
    runningId: randomUUID(),
    query,
  };
  const msgIds = {
    replyOnlyUser: randomUUID(),
    replyOnlyAssistant: randomUUID(),
    artifactUser: randomUUID(),
    artifactAssistant: randomUUID(),
    runningUser: randomUUID(),
  };
  const artifactRowId = randomUUID();

  const insertSession = (id: string, title: string, status: string, lastMessage: string, summary = '') => `
    insert into sessions (
      id, tenant_id, user_id, employee_id, hermes_session_id, title, last_message,
      message_count, archived, pinned, workspace, model_override, task_status, task_summary,
      participant_ids, canvas_state, created_at, updated_at
    ) values (
      ${sqlQuote(id)}, ${sqlQuote(user.tenant_id)}, ${sqlQuote(user.id)}, ${sqlQuote(employee.id)},
      ${sqlQuote(`audit_hermes_${id.slice(0, 8)}`)}, ${sqlQuote(title)}, ${sqlQuote(lastMessage)},
      2, 0, 0, '', '', ${sqlQuote(status)}, ${sqlQuote(summary)}, '[]', '', ${sqlQuote(now)}, ${sqlQuote(now)}
    );
  `;

  const insertMessage = (
    id: string,
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
    extra: { attachments?: any[]; speaker?: boolean; inputTokens?: number; outputTokens?: number } = {},
  ) => `
    insert into messages (
      id, session_id, role, content, model_message, tool_calls, reasoning, attachments,
      input_tokens, output_tokens, total_tokens, speaker_employee_id, speaker_name, turn_index, created_at
    ) values (
      ${sqlQuote(id)}, ${sqlQuote(sessionId)}, ${sqlQuote(role)}, ${sqlQuote(content)}, '',
      '[]', '[]', ${sqlQuote(JSON.stringify(extra.attachments || []))},
      ${extra.inputTokens || 0}, ${extra.outputTokens || 0}, ${(extra.inputTokens || 0) + (extra.outputTokens || 0)},
      ${extra.speaker ? sqlQuote(employee.id) : 'null'}, ${extra.speaker ? sqlQuote(employee.display_name) : "''"},
      ${extra.speaker ? 0 : 'null'}, ${sqlQuote(now)}
    );
  `;

  runSql(`
    begin immediate;
    ${insertSession(sessions.replyOnlyId, 'AUDIT_POWER_纯文字回复不应成为输出物', 'completed', query, '已完成一轮分析，但没有结构化交付物。')}
    ${insertMessage(msgIds.replyOnlyUser, sessions.replyOnlyId, 'user', query, { attachments: [attachment], inputTokens: 38 })}
    ${insertMessage(msgIds.replyOnlyAssistant, sessions.replyOnlyId, 'assistant', '我已经完成分析：云鼎科技处于数字化服务赛道，建议关注收入质量、现金流、估值和客户集中度。', { speaker: true, outputTokens: 96 })}

    ${insertSession(sessions.artifactId, 'AUDIT_POWER_HTML交付物闭环', 'completed', query, '已生成 HTML 投资尽调报告。')}
    ${insertMessage(msgIds.artifactUser, sessions.artifactId, 'user', query, { attachments: [attachment], inputTokens: 42 })}
    ${insertMessage(msgIds.artifactAssistant, sessions.artifactId, 'assistant', '已生成 HTML 投资尽调报告，详见右侧交付物。', { speaker: true, outputTokens: 32 })}
    insert into task_artifacts (
      id, tenant_id, user_id, session_id, message_id, kind, name, mime_type, content, source, status, archived, created_at
    ) values (
      ${sqlQuote(artifactRowId)}, ${sqlQuote(user.tenant_id)}, ${sqlQuote(user.id)}, ${sqlQuote(sessions.artifactId)},
      ${sqlQuote(msgIds.artifactAssistant)}, 'html', '云鼎科技_投资尽调报告.html', 'text/html;charset=utf-8',
      ${sqlQuote('<!doctype html><html><body><h1>云鼎科技投资尽调报告</h1><p>财务、业务、估值、风险。</p></body></html>')},
      'assistant', 'active', 0, ${sqlQuote(now)}
    );

    ${insertSession(sessions.runningId, '新会话', 'running', query, '')}
    ${insertMessage(msgIds.runningUser, sessions.runningId, 'user', query, { attachments: [attachment], inputTokens: 41 })}

    insert into context_injections (
      id, tenant_id, user_id, session_id, message_id, employee_id, turn_index, kind, source_id, name, scope, status, summary, payload, created_at
    ) values
      (${sqlQuote(randomUUID())}, ${sqlQuote(user.tenant_id)}, ${sqlQuote(user.id)}, ${sqlQuote(sessions.artifactId)}, ${sqlQuote(msgIds.artifactUser)}, ${sqlQuote(employee.id)}, 0, 'memory', 'audit-memory', '我的偏好', 'user', 'injected', '回答尽量简洁，优先使用表格和数字。', '{}', ${sqlQuote(now)}),
      (${sqlQuote(randomUUID())}, ${sqlQuote(user.tenant_id)}, ${sqlQuote(user.id)}, ${sqlQuote(sessions.artifactId)}, ${sqlQuote(msgIds.artifactUser)}, ${sqlQuote(employee.id)}, 0, 'skill', 'audit-skill', 'financial-modeling', 'tenant', 'injected', '财务建模、估值、财报分析。', '{}', ${sqlQuote(now)}),
      (${sqlQuote(randomUUID())}, ${sqlQuote(user.tenant_id)}, ${sqlQuote(user.id)}, ${sqlQuote(sessions.artifactId)}, ${sqlQuote(msgIds.artifactUser)}, ${sqlQuote(employee.id)}, 0, 'file', ${sqlQuote(attachment.id)}, ${sqlQuote(attachment.name)}, 'session', 'injected', ${sqlQuote(attachment.summary)}, ${sqlQuote(JSON.stringify(attachment))}, ${sqlQuote(now)});
    commit;
  `);

  return sessions;
}

function cleanupSeededSessions() {
  if (process.env.OPENATLAS_KEEP_POWER_AUDIT === '1') return;
  runSql("delete from sessions where title like 'AUDIT_POWER_%' or (title='新会话' and last_message='调研A股云鼎科技公司，形成投资尽调报告，用HTML展示');");
}

async function openConversation(page: Page, sessionId: string, shotName: string) {
  await page.goto(`/overview?conversation=${sessionId}`);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByText(/调研A股云鼎科技公司|云鼎科技/).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(900);
  const shotPath = path.join(SHOT_DIR, shotName);
  await page.screenshot({ path: shotPath, fullPage: true });
  return {
    text: await page.locator('body').innerText(),
    shotPath,
  };
}

async function clickRightTab(page: Page, name: string) {
  const rightAside = page.locator('aside').last();
  await rightAside.getByRole('button', { name }).click();
  await page.waitForTimeout(350);
  return rightAside.innerText();
}

function writeReport(issues: Issue[]) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const order: Severity[] = ['P0', 'P1', 'P2', 'P3'];
  const sorted = [...issues].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  const counts = sorted.reduce<Record<Severity, number>>((acc, item) => {
    acc[item.severity] += 1;
    return acc;
  }, { P0: 0, P1: 0, P2: 0, P3: 0 });
  const lines = [
    '# OpenAtlas Power User Audit',
    '',
    `生成时间: ${new Date().toISOString()}`,
    `数据库: ${DB_PATH}`,
    '',
    `问题统计: P0=${counts.P0}, P1=${counts.P1}, P2=${counts.P2}, P3=${counts.P3}`,
    '',
    '## 检查视角',
    '',
    '- 以 Hermes-web-ui / OpenClaw 重度用户预期检查任务闭环，而不是只检查页面是否报错。',
    '- 重点看: 当前会话进展、真实文件交付物、上下文来源说明、会话命名、右侧栏术语。',
    '',
    '## 问题清单',
    '',
  ];
  sorted.forEach((issue, index) => {
    lines.push(`### ${index + 1}. [${issue.severity}] ${issue.area} - ${issue.title}`);
    lines.push('');
    lines.push(issue.detail);
    if (issue.evidence) lines.push(`截图: ${path.relative(OUT_DIR, issue.evidence)}`);
    lines.push('');
  });
  if (!sorted.length) lines.push('未发现本轮规则可识别的问题。');
  lines.push('## 建议产品调整');
  lines.push('');
  lines.push('1. 将「证据」改名为「上下文」或「本轮上下文」，内容包含用户 Query、附件、文件片段、记忆、Skill、会话上下文。');
  lines.push('2. 「进展」默认只展示当前会话执行步骤，再单独提供“其他运行中任务”折叠区。');
  lines.push('3. 「输出物」只展示真实结构化交付物或工具写出的文件，不把普通 assistant 正文兜底当 `.md` 文件。');
  lines.push('4. 新会话标题优先使用用户 Query 的短摘要，避免大量“新会话”。');
  lines.push('5. 总结区不要拼接最近回复，应提供手动生成/刷新，并区分任务摘要、决策、待补充项、交付物清单。');
  fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf-8');
}

test.describe('OpenAtlas power user audit', () => {
  test('inspect task closure semantics from a heavy-agent-user perspective', async ({ page }) => {
    test.setTimeout(120_000);
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const issues: Issue[] = [];
    const seeded = seedSessions();

    try {
      await login(page);

      const replyOnly = await openConversation(page, seeded.replyOnlyId, 'power-reply-only.png');
      const replySummary = await clickRightTab(page, '总结');
      if (/输出物[\s\S]*回复-.*\.md/.test(replySummary)) {
        push(issues, {
          severity: 'P1',
          area: '输出物',
          title: '普通 assistant 回复被包装成输出物',
          detail: '没有后端 TaskArtifact 的会话仍显示“回复-员工.md”。重度用户会把输出物理解为模型/工具生成的文件，而不是聊天正文副本。',
          evidence: replyOnly.shotPath,
        });
      }

      const artifact = await openConversation(page, seeded.artifactId, 'power-artifact-context.png');
      const contextText = await clickRightTab(page, '上下文');
      if (/证据|本轮注入证据/.test(contextText)) {
        push(issues, {
          severity: 'P2',
          area: '右侧栏术语',
          title: '上下文来源被命名为“证据”',
          detail: '这里展示的是 Skill、记忆、附件等上下文注入，不是审计证据或法律证据。建议改为“上下文”或“本轮上下文”。',
          evidence: artifact.shotPath,
        });
      }
      if (!contextText.includes(seeded.query)) {
        push(issues, {
          severity: 'P1',
          area: '上下文',
          title: '上下文面板缺少用户原始 Query',
          detail: '重度用户需要看到本轮任务的原始问题，才能判断模型到底基于哪个任务目标执行。',
          evidence: artifact.shotPath,
        });
      }
      if (!/云鼎科技年报2024\.pdf|附件|file/i.test(contextText)) {
        push(issues, {
          severity: 'P1',
          area: '上下文',
          title: '上下文面板没有清楚展示用户上传附件',
          detail: '虽然后端 context_injections 有 file 记录，但面板需要明确展示附件名、提取状态、注入片段和字数。',
          evidence: artifact.shotPath,
        });
      }
      const summaryText = await clickRightTab(page, '总结');
      if (!/云鼎科技_投资尽调报告\.html/.test(summaryText)) {
        push(issues, {
          severity: 'P1',
          area: '交付物',
          title: '真实 HTML 交付物没有在总结区形成强闭环',
          detail: '有 TaskArtifact 时，应突出文件名、类型、下载、预览、归档，不应被摘要文字淹没。',
          evidence: artifact.shotPath,
        });
      }

      const running = await openConversation(page, seeded.runningId, 'power-running-session.png');
      const progressText = await clickRightTab(page, '进展');
      if (!progressText.includes(seeded.query)) {
        push(issues, {
          severity: 'P1',
          area: '进展',
          title: '进展没有围绕当前会话展示',
          detail: '进展 tab 应优先展示当前会话当前任务的阶段、步骤、已调用工具、等待原因，而不是只展示全局运行队列。',
          evidence: running.shotPath,
        });
      }
      if (/运行队列[\s\S]*新会话/.test(progressText)) {
        push(issues, {
          severity: 'P2',
          area: '进展',
          title: '运行队列混入大量“新会话”，信息辨识度低',
          detail: '运行中的会话应使用用户 Query 摘要命名，否则用户无法判断哪个任务正在跑。',
          evidence: running.shotPath,
        });
      }
      if (running.text.includes('新会话') && !running.text.includes(seeded.query.slice(0, 12))) {
        push(issues, {
          severity: 'P1',
          area: '会话命名',
          title: '会话标题没有直接使用用户 Query 摘要',
          detail: '用户发起任务后，会话标题继续显示“新会话”会严重影响历史检索和运行队列识别。',
          evidence: running.shotPath,
        });
      }

      writeReport(issues);
      expect(fs.existsSync(REPORT_PATH)).toBeTruthy();
    } finally {
      cleanupSeededSessions();
    }
  });
});
