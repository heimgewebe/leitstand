#!/usr/bin/env python3
from __future__ import annotations

from collections.abc import Mapping

UNKNOWN = "unknown"


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _repository_balls(
    status_projection: Mapping[str, object],
) -> dict[str, Mapping[str, object]]:
    raw = status_projection.get("repository_balls")
    if not isinstance(raw, Mapping):
        return {}
    return {
        str(domain): ball
        for domain, ball in raw.items()
        if isinstance(domain, str) and isinstance(ball, Mapping)
    }


def _task_domains(
    balls: Mapping[str, Mapping[str, object]],
) -> dict[str, tuple[str, ...]]:
    domains_by_task: dict[str, set[str]] = {}
    for domain, ball in balls.items():
        task_ids = ball.get("task_ids")
        if not isinstance(task_ids, list):
            continue
        for raw_task_id in task_ids:
            task_id = _text(raw_task_id)
            if task_id:
                domains_by_task.setdefault(task_id, set()).add(domain)
    return {
        task_id: tuple(sorted(domains))
        for task_id, domains in domains_by_task.items()
    }


def _current_balls(
    balls: Mapping[str, Mapping[str, object]],
) -> dict[str, dict[str, object]]:
    current_by_task: dict[str, dict[str, object]] = {}
    for domain, ball in balls.items():
        current = ball.get("current_ball")
        if not isinstance(current, Mapping):
            continue
        task_id = _text(current.get("task_id"))
        if not task_id:
            continue
        entry = current_by_task.setdefault(
            task_id,
            {
                "domains": set(),
                "statuses": set(),
                "kinds": set(),
                "queue_lanes": set(),
                "title": "",
            },
        )
        entry["domains"].add(domain)
        status = _text(ball.get("status"))
        kind = _text(current.get("kind"))
        lane = _text(current.get("queue_lane"))
        if status:
            entry["statuses"].add(status)
        if kind:
            entry["kinds"].add(kind)
        if lane:
            entry["queue_lanes"].add(lane)
        if not entry["title"]:
            entry["title"] = _text(current.get("title"))
    return current_by_task


def _ranked_actions(
    status_projection: Mapping[str, object],
) -> list[Mapping[str, object]]:
    raw = status_projection.get("next_actions")
    if not isinstance(raw, list):
        return []
    return [
        action
        for action in raw
        if isinstance(action, Mapping) and _text(action.get("task_id"))
    ]


def _title(
    task_id: str,
    *,
    task_by_id: Mapping[str, Mapping[str, object]],
    current: Mapping[str, object] | None = None,
) -> str:
    task = task_by_id.get(task_id)
    if isinstance(task, Mapping):
        value = _text(task.get("title"))
        if value:
            return value
    if isinstance(current, Mapping):
        value = _text(current.get("title"))
        if value:
            return value
    return task_id


def _domains_for(
    task_id: str,
    memberships: Mapping[str, tuple[str, ...]],
    current_by_task: Mapping[str, Mapping[str, object]],
) -> tuple[str, ...]:
    domains = memberships.get(task_id, ())
    if domains:
        return domains
    current = current_by_task.get(task_id)
    if not isinstance(current, Mapping):
        return ()
    raw = current.get("domains")
    if not isinstance(raw, set):
        return ()
    return tuple(sorted(str(value) for value in raw))


def _item(
    task_id: str,
    *,
    title: str,
    role: str,
    domains: tuple[str, ...],
    detail: str,
    source: str,
) -> dict[str, str]:
    domain_text = " + ".join(domains) if domains else UNKNOWN
    return {
        "id": task_id,
        "title": title,
        "detail": detail,
        "meta": f"{source} · {role} · {domain_text}",
    }


def build_decision_axis_queue_items(
    status_projection: Mapping[str, object] | None,
    task_by_id: Mapping[str, Mapping[str, object]],
    *,
    max_now_items: int = 6,
    max_later_items: int = 5,
) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    """Project a bounded, conflict-free Now corridor from Bureau truth.

    This function is read-only. It preserves Bureau's supplied ranking and uses
    repository_balls as the execution-domain projection. Unknown domains fail
    closed for additional parallel work.
    """
    if not isinstance(status_projection, Mapping):
        return [], []
    if max_now_items < 1 or max_later_items < 0:
        raise ValueError("decision-axis item limits are invalid")

    actions = _ranked_actions(status_projection)
    balls = _repository_balls(status_projection)
    memberships = _task_domains(balls)
    current_by_task = _current_balls(balls)

    now_items: list[dict[str, str]] = []
    selected_task_ids: set[str] = set()
    occupied_domains: set[str] = set()
    parallel_selection_allowed = not actions

    if actions:
        global_action = actions[0]
        task_id = _text(global_action.get("task_id"))
        current = current_by_task.get(task_id)
        domains = _domains_for(task_id, memberships, current_by_task)
        statuses = (
            current.get("statuses", set())
            if isinstance(current, Mapping)
            else set()
        )
        kinds = (
            current.get("kinds", set())
            if isinstance(current, Mapping)
            else set()
        )
        active = "active" in statuses or "active_run" in kinds
        role = "global first · already active" if active else "global first"
        lane = _text(global_action.get("queue_lane")) or UNKNOWN
        now_items.append(
            _item(
                task_id,
                title=_title(task_id, task_by_id=task_by_id, current=current),
                role=role,
                domains=domains,
                detail=(
                    "Globale Bureau-Spitzenpriorität; "
                    f"kanonische Queue-Lane: {lane}"
                ),
                source="Bureau status-projection",
            )
        )
        selected_task_ids.add(task_id)
        occupied_domains.update(domains)
        parallel_selection_allowed = bool(domains)

    active_candidates: list[
        tuple[tuple[str, ...], str, Mapping[str, object]]
    ] = []
    for task_id, current in current_by_task.items():
        statuses = current.get("statuses", set())
        kinds = current.get("kinds", set())
        if "active" not in statuses and "active_run" not in kinds:
            continue
        domains = _domains_for(task_id, memberships, current_by_task)
        active_candidates.append((domains, task_id, current))

    for domains, task_id, current in sorted(
        active_candidates,
        key=lambda value: (value[0], value[1]),
    ):
        if len(now_items) >= max_now_items:
            break
        if (
            not parallel_selection_allowed
            or task_id in selected_task_ids
            or not domains
            or occupied_domains.intersection(domains)
        ):
            continue
        now_items.append(
            _item(
                task_id,
                title=_title(task_id, task_by_id=task_by_id, current=current),
                role="already active",
                domains=domains,
                detail=(
                    "Aktiver Bureau-Repository-Ball; "
                    "keine neue Claim-Entscheidung"
                ),
                source="Bureau repository_balls",
            )
        )
        selected_task_ids.add(task_id)
        occupied_domains.update(domains)

    for action in actions:
        if len(now_items) >= max_now_items:
            break
        task_id = _text(action.get("task_id"))
        if (
            not parallel_selection_allowed
            or task_id in selected_task_ids
            or _text(action.get("queue_lane")) != "now"
        ):
            continue
        current = current_by_task.get(task_id)
        if not isinstance(current, Mapping):
            continue
        statuses = current.get("statuses", set())
        kinds = current.get("kinds", set())
        lanes = current.get("queue_lanes", set())
        if (
            "ready" not in statuses
            or "eligible_task" not in kinds
            or "now" not in lanes
        ):
            continue
        domains = _domains_for(task_id, memberships, current_by_task)
        if not domains or occupied_domains.intersection(domains):
            continue
        now_items.append(
            _item(
                task_id,
                title=_title(task_id, task_by_id=task_by_id, current=current),
                role="parallel claimable",
                domains=domains,
                detail=(
                    "Konfliktfreier aktueller Repository-Ball "
                    "in der kanonischen Now-Lane"
                ),
                source="Bureau status-projection",
            )
        )
        selected_task_ids.add(task_id)
        occupied_domains.update(domains)

    later_items: list[dict[str, str]] = []
    for action in actions:
        if len(later_items) >= max_later_items:
            break
        task_id = _text(action.get("task_id"))
        lane = _text(action.get("queue_lane")) or UNKNOWN
        if task_id in selected_task_ids or lane == "now":
            continue
        current = current_by_task.get(task_id)
        domains = _domains_for(task_id, memberships, current_by_task)
        later_items.append(
            _item(
                task_id,
                title=_title(task_id, task_by_id=task_by_id, current=current),
                role="after parallel corridor",
                domains=domains,
                detail=f"Weitere kanonische Bureau-Aktion; Queue-Lane: {lane}",
                source="Bureau status-projection",
            )
        )

    return now_items, later_items
