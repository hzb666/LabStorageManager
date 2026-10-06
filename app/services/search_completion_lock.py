from __future__ import annotations

import errno
import os
from collections.abc import Iterator
from contextlib import contextmanager
from functools import partial

from app import search_completion_db


@contextmanager
def completion_rebuild_lock() -> Iterator[bool]:
    path = search_completion_db.COMPLETION_DB_PATH.with_suffix(".rebuild.lock")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as lock_file:
        if os.name == "nt":
            import msvcrt

            if path.stat().st_size == 0:
                lock_file.write(b"0")
                lock_file.flush()
            lock_file.seek(0)
            acquire = partial(msvcrt.locking, lock_file.fileno(), msvcrt.LK_NBLCK, 1)
            release = partial(msvcrt.locking, lock_file.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            acquire = partial(fcntl.flock, lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            release = partial(fcntl.flock, lock_file.fileno(), fcntl.LOCK_UN)
        try:
            acquire()
        except OSError as error:
            if error.errno not in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                raise
            yield False
            return
        try:
            yield True
        finally:
            release()
