"""DB session + auto-init (no alembic for MVP)."""
from __future__ import annotations

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import SQLITE_PATH
from app.core.config import (
    DEFAULT_ADMIN_EMAIL,
    DEFAULT_ADMIN_PASSWORD,
    DEFAULT_TENANT_NAME,
    DEFAULT_TENANT_SLUG,
)
from app.core.security import hash_password
from app.db.models import (
    Base,
    CanvasEvent,
    CollaborationTemplate,
    ContextInjection,
    DigitalEmployee,
    EmployeeStatus,
    FileAsset,
    HermesRuntime,
    MessageRecord,
    OrganizationUnit,
    Scope,
    SessionRecord,
    SkillRun,
    SkillPackage,
    TaskArtifact,
    Tenant,
    User,
    UserRole,
    WorkflowCheckpoint,
    WorkflowRunFork,
    WorkflowStepEvent,
)


engine = create_engine(
    f"sqlite:///{SQLITE_PATH}",
    connect_args={"check_same_thread": False},
    echo=False,
)


@event.listens_for(engine, "connect")
def _enable_sqlite_fk(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def init_db() -> None:
    """Create tables + seed demo tenant & admin if empty.

    Phase 2: also backfills api_key_encrypted/pid columns for existing rows,
    and normalizes legacy 'healthy' status to 'running'.
    """
    Base.metadata.create_all(engine)
    # Phase 2: cheap SQLite backfill (idempotent ALTER TABLE)
    with engine.connect() as conn:
        cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(hermes_runtimes)").fetchall()}
        if "api_key_encrypted" not in cols:
            conn.exec_driver_sql("ALTER TABLE hermes_runtimes ADD COLUMN api_key_encrypted VARCHAR(255) DEFAULT ''")
        if "pid" not in cols:
            conn.exec_driver_sql("ALTER TABLE hermes_runtimes ADD COLUMN pid INTEGER")
        # Phase 3.4 — resource limits on tenants
        tcols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(tenants)").fetchall()}
        if "max_sessions" not in tcols:
            conn.exec_driver_sql("ALTER TABLE tenants ADD COLUMN max_sessions INTEGER")
        if "max_employees" not in tcols:
            conn.exec_driver_sql("ALTER TABLE tenants ADD COLUMN max_employees INTEGER")
        ucols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(users)").fetchall()}
        if "org_unit_id" not in ucols:
            conn.exec_driver_sql("ALTER TABLE users ADD COLUMN org_unit_id VARCHAR(36)")
        # P3.11 (2026-06-06): 群聊接力员工列表回填 (Bug 3/4/11).
        # SessionRecord.participant_ids 加列, 存 json string, 默认 "[]".
        # createBase.metadata.create_all 上面那行已经给新 DB 建好列了, 这里
        # 补 ALTER TABLE 给老 DB.
        scols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(sessions)").fetchall()}
        if "participant_ids" not in scols:
            conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN participant_ids TEXT DEFAULT '[]'")
        if "canvas_state" not in scols:
            conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN canvas_state TEXT DEFAULT ''")
        if "reusable_template_id" not in scols:
            conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN reusable_template_id VARCHAR(36)")
        if "archived" not in scols:
            conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN archived BOOLEAN DEFAULT 0")
        if "pinned" not in scols:
            conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN pinned BOOLEAN DEFAULT 0")
        if "workspace" not in scols:
            conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN workspace VARCHAR(128) DEFAULT ''")
        if "model_override" not in scols:
            conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN model_override VARCHAR(128) DEFAULT ''")
        if "task_status" not in scols:
            conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN task_status VARCHAR(24) DEFAULT 'draft'")
        if "task_summary" not in scols:
            conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN task_summary TEXT DEFAULT ''")
        if "summary_updated_at" not in scols:
            conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN summary_updated_at DATETIME")
        acols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(task_artifacts)").fetchall()}
        if "source_path" not in acols:
            conn.exec_driver_sql("ALTER TABLE task_artifacts ADD COLUMN source_path VARCHAR(512) DEFAULT ''")
        if "run_id" not in acols:
            conn.exec_driver_sql("ALTER TABLE task_artifacts ADD COLUMN run_id VARCHAR(36)")
        if "employee_id" not in acols:
            conn.exec_driver_sql("ALTER TABLE task_artifacts ADD COLUMN employee_id VARCHAR(36)")
        if "version" not in acols:
            conn.exec_driver_sql("ALTER TABLE task_artifacts ADD COLUMN version INTEGER DEFAULT 1")
        if "provenance_payload" not in acols:
            conn.exec_driver_sql("ALTER TABLE task_artifacts ADD COLUMN provenance_payload TEXT DEFAULT '{}'")
        mcols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(messages)").fetchall()}
        if "speaker_employee_id" not in mcols:
            conn.exec_driver_sql("ALTER TABLE messages ADD COLUMN speaker_employee_id VARCHAR(36)")
        if "speaker_name" not in mcols:
            conn.exec_driver_sql("ALTER TABLE messages ADD COLUMN speaker_name VARCHAR(128) DEFAULT ''")
        if "turn_index" not in mcols:
            conn.exec_driver_sql("ALTER TABLE messages ADD COLUMN turn_index INTEGER")
        if "input_tokens" not in mcols:
            conn.exec_driver_sql("ALTER TABLE messages ADD COLUMN input_tokens INTEGER DEFAULT 0")
        if "output_tokens" not in mcols:
            conn.exec_driver_sql("ALTER TABLE messages ADD COLUMN output_tokens INTEGER DEFAULT 0")
        if "total_tokens" not in mcols:
            conn.exec_driver_sql("ALTER TABLE messages ADD COLUMN total_tokens INTEGER DEFAULT 0")
        if "attachments" not in mcols:
            conn.exec_driver_sql("ALTER TABLE messages ADD COLUMN attachments TEXT DEFAULT '[]'")
        if "reasoning" not in mcols:
            conn.exec_driver_sql("ALTER TABLE messages ADD COLUMN reasoning TEXT DEFAULT ''")
        ccols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(collaboration_templates)").fetchall()}
        if "category" not in ccols:
            conn.exec_driver_sql("ALTER TABLE collaboration_templates ADD COLUMN category VARCHAR(64) DEFAULT 'general'")
        if "visibility" not in ccols:
            conn.exec_driver_sql("ALTER TABLE collaboration_templates ADD COLUMN visibility VARCHAR(16) DEFAULT 'private'")
        conn.commit()
    with SessionLocal() as db:
        # Backfill api_key → api_key_encrypted for legacy rows
        for r in db.query(HermesRuntime).all():
            if not r.api_key_encrypted and r.api_key:
                r.api_key_encrypted = r.api_key
            if r.status == "healthy":
                r.status = "running"
        db.commit()

        if db.query(Tenant).filter_by(slug=DEFAULT_TENANT_SLUG).first():
            demo = db.query(Tenant).filter_by(slug=DEFAULT_TENANT_SLUG).first()
            if demo and not db.query(OrganizationUnit).filter_by(tenant_id=demo.id).first():
                root = OrganizationUnit(
                    tenant_id=demo.id,
                    parent_id=None,
                    name=demo.name,
                    code="ROOT",
                    description="默认组织根节点",
                    sort_order=0,
                )
                db.add(root)
                db.flush()
                for idx, (name, code) in enumerate([("经营管理部", "OPS"), ("市场销售部", "SALES"), ("人力行政部", "HR")], 1):
                    db.add(OrganizationUnit(
                        tenant_id=demo.id,
                        parent_id=root.id,
                        name=name,
                        code=code,
                        description="演示组织单元",
                        sort_order=idx,
                    ))
                admin_user = db.query(User).filter_by(tenant_id=demo.id, email=DEFAULT_ADMIN_EMAIL).first()
                if admin_user:
                    admin_user.org_unit_id = root.id
                db.commit()
            return
        tenant = Tenant(slug=DEFAULT_TENANT_SLUG, name=DEFAULT_TENANT_NAME)
        db.add(tenant)
        db.flush()
        root_org = OrganizationUnit(
            tenant_id=tenant.id,
            parent_id=None,
            name=tenant.name,
            code="ROOT",
            description="默认组织根节点",
            sort_order=0,
        )
        db.add(root_org)
        db.flush()
        for idx, (name, code) in enumerate([("经营管理部", "OPS"), ("市场销售部", "SALES"), ("人力行政部", "HR")], 1):
            db.add(OrganizationUnit(
                tenant_id=tenant.id,
                parent_id=root_org.id,
                name=name,
                code=code,
                description="演示组织单元",
                sort_order=idx,
            ))
        admin = User(
            tenant_id=tenant.id,
            org_unit_id=root_org.id,
            email=DEFAULT_ADMIN_EMAIL,
            username="王六",
            password_hash=hash_password(DEFAULT_ADMIN_PASSWORD),
            role=UserRole.tenant_admin,
        )
        db.add(admin)
        db.flush()
        runtime = HermesRuntime(
            tenant_id=tenant.id,
            runtime_type="process",
            gateway_base_url="http://127.0.0.1:58642",
            api_key="openatlas-demo-dev-key",
            api_key_encrypted="openatlas-demo-dev-key",
            hermes_home_path="/Users/macbook/.openatlas/hermes-tenants/demo/.hermes",
            port=58642,
            status="running",
        )
        db.add(runtime)
        # Seed one global skill (the spec calls for a global Skill Market)
        global_skill = SkillPackage(
            scope=Scope.global_,
            owner_tenant_id=None,
            owner_user_id=None,
            name="Hermes Built-in Tools",
            slug="hermes-builtin-tools",
            description="All built-in Hermes toolsets available to the runtime.",
            category="runtime",
            version="1.0.0",
            visibility="public",
            mutable=False,
            created_by=admin.id,
        )
        db.add(global_skill)
        # Seed a demo digital employee so the list is non-empty
        emp = DigitalEmployee(
            tenant_id=tenant.id,
            display_name="Atlas 助手",
            profile_name=f"tenant_{tenant.slug}__employee_atlas_helper",
            description="默认演示员工，擅长通用问答与文件操作。",
            avatar="A",
            status=EmployeeStatus.active,
            model="hermes-agent",
            provider="hermes",
            system_prompt="你是一名高效、耐心的企业数字员工，名字叫 Atlas 助手。",
            created_by=admin.id,
        )
        db.add(emp)
        db.commit()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
