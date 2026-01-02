import os
import subprocess
import unittest
from pathlib import Path


class TestPrePushSkip(unittest.TestCase):
    def test_pre_push_can_skip_ci_local_via_env_var(self):
        repo_root = Path(__file__).resolve().parents[2]
        pre_push = repo_root / ".husky" / "pre-push"

        env = os.environ.copy()
        env["CI_LOCAL_SKIP"] = "1"

        def to_text(value):
            if value is None:
                return ""
            if isinstance(value, bytes):
                return value.decode(errors="replace")
            return str(value)

        try:
            result = subprocess.run(
                [str(pre_push)],
                cwd=repo_root,
                env=env,
                text=True,
                capture_output=True,
                timeout=2,
            )
        except subprocess.TimeoutExpired as e:
            combined = "\n".join([to_text(e.stdout), to_text(e.stderr)]).strip()
            self.fail(f"pre-push did not exit quickly when CI_LOCAL_SKIP=1\n{combined}")

        combined = "\n".join([result.stdout, result.stderr]).strip()
        self.assertEqual(result.returncode, 0, combined)
        self.assertIn("Skipping local CI checks", combined)
        self.assertNotIn("Running full CI checks before push", combined)


if __name__ == "__main__":
    unittest.main()
