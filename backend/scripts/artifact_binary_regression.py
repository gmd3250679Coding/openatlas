"""Regression check for binary task artifacts.

This script intentionally avoids the live Hermes/model path. It proves the
OpenAtlas artifact registry can ingest a DOCX-like deliverable as a managed
file instead of corrupting it through the text `content` field.
"""
from __future__ import annotations

import json
import os
import tempfile
import zipfile
from pathlib import Path
from types import SimpleNamespace


TEST_HOME = Path(os.environ.get("OPENATLAS_BINARY_ARTIFACT_TEST_HOME") or tempfile.mkdtemp(prefix="openatlas-artifact-regression-")).resolve()
os.environ["OPENATLAS_HOME"] = str(TEST_HOME)
os.environ.setdefault("HERMES_HOME", str(TEST_HOME / "hermes-tenants" / "demo" / ".hermes"))
os.environ.setdefault("OPENATLAS_SECRET", "artifact-regression-secret")

from app.db.models import SessionRecord, TaskArtifact, Tenant, User  # noqa: E402
from app.db.session import SessionLocal, init_db  # noqa: E402
from app.main import (  # noqa: E402
    _artifact_from_path,
    _artifact_to_dict,
    _materialize_artifact_file,
    _user_workspace_root,
)


def make_minimal_docx(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "[Content_Types].xml",
            """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>""",
        )
        zf.writestr(
            "_rels/.rels",
            """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>""",
        )
        zf.writestr(
            "word/document.xml",
            """<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>OpenAtlas binary artifact regression</w:t></w:r></w:p></w:body>
</w:document>""",
        )


def main() -> None:
    init_db()
    with SessionLocal() as db:
        tenant = db.query(Tenant).first()
        user = db.query(User).first()
        if not tenant or not user:
            raise RuntimeError("seed tenant/user missing")
        rec = SessionRecord(
            tenant_id=tenant.id,
            user_id=user.id,
            hermes_session_id="artifact-regression-hermes-session",
            title="artifact binary regression",
        )
        db.add(rec)
        db.flush()

        principal = SimpleNamespace(tenant=SimpleNamespace(id=tenant.id), user=SimpleNamespace(id=user.id))
        source_path = _user_workspace_root(principal, rec.id) / "OpenAtlas-投资尽调报告.docx"
        make_minimal_docx(source_path)

        extracted = _artifact_from_path(source_path, source="assistant_path")
        assert extracted, "DOCX path was not extracted as artifact"
        assert extracted["content"] == "", "binary artifact must not carry text content"
        assert extracted["kind"] == "document", extracted

        row = TaskArtifact(
            tenant_id=tenant.id,
            user_id=user.id,
            session_id=rec.id,
            kind=extracted["kind"],
            name=extracted["name"],
            mime_type=extracted["mime_type"],
            # Simulate historical bad rows where binary bytes were coerced into TEXT.
            content="PK\x03\x04\x14",
            source="assistant_path",
            source_path=extracted["source_path"],
            managed_status="pending",
        )
        db.add(row)
        db.flush()

        managed = _materialize_artifact_file(db, row)
        assert managed and managed.exists(), "managed DOCX file was not created"
        assert zipfile.is_zipfile(managed), "managed DOCX is not a valid zip/OOXML file"
        payload = _artifact_to_dict(row, db)
        assert payload["content"] == "", "binary artifact payload leaked text content"
        assert payload["managed_status"] == "managed", payload
        assert payload["storage_size"] == managed.stat().st_size, payload
        db.commit()

        print(json.dumps({
            "ok": True,
            "test_home": str(TEST_HOME),
            "source": str(source_path),
            "managed": str(managed),
            "artifact": {
                "name": payload["name"],
                "kind": payload["kind"],
                "mime_type": payload["mime_type"],
                "managed_status": payload["managed_status"],
                "storage_size": payload["storage_size"],
            },
        }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
