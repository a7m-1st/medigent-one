"""
Toolkit Pool — Per-Project Toolkit Instance Reuse
===================================================

Eliminates redundant toolkit instantiation by maintaining a pool of toolkit
instances scoped to each project. When a workforce is reconstructed (e.g.,
for a follow-up question), toolkits are retrieved from the pool instead of
being created from scratch.

Problem:
    Previously, every workforce construction created 12-15 toolkit instances
    from scratch — ImageAnalysisToolkit, DocumentAnalysisToolkit,
    NoteTakingToolkit, PubMedToolkit, SearchToolkit, FileToolkit,
    TerminalToolkit, and HumanToolkit — even when the same project was
    reusing the same configuration.

Solution:
    This pool caches toolkit instances by (project_id, toolkit_class,
    agent_name) tuple. Toolkits that are stateless after initialization
    (ImageAnalysisToolkit, DocumentAnalysisToolkit, PubMedToolkit) are
    always reused. Toolkits with per-project mutable state
    (NoteTakingToolkit, SearchToolkit, FileToolkit) are also reused
    since their state is project-scoped anyway.

    Toolkits with per-session state (TerminalToolkit, HumanToolkit) are
    excluded from pooling — they are always created fresh.

Thread Safety:
    Uses threading.Lock for safe access from agent creation threads
    (asyncio.to_thread).

Usage:
    from app.service.toolkit_pool import get_or_create_toolkit

    toolkit = get_or_create_toolkit(
        project_id="proj_123",
        toolkit_class=ImageAnalysisToolkit,
        agent_name="radiologist",
        # kwargs passed to constructor if creating new:
        api_task_id="proj_123",
        model=toolkit_model,
    )
"""

import logging
import threading
from typing import Any, Type

logger = logging.getLogger("toolkit_pool")

# Pool structure: { project_id: { (toolkit_class_name, agent_name): instance } }
_toolkit_pool: dict[str, dict[tuple[str, str], Any]] = {}
_pool_lock = threading.Lock()

# Toolkit classes that should NOT be pooled due to per-session mutable state.
# These are identified by class name to avoid import dependencies.
_NON_POOLABLE_TOOLKITS = frozenset({
    "TerminalToolkit",  # Per-session command counts, venv state, thread pool
    "HumanToolkit",     # Registers per-agent human input listener on init
})


def get_or_create_toolkit(
    project_id: str,
    toolkit_class: Type,
    pool_key: str,
    **kwargs: Any,
) -> Any:
    """Get an existing toolkit instance or create a new one.

    Returns a cached instance if one exists for the same (project_id,
    toolkit_class, pool_key) combination. Otherwise creates a new
    instance and caches it.

    Toolkits in _NON_POOLABLE_TOOLKITS are always created fresh.

    Args:
        project_id: The project ID that scopes this toolkit.
        toolkit_class: The toolkit class to instantiate.
        pool_key: A string key to distinguish toolkit instances within the
            same project and class (typically the agent name). This avoids
            name collision with the toolkit constructor's own `agent_name`
            parameter.
        **kwargs: Constructor arguments passed to toolkit_class() if creating
            a new instance.

    Returns:
        A toolkit instance (shared if cached, new otherwise).
    """
    class_name = toolkit_class.__name__

    # Skip pooling for toolkits with per-session state
    if class_name in _NON_POOLABLE_TOOLKITS:
        logger.debug(
            f"Creating fresh {class_name} for key={pool_key} "
            f"(non-poolable)"
        )
        return toolkit_class(**kwargs)

    cache_key = (class_name, pool_key)

    with _pool_lock:
        project_pool = _toolkit_pool.get(project_id)
        if project_pool and cache_key in project_pool:
            logger.debug(
                f"Reusing pooled {class_name} for "
                f"project={project_id}, key={pool_key}"
            )
            return project_pool[cache_key]

    # Create outside the lock to avoid holding it during initialization
    logger.info(
        f"Creating new {class_name} for "
        f"project={project_id}, key={pool_key}"
    )
    instance = toolkit_class(**kwargs)

    with _pool_lock:
        if project_id not in _toolkit_pool:
            _toolkit_pool[project_id] = {}

        # Double-check: another thread may have created it
        if cache_key not in _toolkit_pool[project_id]:
            _toolkit_pool[project_id][cache_key] = instance
        else:
            instance = _toolkit_pool[project_id][cache_key]

    return instance


def clear_project_pool(project_id: str) -> int:
    """Remove all cached toolkits for a specific project.

    Call this when a project session ends or when the workforce is
    destroyed permanently.

    Args:
        project_id: The project ID whose toolkits should be cleared.

    Returns:
        Number of toolkit instances removed.
    """
    with _pool_lock:
        pool = _toolkit_pool.pop(project_id, {})
        count = len(pool)
        if count > 0:
            logger.info(
                f"Cleared toolkit pool for project={project_id} "
                f"({count} toolkits removed)"
            )
        return count


def clear_all_pools() -> int:
    """Remove all cached toolkits across all projects.

    Call this during application shutdown.

    Returns:
        Total number of toolkit instances removed.
    """
    with _pool_lock:
        total = sum(len(pool) for pool in _toolkit_pool.values())
        _toolkit_pool.clear()
        logger.info(f"Cleared all toolkit pools ({total} toolkits removed)")
        return total


def get_pool_stats() -> dict[str, int]:
    """Return current pool statistics for debugging/monitoring.

    Returns:
        Dictionary with project-level toolkit counts.
    """
    with _pool_lock:
        stats = {
            "total_projects": len(_toolkit_pool),
            "total_toolkits": sum(len(pool) for pool in _toolkit_pool.values()),
        }
        for project_id, pool in _toolkit_pool.items():
            stats[f"project_{project_id}"] = len(pool)
        return stats
