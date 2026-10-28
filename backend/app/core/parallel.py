"""Run independent blocking calls (typically Supabase reads) at the same time.

Request handlers are synchronous and each database read costs a network
round-trip. When several reads don't depend on each other, running them
concurrently turns "N round-trips in a row" into "about one". One shared pool
keeps the thread count bounded.
"""

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

_pool = ThreadPoolExecutor(max_workers=16, thread_name_prefix="parallel")


def run_parallel(*calls: Callable[[], Any]) -> list[Any]:
    """Runs every zero-argument callable concurrently and returns their
    results in the same order. If any raises, that exception propagates."""
    futures = [_pool.submit(call) for call in calls]
    return [future.result() for future in futures]
