"""Measure how long concurrent work actually waits.

Examples:
    python scripts/measure_concurrency_wait.py sleep --tasks 10 --delay 1
    python scripts/measure_concurrency_wait.py http --url http://127.0.0.1:8000/health
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import statistics
import time
from collections import Counter
from dataclasses import dataclass
from typing import Any

DEFAULT_SLEEP_TASKS = 10
DEFAULT_SLEEP_DELAY_SECONDS = 1.0
DEFAULT_HTTP_REQUESTS = 20
DEFAULT_HTTP_CONCURRENCY = 5
DEFAULT_HTTP_TIMEOUT_SECONDS = 10.0
P95_PERCENTILE = 95.0


@dataclass(frozen=True)
class SleepConfig:
    tasks: int
    delay_seconds: float


@dataclass(frozen=True)
class HttpConfig:
    url: str
    method: str
    requests: int
    concurrency: int
    timeout_seconds: float
    headers: dict[str, str]
    json_body: Any | None


@dataclass(frozen=True)
class RequestResult:
    elapsed_ms: float
    status_code: int | None = None
    error: str | None = None


async def _sleep_once(delay_seconds: float) -> None:
    await asyncio.sleep(delay_seconds)


async def _run_sleep_serial(config: SleepConfig) -> float:
    started = time.perf_counter()
    for _ in range(config.tasks):
        await _sleep_once(config.delay_seconds)
    return time.perf_counter() - started


async def _run_sleep_concurrent(config: SleepConfig) -> float:
    started = time.perf_counter()
    await asyncio.gather(*[_sleep_once(config.delay_seconds) for _ in range(config.tasks)])
    return time.perf_counter() - started


def _parse_header(value: str) -> tuple[str, str]:
    if ":" not in value:
        raise argparse.ArgumentTypeError("Header must use 'Name: value' format")
    name, header_value = value.split(":", 1)
    name = name.strip()
    if not name:
        raise argparse.ArgumentTypeError("Header name cannot be empty")
    return name, header_value.strip()


def _parse_json_body(value: str | None) -> Any | None:
    if value is None:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError as exc:
        raise argparse.ArgumentTypeError(f"Invalid JSON body: {exc}") from exc


def _positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("Value must be greater than 0")
    return parsed


def _positive_float(value: str) -> float:
    parsed = float(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("Value must be greater than 0")
    return parsed


async def _send_request(client: Any, semaphore: asyncio.Semaphore, config: HttpConfig) -> RequestResult:
    async with semaphore:
        started = time.perf_counter()
        try:
            response = await client.request(
                config.method,
                config.url,
                headers=config.headers,
                json=config.json_body,
            )
        except Exception as exc:  # noqa: BLE001 - benchmark reports transport errors.
            elapsed_ms = (time.perf_counter() - started) * 1000
            return RequestResult(elapsed_ms=elapsed_ms, error=f"{type(exc).__name__}: {exc}")
        elapsed_ms = (time.perf_counter() - started) * 1000
        return RequestResult(elapsed_ms=elapsed_ms, status_code=response.status_code)


async def _run_http_requests(config: HttpConfig) -> tuple[float, list[RequestResult]]:
    try:
        import httpx
    except ImportError as exc:
        raise RuntimeError("HTTP mode requires httpx. Install project dependencies first.") from exc

    semaphore = asyncio.Semaphore(config.concurrency)
    started = time.perf_counter()
    async with httpx.AsyncClient(timeout=config.timeout_seconds) as client:
        tasks = [_send_request(client, semaphore, config) for _ in range(config.requests)]
        results = await asyncio.gather(*tasks)
    return time.perf_counter() - started, results


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    sorted_values = sorted(values)
    index = math.ceil((percentile / 100) * len(sorted_values)) - 1
    return sorted_values[max(0, min(index, len(sorted_values) - 1))]


def _print_sleep_report(config: SleepConfig, serial_seconds: float, concurrent_seconds: float) -> None:
    expected_serial = config.tasks * config.delay_seconds
    saved_seconds = max(0.0, serial_seconds - concurrent_seconds)
    speedup = serial_seconds / concurrent_seconds if concurrent_seconds else 0.0

    print("sleep benchmark")
    print(f"tasks: {config.tasks}, delay: {config.delay_seconds:.3f}s")
    print(f"expected serial wait: {expected_serial:.3f}s")
    print(f"actual serial wait:   {serial_seconds:.3f}s")
    print(f"concurrent wait:      {concurrent_seconds:.3f}s")
    print(f"saved time:           {saved_seconds:.3f}s")
    print(f"speedup:              {speedup:.2f}x")


def _print_http_report(config: HttpConfig, total_seconds: float, results: list[RequestResult]) -> None:
    latencies = [result.elapsed_ms for result in results]
    statuses = Counter(result.status_code for result in results if result.status_code is not None)
    errors = [result.error for result in results if result.error]
    throughput = config.requests / total_seconds if total_seconds else 0.0

    print("http benchmark")
    print(f"url: {config.url}")
    print(f"method: {config.method}")
    print(f"requests: {config.requests}, concurrency: {config.concurrency}")
    print(f"wall time: {total_seconds:.3f}s")
    print(f"throughput: {throughput:.2f} req/s")
    print(
        "latency ms: "
        f"avg={statistics.fmean(latencies):.2f}, "
        f"p50={statistics.median(latencies):.2f}, "
        f"p95={_percentile(latencies, P95_PERCENTILE):.2f}, "
        f"max={max(latencies):.2f}"
    )
    print(f"status counts: {dict(sorted(statuses.items()))}")
    print(f"errors: {len(errors)}")
    for error in errors[:3]:
        print(f"  - {error}")


async def _run_sleep_command(args: argparse.Namespace) -> int:
    config = SleepConfig(tasks=args.tasks, delay_seconds=args.delay)
    serial_seconds = await _run_sleep_serial(config)
    concurrent_seconds = await _run_sleep_concurrent(config)
    _print_sleep_report(config, serial_seconds, concurrent_seconds)
    return 0


async def _run_http_command(args: argparse.Namespace) -> int:
    config = HttpConfig(
        url=args.url,
        method=args.method.upper(),
        requests=args.requests,
        concurrency=args.concurrency,
        timeout_seconds=args.timeout,
        headers=dict(args.header or []),
        json_body=_parse_json_body(args.json_body),
    )
    total_seconds, results = await _run_http_requests(config)
    _print_http_report(config, total_seconds, results)
    return 0 if not any(result.error for result in results) else 1


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Measure serial and concurrent wait time")
    subparsers = parser.add_subparsers(dest="command", required=True)

    sleep_parser = subparsers.add_parser("sleep", help="Measure asyncio sleep concurrency")
    sleep_parser.add_argument("--tasks", type=_positive_int, default=DEFAULT_SLEEP_TASKS)
    sleep_parser.add_argument("--delay", type=_positive_float, default=DEFAULT_SLEEP_DELAY_SECONDS)
    sleep_parser.set_defaults(handler=_run_sleep_command)

    http_parser = subparsers.add_parser("http", help="Measure HTTP endpoint concurrency")
    http_parser.add_argument("--url", required=True, help="Target URL")
    http_parser.add_argument("--method", default="GET", help="HTTP method")
    http_parser.add_argument("--requests", type=_positive_int, default=DEFAULT_HTTP_REQUESTS)
    http_parser.add_argument("--concurrency", type=_positive_int, default=DEFAULT_HTTP_CONCURRENCY)
    http_parser.add_argument("--timeout", type=_positive_float, default=DEFAULT_HTTP_TIMEOUT_SECONDS)
    http_parser.add_argument("--header", action="append", type=_parse_header, help="Header: Name: value")
    http_parser.add_argument("--json-body", help="JSON request body")
    http_parser.set_defaults(handler=_run_http_command)

    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()
    return asyncio.run(args.handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
