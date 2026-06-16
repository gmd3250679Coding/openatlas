# OpenAtlas Demo Pack

这个目录包含一套可演示、可导入、可复用的企业试点内容。

## 目录

```text
demo-pack/
  README.md
  seeds/openatlas-demo-content.json
  materials/
    channel-q2-brief.docx
    sales-pipeline-q2.csv
    agency-contract-sample.md
    customer-brief.md
    candidate-shortlist.csv
    job-description.md
    meeting-notes.md
```

## 初始化

```bash
cd /Users/macbook/Desktop/Atlasagent/openatlas
OPENATLAS_API_BASE=http://127.0.0.1:58103/api \
python3 backend/scripts/seed_product_demo.py
```

## 整理演示租户

如果本地 demo 租户里残留了 smoke/e2e/zip-test 技能或旧模板, 使用显式 cleanup 模式整理。默认 seed 不会删除或归档已有内容。

```bash
cd /Users/macbook/Desktop/Atlasagent/openatlas
OPENATLAS_API_BASE=http://127.0.0.1:58103/api \
OPENATLAS_DEMO_CLEANUP=1 \
python3 backend/scripts/seed_product_demo.py
```

## 推荐演示顺序

1. 工作台: 选择“财务经营分析师”, 上传 `channel-q2-brief.docx` 和 `sales-pipeline-q2.csv`。
2. 用 `docs/product/DEMO-RUNBOOK.md` 中 Demo 1 的提示词发起群聊接力。
3. 打开右侧“证据”, 证明本轮注入了文件、Skill、记忆。
4. 打开右侧“总结”, 生成总结, 下载并归档交付物。
5. 进入技能市场和 Dashboard, 展示 Skill 可管、Runtime 健康和审计能力。
