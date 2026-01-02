import json
import unittest
from pathlib import Path


class TestEasNewArchEnv(unittest.TestCase):
    def test_staging_and_production_enable_new_arch_by_default(self):
        repo_root = Path(__file__).resolve().parents[2]
        eas_path = repo_root / "eas.json"
        eas_config = json.loads(eas_path.read_text())

        build = eas_config.get("build", {})
        for profile_name in ("staging", "production"):
            profile = build.get(profile_name, {})
            env = profile.get("env", {})
            self.assertEqual(
                env.get("EXPO_USE_NEW_ARCH"),
                "1",
                f"Expected {profile_name}.env.EXPO_USE_NEW_ARCH to be '1' to keep New Architecture enabled",
            )


if __name__ == "__main__":
    unittest.main()
