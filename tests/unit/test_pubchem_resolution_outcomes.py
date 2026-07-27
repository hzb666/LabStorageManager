from __future__ import annotations

import unittest

import httpx

from app.models.compound_structure import CompoundStructureStatus
from app.services.pubchem_resolver import (
    PubChemResolver,
    PubChemRetryableError,
    ResolutionOutcomeKind,
    ResolvedStructure,
    StructureNormalizationRetryableError,
    _classify_retryable_exception,
    classify_resolution_result,
)


class _SingleResponseClient:
    def __init__(self, response: httpx.Response) -> None:
        self.response = response
        self.call_count = 0

    async def get(self, _url: str) -> httpx.Response:
        self.call_count += 1
        return self.response


class PubChemResolutionOutcomeTest(unittest.IsolatedAsyncioTestCase):
    async def test_single_attempt_retryable_statuses_do_not_retry_inline(self) -> None:
        for status_code in (429, 500, 502, 503, 504):
            with self.subTest(status_code=status_code):
                request = httpx.Request("GET", "https://pubchem.example.test")
                client = _SingleResponseClient(
                    httpx.Response(
                        status_code=status_code,
                        headers={"Retry-After": "120"},
                        request=request,
                    )
                )
                resolver = PubChemResolver(
                    client,  # type: ignore[arg-type]
                    min_interval_seconds=0,
                    max_retries=0,
                )

                outcome = await resolver.resolve_cas_outcome("64-17-5")

                self.assertEqual(1, client.call_count)
                self.assertEqual(ResolutionOutcomeKind.RETRYABLE_ERROR, outcome.kind)
                self.assertEqual(f"http_{status_code}", outcome.error_code)
                self.assertEqual(120, outcome.retry_after_seconds)

    def test_retryable_exception_classes_have_stable_error_codes(self) -> None:
        request = httpx.Request("GET", "https://pubchem.example.test")
        cases = (
            (
                httpx.ReadTimeout("timed out", request=request),
                ("timeout", None),
            ),
            (
                httpx.ConnectError("connect failed", request=request),
                ("transport_error", None),
            ),
            (
                PubChemRetryableError(503, 90),
                ("http_503", 90),
            ),
            (
                StructureNormalizationRetryableError("normalization failed"),
                ("structure_normalization_error", None),
            ),
            (
                RuntimeError("temporary unknown failure"),
                ("unexpected_error", None),
            )
        )

        for exception, expected in cases:
            with self.subTest(exception=exception.__class__.__name__):
                self.assertEqual(expected, _classify_retryable_exception(exception))

    def test_terminal_statuses_are_not_retryable(self) -> None:
        expected = {
            CompoundStructureStatus.AMBIGUOUS: ResolutionOutcomeKind.TERMINAL_AMBIGUOUS,
            CompoundStructureStatus.NOT_FOUND: ResolutionOutcomeKind.TERMINAL_NOT_FOUND,
            CompoundStructureStatus.INVALID_CAS: ResolutionOutcomeKind.TERMINAL_INVALID,
            CompoundStructureStatus.UNSUPPORTED: ResolutionOutcomeKind.TERMINAL_UNSUPPORTED,
        }

        for status, kind in expected.items():
            with self.subTest(status=status):
                outcome = classify_resolution_result(
                    ResolvedStructure(cas_number="64-17-5", status=status)
                )
                self.assertEqual(kind, outcome.kind)
                self.assertFalse(outcome.retryable)


if __name__ == "__main__":
    unittest.main()
