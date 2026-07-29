from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class RunbookContractTests(unittest.TestCase):
    def test_local_release_runbook_documents_secure_source_ancestry(self) -> None:
        runbook = (ROOT / "docs/runbooks/local-release-runtime.md").read_text(
            encoding="utf-8"
        )
        required = (
            "### Secure deployment-source ancestry",
            "`assert_secure_ancestry` verifies the checkout and every relevant component",
            "below `/home/alex/repos/.leitstand-worktrees/...` is rejected",
            "~/.local/state/leitstand/deploy-sources/<commit>",
            "Do not move, chmod, clean or reuse a foreign worktree.",
            "does not itself change units, release selectors or running services",
        )
        for statement in required:
            with self.subTest(statement=statement):
                self.assertIn(statement, runbook)


if __name__ == "__main__":
    unittest.main()
