import unittest
from unittest.mock import patch

from fastapi import HTTPException

from server import jobs
from server.main import enqueue_job


class JobTests(unittest.TestCase):
    def setUp(self):
        self.now = 100
        self.queued = []
        self.addCleanup(patch.stopall)
        patch.object(jobs, "jobs", {}).start()
        patch.object(jobs, "monotonic", side_effect=lambda: self.now).start()
        patch.object(
            jobs.executor, "submit", side_effect=self.queued.append
        ).start()
        patch.object(jobs.threading, "Timer").start()

    def test_result_can_be_read_again_after_a_lost_response(self):
        identifier = jobs.start_job(lambda: {"collection": "studied words"})
        self.assertEqual(jobs.get_job(identifier)["status"], "running")
        self.queued.pop()()
        first = jobs.get_job(identifier)
        self.assertEqual(first["result"], {"collection": "studied words"})
        self.now += jobs.RESULT_TTL - 1
        self.assertEqual(jobs.get_job(identifier), first)
        self.now += 1
        self.assertIsNone(jobs.get_job(identifier))

    def test_failure_is_retained(self):
        def fail():
            raise ValueError("Anki rejected credentials")

        identifier = jobs.start_job(fail)
        self.queued.pop()()
        result = jobs.get_job(identifier)
        self.assertEqual((result["status"], result["message"]),
                         ("error", "Anki rejected credentials"))
        self.assertEqual(jobs.get_job(identifier), result)

    def test_active_and_retained_jobs_share_capacity(self):
        jobs.start_job(lambda: {})
        self.queued.pop()()
        for _ in range(jobs.MAX_JOBS - 1):
            jobs.start_job(lambda: {})

        with self.assertRaises(HTTPException) as rejected:
            enqueue_job(lambda: {})
        self.assertEqual(rejected.exception.status_code, 429)
        self.assertIn("Retry-After", rejected.exception.headers)
        self.assertEqual(len(self.queued), jobs.MAX_JOBS - 1)

        self.now += jobs.RESULT_TTL
        identifier = enqueue_job(lambda: {})["jobId"]
        self.assertEqual(jobs.get_job(identifier)["status"], "running")

    def test_submission_failure_releases_slot(self):
        with patch.object(jobs.executor, "submit", side_effect=RuntimeError):
            with self.assertRaises(RuntimeError):
                jobs.start_job(lambda: {})
        self.assertEqual(jobs.jobs, {})
