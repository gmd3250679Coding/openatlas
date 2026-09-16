const TEST_PATTERNS = [
  /api\s*smoke/i,
  /\bsmoke\b/i,
  /\be2e\b/i,
  /openatlas_e2e/i,
  /e2e_/i,
  /ui_(tabs|sidebar|history|group)/i,
  /ui\s+(workbench|finance)\s+(proof|skill)/i,
  /pwgroup/i,
  /pwstrict/i,
  /playwright/i,
  /phase\s*3\.5\s*test/i,
  /phase\s*3\.5/i,
  /test\s*memory/i,
  /\btest\b/i,
  /zip-test/i,
  /browser-(uploaded|final)/i,
  /tenant-skill-test/i,
  /demo-tenant-[ab]/i,
  /(777|888)\s*demo/i,
  /\b[a-z]*demo\b/i,
  /enter-warroom/i,
  /artifact\s+qa/i,
  /audit\s+attachment\s+restore/i,
  /restore_attachment/i,
  /live\s+(group|http)\s+proof/i,
  /real\s+relay\s+proof/i,
  /hermes\s+skill\s+proof/i,
  /codex-dialog-chain/i,
  /mimo-stream-test/i,
  /render\s+test/i,
  /附件上下文验证/i,
  /模板库验证/i,
  /测试协作画布入口/i,
  /say\s+(ok|hi)/i,
  /reply\s+(only\s+)?(ok|warmup_ok|current_ok)/i,
  /after\s+switching/i,
  /数据分析-[0-9a-f]{4,}/i,
  /p3\.\d+/i,
  /\bdebug\b/i,
];

export function showTestFixtures() {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem('atlas_show_test_fixtures') === 'true'
    || new URLSearchParams(window.location.search).get('showTestFixtures') === '1';
}

export function isLikelyTestFixture(value: unknown) {
  if (value == null) return false;
  const text = typeof value === 'string'
    ? value
    : [
        (value as any).name,
        (value as any).title,
        (value as any).slug,
        (value as any).description,
        (value as any).last_message,
        (value as any).content,
        (value as any).category,
        (value as any).profile_name,
      ].filter(Boolean).join(' ');
  return TEST_PATTERNS.some((pattern) => pattern.test(text));
}

export function productVisible<T>(items: T[]) {
  if (showTestFixtures()) return items;
  return items.filter((item) => !isLikelyTestFixture(item));
}

export function sanitizedSourceLabel(sourceRef?: string | null) {
  if (!sourceRef) return '';
  if (sourceRef.startsWith('hermes:')) return 'Hermes';
  if (sourceRef.startsWith('zip:')) return 'Private ZIP';
  if (sourceRef.startsWith('/Users/') || sourceRef.startsWith('file:')) return 'Private Source';
  if (/^[0-9a-f-]{16,}$/i.test(sourceRef)) return 'OpenAtlas';
  return sourceRef.length > 18 ? `${sourceRef.slice(0, 18)}...` : sourceRef;
}
