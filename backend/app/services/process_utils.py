"""Process utilities shared across the backend."""
from __future__ import annotations
import os
import signal


def is_pid_alive(pid: int | None) -> bool:
    """Return True if `pid` exists and is signalable.

    Mirrors the convention used by the supervisor: signal 0 returns 0 on
    a live process we own, raises ``ProcessLookupError`` (errno ESRCH) on
    a dead process, and ``PermissionError`` (errno EPERM) on a process we
    can't signal but that DOES exist. We treat the latter as "alive" so
    we don't accidentally flag a sibling tenant's gateway as dead.
    """
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def terminate_pid(pid: int | None, *, grace: float = 5.0) -> None:
    """SIGTERM and escalate to SIGKILL after `grace` seconds if still alive."""
    import time
    if not pid or not is_pid_alive(pid):
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.time() + grace
    while time.time() < deadline:
        if not is_pid_alive(pid):
            return
        time.sleep(0.1)
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        return
