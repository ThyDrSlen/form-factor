import importlib.util
import unittest
from pathlib import Path


def load_ci_local_module():
    module_path = Path(__file__).resolve().parents[1] / "ci_local.py"
    spec = importlib.util.spec_from_file_location("ci_local", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load module spec for {module_path}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestCiLocalDepcheck(unittest.TestCase):
    def test_depcheck_uses_no_install_and_short_timeout(self):
        ci_local = load_ci_local_module()

        recorded = []

        def fake_run(cmd, cwd=None, check=True, capture=False, timeout=600):
            recorded.append((cmd, timeout))
            return (True, "")

        ci_local.run = fake_run
        ci_local.run_job_quality()

        depcheck_calls = [(cmd, timeout) for cmd, timeout in recorded if "depcheck" in cmd]
        self.assertTrue(depcheck_calls, "Expected run_job_quality() to invoke depcheck")

        depcheck_cmd, depcheck_timeout = depcheck_calls[0]
        self.assertIn(
            "--no-install",
            depcheck_cmd,
            "depcheck must not trigger network installs during pre-push",
        )
        self.assertLessEqual(
            depcheck_timeout,
            120,
            "depcheck should fail fast instead of hanging the pre-push hook",
        )


if __name__ == "__main__":
    unittest.main()
