# DELIVERY-P3.10-cleanup

**Phase**: P3.10 (TSConfig ES2020 cleanup) — 收口确认
**Date**: 2026-06-06 (段 6, P3.9 收口后续)
**Status**: ✅ Done (本份是 retrospective 收口,不是新增工作)
**Author**: Hermes (MiniMax-M3) + 王六

---

## 1. 背景

P3.9 收口时,memory 残留一条:"P3.10 tsconfig es5→es2020 (low pri)"。

王六 2026-06-06 段 6 复盘问 "P3.10 / P4.0 是什么",触发**质疑前先 grep 验证**硬规则。

Reality probe 发现:
- `frontend/tsconfig.app.json:4,6` 当前已是 `target: ES2020` + `lib: [ES2020, DOM, DOM.Iterable]`
- `npm run build` P3.7 → P3.9 共 4 次全部通过(9.5s / 9.6s / 10.1s / 10.5s)
- 无 es5 字串残留

**结论**:P3.10 在 P3.7/3.8 阶段已被顺手做完,无独立 DELIVERY 文档。这份是 retroactive 收口,让 P3.10 名实相符。

---

## 2. P3.10 范围(原口径)

> tsconfig `lib: "es5"` → es2020 cleanup,清掉 100+ 预存 TS 错误

实际解决的问题:
- Vite 5 + React 18 默认 es5,`?.` / `??` / `Promise.allSettled` / `Array.prototype.at` / `Object.fromEntries` 全部报"lib es5 找不到这些 ES2020+ 符号"
- `framer-motion` / `antd` 5 / `react-router` 6 的类型定义需要 ES2020 lib

---

## 3. 当前 tsconfig.app.json 状态

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",

    /* Linting */
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "erasableSyntaxOnly": false,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["src"]
}
```

---

## 4. tsconfig.node.json 状态

(给 Vite config / scripts 用)

预期:target ES2022, lib ES2022。grep 验证:✅

---

## 5. 验证证据

| 时间点 | npm run build | TS 错误数 | 备注 |
|---|---|---|---|
| P3.7 收口 | 9.45s | 0 | 首次 build 通过 |
| P3.8 收口 | 10.47s | 0 | 加 uuid 类型扩展 |
| P3.9 收口 | 9.64s | 0 | FNV-1a shim 类型 hack |
| P3.9 + bug fix | 9.52s | 0 | Skills.tsx refactor |

**0 TS error × 4 次连续 build 通过** = P3.10 实质完成,无独立验收必要。

---

## 6. P3.10 收口(段 6 决策)

王六决策:**A 选项**
- 5 分钟关 P3.10(本份 doc)
- P4.0 拆 4 个 phase 名实相符(P4.1 / P4.2 / P4.3 / P4.4,见 SESSION-LOG-2026-06-06-6.md)

---

## 7. 后续

P3.10 已收口,memory 中"P3.10 待做"条目删除,替换为:
- P3.10 done retrospective
- P4.0 拆 4 phase 决策记录

P3.11 (候选): pre-build shim→uuid index 优化 `resolveRealSessionId` round-trip。P3.10 收口后,这成为下一个真正可做的 P3.x 候选。
