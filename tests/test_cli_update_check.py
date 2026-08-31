from __future__ import annotations

import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from lsm_cli import update_install
from lsm_cli.client import CLILocalInputError
from lsm_cli.main import main
from lsm_cli.update import (
    install_latest_release,
    install_skill_tree,
    verify_release_checksum,
)


class CLIUpdateCheckTests(unittest.TestCase):
    def _run_main(self, argv: list[str]) -> tuple[int | None, dict]:
        stdout = io.StringIO()
        with redirect_stdout(stdout):
            try:
                main(argv)
            except SystemExit as exc:
                return exc.code, json.loads(stdout.getvalue())
        return None, json.loads(stdout.getvalue())

    @patch(
        "lsm_cli.main.fetch_latest_release",
        return_value={
            "tag_name": "v0.10.0",
            "html_url": "https://github.com/hzb666/LabStorageManager/releases/tag/v0.10.0",
        },
    )
    def test_update_check_reports_available_release(self, fetch_mock) -> None:
        with patch("lsm_cli.main.CLI_VERSION", "0.9.1"):
            exit_code, payload = self._run_main(["update-check", "--timeout", "3"])

        self.assertIsNone(exit_code)
        self.assertEqual(
            {
                "current_version": "0.9.1",
                "latest_version": "0.10.0",
                "update_available": True,
                "release_url": "https://github.com/hzb666/LabStorageManager/releases/tag/v0.10.0",
                "update_command": "lsm update",
            },
            payload["data"],
        )
        fetch_mock.assert_called_once_with(timeout=3.0)

    @patch(
        "lsm_cli.main.fetch_latest_release",
        return_value={
            "tag_name": "v0.9.1",
            "html_url": "https://github.com/hzb666/LabStorageManager/releases/tag/v0.9.1",
        },
    )
    def test_update_check_reports_current_release(self, _fetch_mock) -> None:
        with patch("lsm_cli.main.CLI_VERSION", "0.9.1"):
            exit_code, payload = self._run_main(["update-check"])

        self.assertIsNone(exit_code)
        self.assertFalse(payload["data"]["update_available"])

    @patch(
        "lsm_cli.main.install_latest_release",
        return_value={
            "current_version": "0.9.1",
            "latest_version": "0.10.0",
            "cli_status": "scheduled",
            "skill_paths": ["C:/Users/test/.agents/skills/lab-storage-manager-cli"],
        },
    )
    def test_update_installs_cli_and_skill_from_one_command(self, install_mock) -> None:
        exit_code, payload = self._run_main(
            ["update", "--timeout", "8", "--skill-host", "codex"]
        )

        self.assertIsNone(exit_code)
        self.assertEqual("scheduled", payload["data"]["cli_status"])
        install_mock.assert_called_once_with(
            current_version="1.0.1",
            skill_host="codex",
            timeout=8.0,
        )

    def test_release_checksum_matches_asset_basename(self) -> None:
        checksum = "a" * 64
        checksums = f"{checksum}  release-assets/lsm-windows-x64.exe\n"

        verified = verify_release_checksum(
            asset_name="lsm-windows-x64.exe",
            actual_sha256=checksum,
            checksums_text=checksums,
        )

        self.assertEqual(checksum, verified)

    def test_skill_update_preserves_env_and_removes_stale_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source"
            target = root / "target"
            source.mkdir()
            target.mkdir()
            (source / "SKILL.md").write_text("new skill", encoding="utf-8")
            (target / "SKILL.md").write_text("old skill", encoding="utf-8")
            (target / "stale.md").write_text("stale", encoding="utf-8")
            (target / ".env").write_text("LSM_PASSWORD=secret", encoding="utf-8")

            preserved_env = install_skill_tree(source=source, target=target)

            self.assertTrue(preserved_env)
            self.assertEqual("new skill", (target / "SKILL.md").read_text(encoding="utf-8"))
            self.assertEqual(
                "LSM_PASSWORD=secret",
                (target / ".env").read_text(encoding="utf-8"),
            )
            self.assertFalse((target / "stale.md").exists())

    def test_skill_update_keeps_original_when_backup_move_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source"
            target = root / "target"
            source.mkdir()
            target.mkdir()
            (source / "SKILL.md").write_text("new skill", encoding="utf-8")
            (target / "SKILL.md").write_text("old skill", encoding="utf-8")

            with (
                patch.object(Path, "replace", side_effect=PermissionError("denied")),
                self.assertRaises(PermissionError),
            ):
                install_skill_tree(source=source, target=target)

            self.assertEqual("old skill", (target / "SKILL.md").read_text(encoding="utf-8"))

    def test_replacement_batch_rolls_back_earlier_targets(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source"
            source.mkdir()
            (source / "SKILL.md").write_text("new skill", encoding="utf-8")
            targets = [root / "first", root / "second"]
            for target in targets:
                target.mkdir()
                (target / "SKILL.md").write_text("old skill", encoding="utf-8")
            replacements = [
                update_install._stage_skill_tree(source, target) for target in targets
            ]
            original_replace = Path.replace

            def fail_second_stage(path: Path, target: Path) -> Path:
                if path == replacements[1].staged:
                    raise PermissionError("denied")
                return original_replace(path, target)

            with (
                patch.object(Path, "replace", autospec=True, side_effect=fail_second_stage),
                self.assertRaises(PermissionError),
            ):
                update_install._apply_replacements(replacements)

            for target in targets:
                self.assertEqual(
                    "old skill",
                    (target / "SKILL.md").read_text(encoding="utf-8"),
                )

    @patch("lsm_cli.update.fetch_latest_release")
    def test_source_installation_cannot_overwrite_python_runtime(self, fetch_mock) -> None:
        with (
            patch("lsm_cli.update_install.sys.frozen", False, create=True),
            self.assertRaisesRegex(CLILocalInputError, "precompiled release CLI"),
        ):
            install_latest_release(
                current_version="0.9.1",
                skill_host="none",
                timeout=5,
            )

        fetch_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
