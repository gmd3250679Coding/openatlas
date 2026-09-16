"""InsightLab SQLAlchemy models.

Strict four-scope model: global / tenant / user / employee.
IDs are UUID strings (not integers).
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime as _SQLAlchemyDateTime,
    Enum as SqlEnum,
    ForeignKey,
    Float,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator


class UTCDateTime(TypeDecorator):
    """Store datetimes as UTC and restore tzinfo after SQLite reads them.

    SQLite does not preserve timezone info for SQLAlchemy DateTime columns.
    Without this adapter, an aware UTC value such as 2026-06-19T08:00:00+00:00
    is read back as naive 2026-06-19T08:00:00, then serialized without an
    offset and parsed by browsers as local time. That is the source of the
    visible -8h timestamp drift in Asia/Shanghai.
    """

    impl = _SQLAlchemyDateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect) -> datetime | None:  # noqa: ANN001
        if value is None:
            return None
        if value.tzinfo is None:
            return value
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect) -> datetime | None:  # noqa: ANN001
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


DateTime = UTCDateTime


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    # Bug 9 (2026-06-06): naive utcnow() 后 .isoformat() 输出无时区后缀,
    # 前端 new Date(...) 按本地时区解析丢 8h. 改用 timezone-aware UTC,
    # .isoformat() 自动加 "+00:00" 后缀,前端按 UTC 解析,不再丢 8h.
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Scope(str, enum.Enum):
    global_ = "global"
    tenant = "tenant"
    user = "user"
    employee = "employee"


class UserRole(str, enum.Enum):
    system_admin = "system_admin"
    tenant_admin = "tenant_admin"
    user = "user"


class TenantStatus(str, enum.Enum):
    active = "active"
    suspended = "suspended"
    archived = "archived"


class EmployeeStatus(str, enum.Enum):
    active = "active"
    archived = "archived"
    disabled = "disabled"


class RuntimeStatus(str, enum.Enum):
    stopped = "stopped"
    starting = "starting"
    running = "running"
    error = "error"


class RuntimeType(str, enum.Enum):
    process = "process"
    container = "container"
    remote = "remote"


class Tenant(Base):
    __tablename__ = "tenants"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    status: Mapped[TenantStatus] = mapped_column(SqlEnum(TenantStatus), default=TenantStatus.active)
    plan: Mapped[str] = mapped_column(String(32), default="free")
    # Phase 3.4 — resource limits. None means "unlimited" (system tenant).
    max_sessions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_employees: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class OrganizationUnit(Base):
    """Tenant-scoped organization tree for enterprise administration."""
    __tablename__ = "organization_units"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("organization_units.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    code: Mapped[str] = mapped_column(String(64), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(24), default="active")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    __table_args__ = (UniqueConstraint("tenant_id", "code", name="uq_org_tenant_code"),)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    org_unit_id: Mapped[str | None] = mapped_column(ForeignKey("organization_units.id"), nullable=True, index=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    username: Mapped[str] = mapped_column(String(64))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(SqlEnum(UserRole), default=UserRole.user)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (UniqueConstraint("tenant_id", "email", name="uq_user_tenant_email"),)


class RolePermissionOverride(Base):
    """Tenant-scoped role capability overrides for the admin permission matrix."""
    __tablename__ = "role_permission_overrides"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str | None] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    role: Mapped[str] = mapped_column(String(32), index=True)
    capability: Mapped[str] = mapped_column(String(96), index=True)
    allowed: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    __table_args__ = (UniqueConstraint("tenant_id", "role", "capability", name="uq_role_permission_override"),)


class HermesRuntime(Base):
    """Per-tenant Hermes gateway config.  MVP: static, but the schema is here."""
    __tablename__ = "hermes_runtimes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    runtime_type: Mapped[str] = mapped_column(String(32), default="process")
    gateway_base_url: Mapped[str] = mapped_column(String(255))
    api_key: Mapped[str] = mapped_column(String(128))       # legacy name (Phase 1)
    api_key_encrypted: Mapped[str] = mapped_column(String(255))  # Phase 2: stores plaintext for now (Phase 3 will encrypt)
    hermes_home_path: Mapped[str] = mapped_column(String(512))
    port: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(32), default="stopped")
    pid: Mapped[int | None] = mapped_column(Integer, nullable=True)
    health_checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class DigitalEmployee(Base):
    """InsightLab-side metadata for a digital employee. Profile name maps to Hermes session metadata."""
    __tablename__ = "digital_employees"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    display_name: Mapped[str] = mapped_column(String(128))
    profile_name: Mapped[str] = mapped_column(String(128), index=True)  # tenant_xxx__employee_yyy
    description: Mapped[str] = mapped_column(Text, default="")
    avatar: Mapped[str] = mapped_column(String(8), default="?")  # single char avatar
    status: Mapped[EmployeeStatus] = mapped_column(SqlEnum(EmployeeStatus), default=EmployeeStatus.active)
    model: Mapped[str] = mapped_column(String(128), default="hermes-agent")
    provider: Mapped[str] = mapped_column(String(128), default="hermes")
    temperature: Mapped[float] = mapped_column(default=0.7)
    max_tokens: Mapped[int] = mapped_column(Integer, default=2048)
    system_prompt: Mapped[str] = mapped_column(Text, default="")
    toolsets: Mapped[str] = mapped_column(Text, default="[]")  # JSON list
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    __table_args__ = (UniqueConstraint("tenant_id", "profile_name", name="uq_emp_tenant_profile"),)


class SessionRecord(Base):
    """InsightLab-side session metadata.  Hermes session_id is the real session reference."""
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    employee_id: Mapped[str | None] = mapped_column(ForeignKey("digital_employees.id"), nullable=True)
    hermes_session_id: Mapped[str] = mapped_column(String(128), index=True)  # the real Hermes one
    title: Mapped[str] = mapped_column(String(255), default="")
    last_message: Mapped[str] = mapped_column(Text, default="")
    message_count: Mapped[int] = mapped_column(Integer, default=0)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    workspace: Mapped[str] = mapped_column(String(128), default="")
    model_override: Mapped[str] = mapped_column(String(128), default="")
    task_status: Mapped[str] = mapped_column(String(24), default="draft")  # draft/running/needs_input/completed/failed
    task_summary: Mapped[str] = mapped_column(Text, default="")
    summary_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Bug 3/4/11 (2026-06-06): 群聊接力员工 UUID JSON 列表.
    # 之前完全没存 relays, 群聊 = 单聊.  现在 list[str] (uuid list) 或 "[]".
    participant_ids: Mapped[str] = mapped_column(Text, default="[]")
    canvas_state: Mapped[str] = mapped_column(Text, default="")
    reusable_template_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class SessionRun(Base):
    """Durable execution lifecycle for one user-visible task turn."""
    __tablename__ = "session_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    employee_id: Mapped[str | None] = mapped_column(ForeignKey("digital_employees.id"), nullable=True, index=True)
    hermes_run_id: Mapped[str] = mapped_column(String(128), default="", index=True)
    status: Mapped[str] = mapped_column(String(32), default="queued")
    stage: Mapped[str] = mapped_column(String(64), default="")
    reason: Mapped[str] = mapped_column(Text, default="")
    last_event_type: Mapped[str] = mapped_column(String(64), default="")
    event_count: Mapped[int] = mapped_column(Integer, default=0)
    payload: Mapped[str] = mapped_column(Text, default="{}")
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class SessionRunEvent(Base):
    """Append-only runtime event log for replaying a Hermes/InsightLab task turn."""
    __tablename__ = "session_run_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    run_id: Mapped[str | None] = mapped_column(ForeignKey("session_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    hermes_run_id: Mapped[str] = mapped_column(String(128), default="", index=True)
    event_type: Mapped[str] = mapped_column(String(96), index=True)
    sequence: Mapped[int] = mapped_column(Integer, default=0)
    source: Mapped[str] = mapped_column(String(32), default="openatlas")
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)


class CollaborationTemplate(Base):
    """Reusable group/session orchestration template.

    This stores the InsightLab-side orchestration shape so a proven group chat
    can be reused without turning it into a Hermes Skill file.
    """
    __tablename__ = "collaboration_templates"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(64), default="general")
    visibility: Mapped[str] = mapped_column(String(16), default="private")
    primary_employee_id: Mapped[str | None] = mapped_column(ForeignKey("digital_employees.id"), nullable=True)
    participant_ids: Mapped[str] = mapped_column(Text, default="[]")
    canvas_state: Mapped[str] = mapped_column(Text, default="")
    source_session_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class WhiteboardDocument(Base):
    """User-owned creative whiteboard stored as Excalidraw scene JSON."""
    __tablename__ = "whiteboard_documents"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(160), default="未命名白板")
    description: Mapped[str] = mapped_column(Text, default="")
    kind: Mapped[str] = mapped_column(String(32), default="freeform")
    scene_json: Mapped[str] = mapped_column(Text, default="{}")
    summary: Mapped[str] = mapped_column(Text, default="")
    element_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class ContractDocument(Base):
    """User-owned contract review workspace document."""
    __tablename__ = "contract_documents"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    file_asset_id: Mapped[str | None] = mapped_column(ForeignKey("file_assets.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(255), default="")
    contract_type: Mapped[str] = mapped_column(String(64), default="general")
    review_perspective: Mapped[str] = mapped_column(String(32), default="balanced")
    status: Mapped[str] = mapped_column(String(32), default="uploaded")
    current_version_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    summary: Mapped[str] = mapped_column(Text, default="")
    parties_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class ContractVersion(Base):
    """Original/revised contract files produced by the review workspace."""
    __tablename__ = "contract_versions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    contract_id: Mapped[str] = mapped_column(ForeignKey("contract_documents.id", ondelete="CASCADE"), index=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    version_no: Mapped[int] = mapped_column(Integer, default=1)
    kind: Mapped[str] = mapped_column(String(32), default="original")  # original/revised/report
    name: Mapped[str] = mapped_column(String(255), default="")
    mime_type: Mapped[str] = mapped_column(String(128), default="application/octet-stream")
    storage_path: Mapped[str] = mapped_column(String(512), default="")
    size: Mapped[int] = mapped_column(Integer, default=0)
    extracted_text: Mapped[str] = mapped_column(Text, default="")
    change_summary: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class ContractReviewIssue(Base):
    """Structured AI/rule review suggestion linked to a contract location."""
    __tablename__ = "contract_review_issues"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    contract_id: Mapped[str] = mapped_column(ForeignKey("contract_documents.id", ondelete="CASCADE"), index=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    severity: Mapped[str] = mapped_column(String(16), default="medium")
    category: Mapped[str] = mapped_column(String(64), default="general")
    title: Mapped[str] = mapped_column(String(255), default="")
    clause_ref: Mapped[str] = mapped_column(String(128), default="")
    page_no: Mapped[int | None] = mapped_column(Integer, nullable=True)
    paragraph_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    excerpt: Mapped[str] = mapped_column(Text, default="")
    risk: Mapped[str] = mapped_column(Text, default="")
    recommendation: Mapped[str] = mapped_column(Text, default="")
    proposed_revision: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(24), default="open")  # open/accepted/ignored
    confidence: Mapped[float] = mapped_column(Float, default=0.72)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class OfficialDocument(Base):
    """User-owned official writing workspace document."""
    __tablename__ = "official_documents"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(255), default="")
    doc_type: Mapped[str] = mapped_column(String(48), default="notice")
    template_key: Mapped[str] = mapped_column(String(80), default="gbt9704")
    status: Mapped[str] = mapped_column(String(32), default="draft")
    query: Mapped[str] = mapped_column(Text, default="")
    fields_json: Mapped[str] = mapped_column(Text, default="{}")
    compliance_json: Mapped[str] = mapped_column(Text, default="[]")
    current_version_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    summary: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class OfficialDocumentVersion(Base):
    """DOCX/Markdown outputs generated by the official writing workspace."""
    __tablename__ = "official_document_versions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(ForeignKey("official_documents.id", ondelete="CASCADE"), index=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    version_no: Mapped[int] = mapped_column(Integer, default=1)
    kind: Mapped[str] = mapped_column(String(32), default="docx")
    name: Mapped[str] = mapped_column(String(255), default="")
    mime_type: Mapped[str] = mapped_column(String(128), default="application/octet-stream")
    storage_path: Mapped[str] = mapped_column(String(512), default="")
    size: Mapped[int] = mapped_column(Integer, default=0)
    extracted_text: Mapped[str] = mapped_column(Text, default="")
    change_summary: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class PresentationDeckDocument(Base):
    """User-owned AIPPT deck plan generated by the presentation workspace."""
    __tablename__ = "presentation_deck_documents"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(255), default="")
    use_case: Mapped[str] = mapped_column(String(32), default="report")
    aspect_ratio: Mapped[str] = mapped_column(String(16), default="16:9")
    style_key: Mapped[str] = mapped_column(String(64), default="executive_blue")
    status: Mapped[str] = mapped_column(String(32), default="outline")
    source: Mapped[str] = mapped_column(String(64), default="hermes-stream")
    model: Mapped[str] = mapped_column(String(80), default="hermes-agent")
    query: Mapped[str] = mapped_column(Text, default="")
    config_json: Mapped[str] = mapped_column(Text, default="{}")
    plan_json: Mapped[str] = mapped_column(Text, default="{}")
    warnings_json: Mapped[str] = mapped_column(Text, default="[]")
    slide_count: Mapped[int] = mapped_column(Integer, default=0)
    knowledge_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class PresentationDeckVersion(Base):
    """Saved schema snapshots for the AIPPT low-code designer."""
    __tablename__ = "presentation_deck_versions"
    __table_args__ = (UniqueConstraint("deck_id", "version_no", name="uq_presentation_deck_version_no"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    deck_id: Mapped[str] = mapped_column(ForeignKey("presentation_deck_documents.id", ondelete="CASCADE"), index=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    version_no: Mapped[int] = mapped_column(Integer, default=1)
    title: Mapped[str] = mapped_column(String(255), default="")
    config_json: Mapped[str] = mapped_column(Text, default="{}")
    plan_json: Mapped[str] = mapped_column(Text, default="{}")
    change_summary: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class JobStatus(str, enum.Enum):
    active = "active"
    paused = "paused"
    disabled = "disabled"


class Job(Base):
    """Phase 3.5 — InsightLab-side cron job metadata. Hermes has only a
    read-only `/api/jobs` endpoint, so we own the schedule + state here.
    `run()` proxies to the tenant Hermes via `hermes_client.stream_chat`
    with a synthetic message built from the job prompt."""
    __tablename__ = "jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str] = mapped_column(Text, default="")
    schedule_kind: Mapped[str] = mapped_column(String(16), default="cron")  # cron | interval | once
    schedule_expr: Mapped[str] = mapped_column(String(128), default="0 9 * * *")
    employee_id: Mapped[str | None] = mapped_column(ForeignKey("digital_employees.id"), nullable=True)
    skills: Mapped[str] = mapped_column(Text, default="")  # CSV of skill slugs
    toolsets: Mapped[str] = mapped_column(Text, default="")
    deliver: Mapped[str] = mapped_column(String(32), default="local")  # local | webhook | email
    prompt: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[JobStatus] = mapped_column(SqlEnum(JobStatus), default=JobStatus.active)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_status: Mapped[str] = mapped_column(String(32), default="never_run")
    last_error: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class SkillPackage(Base):
    """InsightLab-side skill metadata (not the actual Hermes skill file)."""
    __tablename__ = "skill_packages"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    scope: Mapped[Scope] = mapped_column(SqlEnum(Scope), index=True)
    owner_tenant_id: Mapped[str | None] = mapped_column(ForeignKey("tenants.id"), nullable=True)
    owner_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    slug: Mapped[str] = mapped_column(String(128))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(64), default="general")
    version: Mapped[str] = mapped_column(String(32), default="1.0.0")
    source_ref: Mapped[str] = mapped_column(String(255), default="")
    system_prompt: Mapped[str] = mapped_column(Text, default="")
    input_schema: Mapped[str] = mapped_column(Text, default="{}")
    output_schema: Mapped[str] = mapped_column(Text, default="{}")
    few_shot_examples: Mapped[str] = mapped_column(Text, default="[]")
    visibility: Mapped[str] = mapped_column(String(16), default="public")  # public / tenant / private
    mutable: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(16), default="enabled")  # enabled / disabled / deprecated
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class SkillBinding(Base):
    """Records skill being introduced/authorized/bound to a target (tenant/user/employee)."""
    __tablename__ = "skill_bindings"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    skill_id: Mapped[str] = mapped_column(ForeignKey("skill_packages.id"), index=True)
    target_type: Mapped[str] = mapped_column(String(16))  # tenant / user / employee
    target_id: Mapped[str] = mapped_column(String(36), index=True)
    binding_mode: Mapped[str] = mapped_column(String(16), default="inherited")  # inherited/copied/custom
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class MemoryEntry(Base):
    __tablename__ = "memory_entries"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    scope: Mapped[Scope] = mapped_column(SqlEnum(Scope), index=True)
    owner_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    employee_id: Mapped[str | None] = mapped_column(ForeignKey("digital_employees.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(255))
    content: Mapped[str] = mapped_column(Text)
    tags: Mapped[str] = mapped_column(String(512), default="")  # comma-separated
    visibility: Mapped[str] = mapped_column(String(16), default="private")  # public / tenant / private
    mutable: Mapped[bool] = mapped_column(Boolean, default=True)
    priority: Mapped[int] = mapped_column(Integer, default=50)
    status: Mapped[str] = mapped_column(String(16), default="active")  # active / archived
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class MemoryBinding(Base):
    __tablename__ = "memory_bindings"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    memory_id: Mapped[str] = mapped_column(ForeignKey("memory_entries.id"), index=True)
    target_type: Mapped[str] = mapped_column(String(16))  # tenant / user / employee / session
    target_id: Mapped[str] = mapped_column(String(36), index=True)
    injection_mode: Mapped[str] = mapped_column(String(16), default="always")  # always/on_demand/manual
    priority: Mapped[int] = mapped_column(Integer, default=50)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str | None] = mapped_column(ForeignKey("tenants.id"), nullable=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(64), index=True)
    resource_type: Mapped[str] = mapped_column(String(64))
    resource_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    request_id: Mapped[str] = mapped_column(String(64), default="")
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(255), default="")
    extra: Mapped[str] = mapped_column(Text, default="{}")  # JSON
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


# P3.12 (2026-06-07): FileAsset 表 — 附件元数据 + 提取文本 + 状态机
# 路径: $OPENATLAS_HOME/uploads/{tenant_id}/{user_id}/{session_id}/{file_id}/{safe_filename}
class FileAsset(Base):
    __tablename__ = "file_assets"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    session_id: Mapped[str | None] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True, nullable=True)
    employee_id: Mapped[str | None] = mapped_column(ForeignKey("digital_employees.id"), nullable=True)
    original_name: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(128), default="application/octet-stream")
    size: Mapped[int] = mapped_column(Integer, default=0)
    storage_path: Mapped[str] = mapped_column(String(512))  # 绝对路径
    status: Mapped[str] = mapped_column(String(16), default="uploaded")  # uploaded/extracted/indexed/failed
    extracted_text: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


# P3.12 (2026-06-07): MessageRecord 表 — InsightLab 侧 sanitized messages
# 用于切历史会话时不暴露 system_prompt / context / file_context 注入
class MessageRecord(Base):
    __tablename__ = "messages"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(16))  # user / assistant / tool
    # display_message: 用户真实输入 (前端和历史只展示这个)
    # model_message: 注入 system/context/file/memory 后发给 Hermes 的内部消息 (不返给前端)
    content: Mapped[str] = mapped_column(Text)
    model_message: Mapped[str] = mapped_column(Text, default="")  # 注入后的全文, 审计用
    tool_calls: Mapped[str] = mapped_column(Text, default="[]")  # JSON 列表
    reasoning: Mapped[str] = mapped_column(Text, default="")  # JSON list of model reasoning summaries
    attachments: Mapped[str] = mapped_column(Text, default="[]")  # JSON 文件证据链
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    speaker_employee_id: Mapped[str | None] = mapped_column(ForeignKey("digital_employees.id"), nullable=True)
    speaker_name: Mapped[str] = mapped_column(String(128), default="")
    turn_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class TaskArtifact(Base):
    """Structured task deliverable extracted from assistant output."""
    __tablename__ = "task_artifacts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    message_id: Mapped[str | None] = mapped_column(ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    kind: Mapped[str] = mapped_column(String(32), default="markdown")  # markdown/html/json/csv/mermaid/report
    name: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(128), default="text/plain;charset=utf-8")
    content: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(32), default="assistant")
    source_path: Mapped[str] = mapped_column(String(512), default="")
    storage_path: Mapped[str] = mapped_column(String(512), default="")
    storage_size: Mapped[int] = mapped_column(Integer, default=0)
    managed_status: Mapped[str] = mapped_column(String(24), default="pending")  # pending/managed/missing/failed
    run_id: Mapped[str | None] = mapped_column(ForeignKey("session_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    employee_id: Mapped[str | None] = mapped_column(ForeignKey("digital_employees.id"), nullable=True, index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    provenance_payload: Mapped[str] = mapped_column(Text, default="{}")
    status: Mapped[str] = mapped_column(String(24), default="active")  # active/archived
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class ContextInjection(Base):
    """What InsightLab injected into a model turn: skills, files, memories."""
    __tablename__ = "context_injections"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    message_id: Mapped[str | None] = mapped_column(ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    employee_id: Mapped[str | None] = mapped_column(ForeignKey("digital_employees.id"), nullable=True, index=True)
    turn_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kind: Mapped[str] = mapped_column(String(24), index=True)  # skill/file/memory
    source_id: Mapped[str] = mapped_column(String(64), default="")
    name: Mapped[str] = mapped_column(String(255), default="")
    scope: Mapped[str] = mapped_column(String(32), default="")
    status: Mapped[str] = mapped_column(String(32), default="injected")
    summary: Mapped[str] = mapped_column(Text, default="")
    payload: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class SkillRun(Base):
    """Skill-level runtime health evidence, even when invoked via prompt context."""
    __tablename__ = "skill_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    session_id: Mapped[str | None] = mapped_column(ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True, index=True)
    employee_id: Mapped[str | None] = mapped_column(ForeignKey("digital_employees.id"), nullable=True, index=True)
    skill_id: Mapped[str | None] = mapped_column(ForeignKey("skill_packages.id"), nullable=True, index=True)
    skill_name: Mapped[str] = mapped_column(String(128), default="")
    skill_slug: Mapped[str] = mapped_column(String(128), default="")
    status: Mapped[str] = mapped_column(String(24), default="used")  # used/succeeded/failed/missing
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class CanvasEvent(Base):
    """Auditable collaboration-canvas actions for replay and reuse."""
    __tablename__ = "canvas_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    employee_id: Mapped[str | None] = mapped_column(ForeignKey("digital_employees.id"), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(64), default="canvas.event")
    node_id: Mapped[str] = mapped_column(String(128), default="")
    edge_id: Mapped[str] = mapped_column(String(128), default="")
    payload: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class WorkflowRun(Base):
    """One executable instance of a collaboration canvas/session plan."""
    __tablename__ = "workflow_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    template_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="running")
    strategy: Mapped[str] = mapped_column(String(32), default="relay")
    summary: Mapped[str] = mapped_column(Text, default="")
    payload: Mapped[str] = mapped_column(Text, default="{}")
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class WorkflowNodeRun(Base):
    """Per-node execution evidence for canvas replay."""
    __tablename__ = "workflow_node_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    workflow_run_id: Mapped[str] = mapped_column(ForeignKey("workflow_runs.id", ondelete="CASCADE"), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    employee_id: Mapped[str | None] = mapped_column(ForeignKey("digital_employees.id"), nullable=True, index=True)
    node_id: Mapped[str] = mapped_column(String(128), default="")
    label: Mapped[str] = mapped_column(String(128), default="")
    status: Mapped[str] = mapped_column(String(32), default="idle")
    run_id: Mapped[str | None] = mapped_column(ForeignKey("session_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    hermes_run_id: Mapped[str] = mapped_column(String(128), default="")
    event_count: Mapped[int] = mapped_column(Integer, default=0)
    input_summary: Mapped[str] = mapped_column(Text, default="")
    output_summary: Mapped[str] = mapped_column(Text, default="")
    artifact_ids: Mapped[str] = mapped_column(Text, default="[]")
    error: Mapped[str] = mapped_column(Text, default="")
    payload: Mapped[str] = mapped_column(Text, default="{}")
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class WorkflowStepEvent(Base):
    """Fine-grained replay event inside one workflow node."""
    __tablename__ = "workflow_step_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    workflow_run_id: Mapped[str] = mapped_column(ForeignKey("workflow_runs.id", ondelete="CASCADE"), index=True)
    workflow_node_run_id: Mapped[str | None] = mapped_column(ForeignKey("workflow_node_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    employee_id: Mapped[str | None] = mapped_column(ForeignKey("digital_employees.id"), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(32), default="completed")
    title: Mapped[str] = mapped_column(String(255), default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    input_summary: Mapped[str] = mapped_column(Text, default="")
    output_summary: Mapped[str] = mapped_column(Text, default="")
    raw_event_ref: Mapped[str] = mapped_column(String(128), default="")
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    risk_level: Mapped[str] = mapped_column(String(24), default="low")
    tool_name: Mapped[str] = mapped_column(String(128), default="")
    artifact_ids: Mapped[str] = mapped_column(Text, default="[]")
    file_ids: Mapped[str] = mapped_column(Text, default="[]")
    is_checkpoint: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class WorkflowCheckpoint(Base):
    """Stable restore point for replay/fork/resume."""
    __tablename__ = "workflow_checkpoints"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    workflow_run_id: Mapped[str] = mapped_column(ForeignKey("workflow_runs.id", ondelete="CASCADE"), index=True)
    workflow_node_run_id: Mapped[str | None] = mapped_column(ForeignKey("workflow_node_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    step_event_id: Mapped[str | None] = mapped_column(ForeignKey("workflow_step_events.id", ondelete="SET NULL"), nullable=True, index=True)
    checkpoint_type: Mapped[str] = mapped_column(String(64), default="manual")
    status: Mapped[str] = mapped_column(String(32), default="available")
    summary: Mapped[str] = mapped_column(Text, default="")
    context_snapshot_json: Mapped[str] = mapped_column(Text, default="{}")
    hermes_session_id: Mapped[str] = mapped_column(String(128), default="")
    hermes_run_id: Mapped[str] = mapped_column(String(128), default="")
    upstream_node_outputs_json: Mapped[str] = mapped_column(Text, default="{}")
    artifact_policy_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class WorkflowRunFork(Base):
    """Audit link between an original workflow run and a recovery branch."""
    __tablename__ = "workflow_run_forks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    parent_workflow_run_id: Mapped[str] = mapped_column(ForeignKey("workflow_runs.id", ondelete="CASCADE"), index=True)
    child_workflow_run_id: Mapped[str] = mapped_column(ForeignKey("workflow_runs.id", ondelete="CASCADE"), index=True)
    forked_from_node_run_id: Mapped[str | None] = mapped_column(ForeignKey("workflow_node_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    forked_from_checkpoint_id: Mapped[str | None] = mapped_column(ForeignKey("workflow_checkpoints.id", ondelete="SET NULL"), nullable=True, index=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
