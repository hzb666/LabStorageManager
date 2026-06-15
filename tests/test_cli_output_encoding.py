import io
import json
import sys
import unittest
from unittest.mock import patch

from lsm_cli.output import print_json


class CLIOutputEncodingTests(unittest.TestCase):
    def test_print_json_reconfigures_redirected_stdout_to_utf8(self) -> None:
        buffer = io.BytesIO()
        stdout = io.TextIOWrapper(buffer, encoding="cp936", newline="")

        with patch.object(sys, "stdout", stdout):
            print_json({"name": "对甲苯胺"})
            stdout.flush()

        payload = json.loads(buffer.getvalue().decode("utf-8"))
        self.assertEqual(payload["name"], "对甲苯胺")


if __name__ == "__main__":
    unittest.main()
