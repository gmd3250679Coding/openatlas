"""Resolve effective memories for a chat session.

Order: Global (locked) -> Tenant (locked) -> User -> Employee.
Locked scope cannot be overridden.  Returns ordered list of dicts (highest
priority first).  Each dict has {id, scope, title, content, priority, locked}.

Bug 8 (2026-06-06): effective memories 注入到 user message 之前,需要去重.
原因:verify_p35.py 反复 fork "Test Memory" / "Test Memory (fork)" 创建了 10+ 条
内容完全相同的 user scope memory 污染了 effective 列表, 12 条重复的 [user]
行拼到 user message 前面, 用户看到 "12 条重复 [user] 记忆".
修法: 按 (scope, title, content) 复合键去重, 保留 priority 最高的.
同时把总长度截断到 2000 字符, 防止 LLM context window 被 memory 吃光.
"""
from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db.models import MemoryBinding, MemoryEntry, Scope, SessionRecord, User


_MAX_CTX_CHARS = 6000


def resolve_effective_memories(
    db: Session, *, tenant_id: str, user_id: str, employee_id: str | None, session_id: str | None = None,
) -> list[dict]:
    synthetic: list[dict] = []
    user = db.get(User, user_id)
    if user and user.tenant_id == tenant_id:
        profile_parts = [
            f"称呼: {user.username or user.email}",
            f"账号: {user.email}",
            f"角色: {user.role.value if hasattr(user.role, 'value') else str(user.role)}",
        ]
        synthetic.append({
            "id": f"synthetic:user-profile:{user_id}",
            "scope": "user_profile",
            "title": "用户画像",
            "content": "；".join(profile_parts),
            "priority": 95,
            "locked": True,
            "source": "runtime",
        })

    recent_rows = db.execute(
        select(SessionRecord)
        .where(
            SessionRecord.tenant_id == tenant_id,
            SessionRecord.user_id == user_id,
            SessionRecord.archived == False,  # noqa: E712
            SessionRecord.message_count > 0,
        )
        .order_by(SessionRecord.updated_at.desc())
        .limit(6)
    ).scalars().all()
    recent_items = []
    for row in recent_rows:
        if session_id and row.id == session_id:
            continue
        title = (row.title or row.last_message or "未命名任务").replace("\n", " ")[:80]
        last = (row.last_message or "").replace("\n", " ")[:120]
        recent_items.append(f"- {title} / 状态: {row.task_status or 'draft'}" + (f" / 最近输入: {last}" if last else ""))
        if len(recent_items) >= 5:
            break
    if recent_items:
        synthetic.append({
            "id": f"synthetic:recent-tasks:{user_id}",
            "scope": "recent_tasks",
            "title": "最近任务摘要",
            "content": "\n".join(recent_items),
            "priority": 70,
            "locked": True,
            "source": "runtime",
        })

    rows = db.execute(
        select(MemoryEntry).where(
            MemoryEntry.tenant_id == tenant_id,
            MemoryEntry.status == "active",
        )
    ).scalars().all()
    bound_rows: list[MemoryEntry] = []
    targets: list[tuple[str, str]] = [("user", user_id), ("tenant", tenant_id)]
    if employee_id:
        targets.append(("employee", employee_id))
    if session_id:
        targets.append(("session", session_id))
    if targets:
        clauses = [
            (MemoryBinding.target_type == target_type) & (MemoryBinding.target_id == target_id)
            for target_type, target_id in targets
            if target_id
        ]
        if clauses:
            bound_rows = db.execute(
                select(MemoryEntry)
                .join(MemoryBinding, MemoryBinding.memory_id == MemoryEntry.id)
                .where(
                    MemoryBinding.tenant_id == tenant_id,
                    MemoryBinding.enabled == True,  # noqa: E712
                    MemoryBinding.injection_mode == "always",
                    MemoryEntry.tenant_id == tenant_id,
                    MemoryEntry.status == "active",
                    or_(*clauses),
                )
            ).scalars().all()

    # Bug 8 去重: 按 (scope, title, content) 复合键, 保留 priority 最高的那条
    dedup: dict[tuple, dict] = {}
    for m in [*rows, *bound_rows]:
        include = False
        if m.scope == Scope.global_:
            include = True
        elif m.scope == Scope.tenant:
            include = True
        elif m.scope == Scope.user and m.owner_user_id == user_id:
            include = True
        elif m.scope == Scope.employee and employee_id and m.employee_id == employee_id:
            include = m.visibility in {"tenant", "public"} or m.created_by == user_id or m.owner_user_id == user_id
        if not include:
            continue
        # Locked: global/tenant default-locked; user/employee default-unlocked
        locked = m.scope in (Scope.global_, Scope.tenant) or m.visibility == "public"
        key = (m.scope.value, m.title, m.content)
        existing = dedup.get(key)
        if existing is None or m.priority > existing["priority"]:
            dedup[key] = {
                "id": m.id,
                "scope": m.scope.value,
                "title": m.title,
                "content": m.content,
                "priority": m.priority,
                "locked": locked,
            }

    eff = [*synthetic, *dedup.values()]
    eff.sort(key=lambda x: (-x["priority"], x["scope"]))
    return eff


def build_context_block(eff: list[dict]) -> str:
    """Format effective memories as the <context>...</context> block to
    prepend to the user message.  Truncates to _MAX_CTX_CHARS characters
    so a polluted memory table can't blow the LLM context window.
    """
    if not eff:
        return ""
    lines = [f"[{m['scope']}] {m['title']}: {m['content']}" for m in eff]
    text = "\n".join(lines)
    if len(text) > _MAX_CTX_CHARS:
        text = text[:_MAX_CTX_CHARS] + "\n[... 已截断 ...]"
    return text
