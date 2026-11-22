import threading
from concurrent.futures import ThreadPoolExecutor
from time import monotonic
from uuid import uuid4

MAX_JOBS = 8
RESULT_TTL = 120
RETRY_AFTER = "5"

executor = ThreadPoolExecutor(max_workers=1)
jobs: dict[str, tuple[dict, float | None]] = {}
lock = threading.Lock()


class JobCapacityError(Exception):
    pass


def _remove_expired(now: float) -> None:
    for identifier, (_, expires) in list(jobs.items()):
        if expires is not None and expires <= now:
            del jobs[identifier]


def start_job(action, *args) -> str:
    identifier = uuid4().hex
    with lock:
        _remove_expired(monotonic())
        if len(jobs) >= MAX_JOBS:
            raise JobCapacityError
        jobs[identifier] = ({"id": identifier, "status": "running"}, None)

    def run() -> None:
        try:
            value = action(*args)
            result = {"id": identifier, "status": "complete", "result": value}
        except Exception as error:
            result = {"id": identifier, "status": "error", "message": str(error)}
        with lock:
            jobs[identifier] = (result, monotonic() + RESULT_TTL)
        timer = threading.Timer(RESULT_TTL, expire_job, args=(identifier,))
        timer.daemon = True
        timer.start()

    try:
        executor.submit(run)
    except BaseException:
        with lock:
            jobs.pop(identifier, None)
        raise
    return identifier


def get_job(identifier: str) -> dict | None:
    with lock:
        _remove_expired(monotonic())
        result = jobs.get(identifier)
        return result[0] if result else None


def expire_job(identifier: str) -> None:
    with lock:
        jobs.pop(identifier, None)
