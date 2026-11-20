import threading
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

executor = ThreadPoolExecutor(max_workers=1)
jobs: dict[str, dict] = {}
lock = threading.Lock()


def start_job(action, *args) -> str:
    identifier = uuid4().hex
    with lock:
        jobs[identifier] = {"id": identifier, "status": "running"}

    def run() -> None:
        try:
            value = action(*args)
            result = {"id": identifier, "status": "complete", "result": value}
        except Exception as error:
            result = {"id": identifier, "status": "error", "message": str(error)}
        with lock:
            jobs[identifier] = result
        timer = threading.Timer(600, expire_job, args=(identifier,))
        timer.daemon = True
        timer.start()

    executor.submit(run)
    return identifier


def get_job(identifier: str) -> dict | None:
    with lock:
        result = jobs.get(identifier)
        if result and result["status"] != "running":
            del jobs[identifier]
        return result


def expire_job(identifier: str) -> None:
    with lock:
        jobs.pop(identifier, None)
