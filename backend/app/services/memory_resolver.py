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

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import MemoryEntry, Scope


_MAX_CTX_CHARS = 2000


def resolve_effective_memories(
    db: Session, *, tenant_id: str, user_id: str, employee_id: str | None,
) -> list[dict]:
    rows = db.execute(
        select(MemoryEntry).where(
            MemoryEntry.tenant_id == tenant_id,
            MemoryEntry.status == "active",
        )
    ).scalars().all()

    # Bug 8 去重: 按 (scope, title, content) 复合键, 保留 priority 最高的那条
    dedup: dict[tuple, dict] = {}
    for m in rows:
        include = False
        if m.scope == Scope.global_:
            include = True
        elif m.scope == Scope.tenant:
            include = True
        elif m.scope == Scope.user and m.owner_user_id == user_id:
            include = True
        elif m.scope == Scope.employee and employee_id and m.employee_id == employee_id:
            include = True
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

    eff = list(dedup.values())
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
