"""Server-side model catalog shared with the bundled Hermes launcher."""
from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from app.core.config import OPENATLAS_PROJECT_ROOT


TENCENT_MODEL_CATALOG_PATH = (
    OPENATLAS_PROJECT_ROOT / "runtime" / "config" / "tencent-models.json"
)


@lru_cache(maxsize=1)
def load_tencent_model_catalog() -> dict[str, Any]:
    payload = json.loads(TENCENT_MODEL_CATALOG_PATH.read_text(encoding="utf-8"))
    models = payload.get("models")
    if not isinstance(models, list) or not models:
        raise RuntimeError(f"Tencent model catalog is empty: {TENCENT_MODEL_CATALOG_PATH}")
    return payload


def tencent_model_api_payload() -> dict[str, Any]:
    catalog = load_tencent_model_catalog()
    vendor = str(catalog["vendor"])
    provider = str(catalog["providerId"])
    base_url = str(catalog["baseUrl"])
    default_model = str(catalog["defaultModel"])
    return {
        "object": "list",
        "provider": {
            "id": provider,
            "name": vendor,
            "base_url": base_url,
            "api_key_env": str(catalog["apiKeyEnv"]),
            "default_model": default_model,
        },
        "data": [
            {
                "id": str(item["id"]),
                "name": str(item["name"]),
                "object": "model",
                "owned_by": vendor,
                "provider": provider,
                "url": base_url,
                "is_default": str(item["id"]) == default_model,
            }
            for item in catalog["models"]
        ],
    }
