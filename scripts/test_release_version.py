from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import release_version

MANAGED_FILES = {replacement.path for replacement in release_version.REPLACEMENTS} | {
    "frontend/package.json",
    "frontend/package-lock.json",
}


class ReleaseVersionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        for relative_path in MANAGED_FILES:
            source = release_version.PROJECT_ROOT / relative_path
            destination = self.root / relative_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def _fake_npm_version(
        self,
        command: list[str],
        *,
        cwd: Path,
        check: bool,
    ) -> subprocess.CompletedProcess[str]:
        self.assertTrue(check)
        self.assertEqual(self.root / "frontend", cwd)
        version = command[2]
        for filename in ("package.json", "package-lock.json"):
            path = cwd / filename
            metadata = json.loads(path.read_text(encoding="utf-8"))
            metadata["version"] = version
            if filename == "package-lock.json":
                metadata["packages"][""]["version"] = version
            path.write_text(
                json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
        return subprocess.CompletedProcess(command, 0)

    def test_set_updates_every_release_source_and_is_idempotent(self) -> None:
        with (
            patch.object(release_version.shutil, "which", return_value="npm"),
            patch.object(release_version.subprocess, "run", side_effect=self._fake_npm_version),
        ):
            release_version.set_version("0.6.1-beta.2", self.root)
            release_version.set_version("0.6.1-beta.2", self.root)

        versions = release_version.read_versions(self.root)
        self.assertEqual({"0.6.1-beta.2"}, set(versions.values()))
        release_version.check_tag("v0.6.1-beta.2", self.root)

    def test_set_rejects_invalid_semver_without_changes(self) -> None:
        originals = {path: (self.root / path).read_bytes() for path in MANAGED_FILES}

        with self.assertRaises(release_version.VersionError):
            release_version.set_version("0.6.1-beta.01", self.root)

        actual = {path: (self.root / path).read_bytes() for path in MANAGED_FILES}
        self.assertEqual(originals, actual)

    def test_set_restores_files_when_npm_fails(self) -> None:
        originals = {path: (self.root / path).read_bytes() for path in MANAGED_FILES}
        failure = subprocess.CalledProcessError(1, ["npm", "version"])

        with (
            patch.object(release_version.shutil, "which", return_value="npm"),
            patch.object(release_version.subprocess, "run", side_effect=failure),
            self.assertRaises(subprocess.CalledProcessError),
        ):
            release_version.set_version("0.6.1", self.root)

        actual = {path: (self.root / path).read_bytes() for path in MANAGED_FILES}
        self.assertEqual(originals, actual)

    def test_check_rejects_mismatching_tag(self) -> None:
        with self.assertRaises(release_version.VersionError):
            release_version.check_tag("v9.9.9", self.root)


if __name__ == "__main__":
    unittest.main()
