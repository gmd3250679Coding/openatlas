# Bundled Hermes runtime

OpenAtlas vendors the official Nous Research Hermes Agent source under
`runtime/hermes/` so a checkout contains the gateway implementation it needs.

- Upstream: https://github.com/NousResearch/hermes-agent
- Version: `v2026.6.5` (`hermes-agent` 0.16.0)
- License: MIT; see `runtime/hermes/LICENSE`

The Python environment is intentionally not committed. Create or repair it
with:

```bash
bash scripts/setup-hermes-runtime.sh
```

The script uses Python 3.12 by default and installs the bundled source in
editable mode into `runtime/hermes/.venv`.

## Tencent Cloud Token Plan models

The managed tenant configuration uses the OpenAI-compatible endpoint
`https://tokenhub.tencentmaas.com/plan/v3`. The model catalog is maintained in
`runtime/config/tencent-models.json`; `auto` is the default and
`deepseek-v4-flash` is the fallback.

For a self-contained local delivery, provide the credential in the project
root `.env` file. The launch scripts export it to each tenant runtime. Never
commit the real value:

```bash
TOKENHUB_API_KEY=<USER_API_KEY>
TOKENHUB_BASE_URL=https://tokenhub.tencentmaas.com/plan/v3
```

Tenant `.hermes` directories contain runtime state and `config.yaml`, but the
InsightLab launcher no longer creates or manages credentials there.

The launcher migrates older InsightLab-managed Xiaomi/DeepSeek configuration
to this provider and stores a timestamped backup beside the old `config.yaml`.
