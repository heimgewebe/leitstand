from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = (
    Path(__file__).resolve().parents[1]
    / "scripts"
    / "decision_axis_selection.py"
)
SPEC = importlib.util.spec_from_file_location(
    "decision_axis_selection",
    MODULE_PATH,
)
assert SPEC is not None and SPEC.loader is not None
selection = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(selection)


def current_ball(
    task_id: str,
    *,
    status: str,
    kind: str,
    lane: str | None = None,
    title: str | None = None,
    task_ids: list[str] | None = None,
) -> dict[str, object]:
    current: dict[str, object] = {
        "kind": kind,
        "task_id": task_id,
        "title": title or task_id,
    }
    if lane is not None:
        current["queue_lane"] = lane
    return {
        "status": status,
        "current_ball": current,
        "task_ids": task_ids or [task_id],
    }


class DecisionAxisSelectionTests(unittest.TestCase):
    def test_projects_global_active_and_conflict_free_now_corridor(self) -> None:
        projection = {
            "next_actions": [
                {"task_id": "AUDIO-T001", "queue_lane": "now"},
                {"task_id": "CROSS-T022", "queue_lane": "now"},
                {"task_id": "NEXT-T021", "queue_lane": "next"},
                {"task_id": "GRABOWSKI-T083", "queue_lane": "now"},
                {"task_id": "BUREAU-T069", "queue_lane": "now"},
                {"task_id": "REPOGROUND-T004", "queue_lane": "now"},
                {"task_id": "REPOGROUND-T012", "queue_lane": "now"},
            ],
            "repository_balls": {
                "repo.audio": current_ball(
                    "AUDIO-T001",
                    status="active",
                    kind="active_run",
                    task_ids=["AUDIO-T001"],
                ),
                "repo.bureau": current_ball(
                    "BUREAU-RUN-T009",
                    status="active",
                    kind="active_run",
                    task_ids=[
                        "BUREAU-RUN-T009",
                        "CROSS-T022",
                        "BUREAU-T069",
                        "NEXT-T021",
                    ],
                ),
                "repo.grabowski": current_ball(
                    "GRABOWSKI-T083",
                    status="active",
                    kind="active_run",
                    task_ids=[
                        "GRABOWSKI-T083",
                        "CROSS-T022",
                        "NEXT-T021",
                    ],
                ),
                "repo.repoground": current_ball(
                    "REPOGROUND-T004",
                    status="ready",
                    kind="eligible_task",
                    lane="now",
                    task_ids=["REPOGROUND-T004", "REPOGROUND-T012"],
                ),
            },
        }
        task_by_id = {
            task_id: {"title": f"Title {task_id}"}
            for task_id in [
                "AUDIO-T001",
                "CROSS-T022",
                "NEXT-T021",
                "GRABOWSKI-T083",
                "BUREAU-T069",
                "REPOGROUND-T004",
                "REPOGROUND-T012",
                "BUREAU-RUN-T009",
            ]
        }

        now_items, later_items = selection.build_decision_axis_queue_items(
            projection,
            task_by_id,
        )

        self.assertEqual(
            [item["id"] for item in now_items],
            [
                "AUDIO-T001",
                "BUREAU-RUN-T009",
                "GRABOWSKI-T083",
                "REPOGROUND-T004",
            ],
        )
        self.assertEqual([item["id"] for item in later_items], ["NEXT-T021"])
        self.assertIn("global first · already active", now_items[0]["meta"])
        self.assertIn("already active", now_items[1]["meta"])
        self.assertIn("parallel claimable", now_items[3]["meta"])
        self.assertNotIn("CROSS-T022", {item["id"] for item in later_items})
        self.assertTrue(
            all("Queue-Lane: now" not in item["detail"] for item in later_items)
        )

    def test_deduplicates_one_cross_repository_current_ball(self) -> None:
        projection = {
            "next_actions": [
                {"task_id": "GLOBAL", "queue_lane": "now"},
                {"task_id": "CROSS", "queue_lane": "now"},
            ],
            "repository_balls": {
                "repo.audio": current_ball(
                    "GLOBAL",
                    status="ready",
                    kind="eligible_task",
                    lane="now",
                ),
                "repo.bureau": current_ball(
                    "CROSS",
                    status="ready",
                    kind="eligible_task",
                    lane="now",
                    task_ids=["CROSS"],
                ),
                "repo.grabowski": current_ball(
                    "CROSS",
                    status="ready",
                    kind="eligible_task",
                    lane="now",
                    task_ids=["CROSS"],
                ),
            },
        }

        now_items, later_items = selection.build_decision_axis_queue_items(
            projection,
            {},
        )

        self.assertEqual([item["id"] for item in now_items], ["GLOBAL", "CROSS"])
        self.assertEqual(later_items, [])
        self.assertIn("repo.bureau + repo.grabowski", now_items[1]["meta"])

    def test_active_ball_occupies_domain_before_claimable_action(self) -> None:
        projection = {
            "next_actions": [
                {"task_id": "GLOBAL", "queue_lane": "now"},
                {"task_id": "READY-SAME-DOMAIN", "queue_lane": "now"},
            ],
            "repository_balls": {
                "repo.global": current_ball(
                    "GLOBAL",
                    status="ready",
                    kind="eligible_task",
                    lane="now",
                ),
                "repo.shared": current_ball(
                    "ACTIVE",
                    status="active",
                    kind="active_run",
                    task_ids=["ACTIVE", "READY-SAME-DOMAIN"],
                ),
            },
        }

        now_items, later_items = selection.build_decision_axis_queue_items(
            projection,
            {},
        )

        self.assertEqual([item["id"] for item in now_items], ["GLOBAL", "ACTIVE"])
        self.assertEqual(later_items, [])

    def test_bounds_now_items_and_orders_active_domains_deterministically(self) -> None:
        balls = {
            "repo.global": current_ball(
                "GLOBAL",
                status="ready",
                kind="eligible_task",
                lane="now",
            )
        }
        for index in range(8):
            balls[f"repo.{index}"] = current_ball(
                f"ACTIVE-{index}",
                status="active",
                kind="active_run",
            )
        projection = {
            "next_actions": [{"task_id": "GLOBAL", "queue_lane": "now"}],
            "repository_balls": balls,
        }

        now_items, later_items = selection.build_decision_axis_queue_items(
            projection,
            {},
        )

        self.assertEqual(len(now_items), 6)
        self.assertEqual(
            [item["id"] for item in now_items],
            ["GLOBAL", "ACTIVE-0", "ACTIVE-1", "ACTIVE-2", "ACTIVE-3", "ACTIVE-4"],
        )
        self.assertEqual(later_items, [])

    def test_unknown_global_domain_blocks_parallel_corridor(self) -> None:
        projection = {
            "next_actions": [
                {"task_id": "GLOBAL-UNKNOWN", "queue_lane": "now"},
                {"task_id": "READY", "queue_lane": "now"},
            ],
            "repository_balls": {
                "repo.active": current_ball(
                    "ACTIVE",
                    status="active",
                    kind="active_run",
                ),
                "repo.ready": current_ball(
                    "READY",
                    status="ready",
                    kind="eligible_task",
                    lane="now",
                ),
            },
        }

        now_items, later_items = selection.build_decision_axis_queue_items(
            projection,
            {},
        )

        self.assertEqual([item["id"] for item in now_items], ["GLOBAL-UNKNOWN"])
        self.assertEqual(later_items, [])
        self.assertIn("unknown", now_items[0]["meta"])

    def test_unknown_domain_fails_closed_for_parallel_now(self) -> None:
        projection = {
            "next_actions": [
                {"task_id": "GLOBAL", "queue_lane": "now"},
                {"task_id": "UNKNOWN-NOW", "queue_lane": "now"},
                {"task_id": "NEXT", "queue_lane": "next"},
            ],
            "repository_balls": {
                "repo.global": current_ball(
                    "GLOBAL",
                    status="ready",
                    kind="eligible_task",
                    lane="now",
                )
            },
        }

        now_items, later_items = selection.build_decision_axis_queue_items(
            projection,
            {},
        )

        self.assertEqual([item["id"] for item in now_items], ["GLOBAL"])
        self.assertEqual([item["id"] for item in later_items], ["NEXT"])

    def test_rejects_invalid_limits(self) -> None:
        with self.assertRaisesRegex(ValueError, "item limits"):
            selection.build_decision_axis_queue_items(
                {},
                {},
                max_now_items=0,
            )


if __name__ == "__main__":
    unittest.main()
