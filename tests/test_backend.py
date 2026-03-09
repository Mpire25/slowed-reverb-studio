import unittest
from pathlib import Path
from uuid import uuid4

from backend_utils import clean_error_message
from server import STUDIO_DIR, app


class BackendCleanupTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_clean_error_message_strips_ansi_prefix_and_extra_lines(self):
        raw = "\x1b[31mERROR: [youtube] Something broke\x1b[0m\nTraceback detail"
        self.assertEqual(clean_error_message(raw), "Something broke")

    def test_file_route_guards_path_and_missing_inputs(self):
        self.assertEqual(self.client.get("/api/file").status_code, 400)
        self.assertEqual(self.client.get("/api/file?path=/tmp/outside.mp3").status_code, 403)
        self.assertEqual(self.client.get("/api/file?path=/tmp/not-audio.txt").status_code, 403)

    def test_file_route_stream_and_consume_delete(self):
        downloads_dir = STUDIO_DIR / "downloads"
        downloads_dir.mkdir(exist_ok=True)

        name = f"test-{uuid4().hex}.mp3"
        sample_path = downloads_dir / name
        sample_bytes = b"ID3TESTDATA"
        sample_path.write_bytes(sample_bytes)

        regular = self.client.get(f"/api/file?path={sample_path}")
        self.assertEqual(regular.status_code, 200)
        self.assertEqual(regular.data, sample_bytes)
        self.assertTrue(sample_path.exists())
        regular.close()

        consume = self.client.get(f"/api/file?path={sample_path}&consume=1")
        self.assertEqual(consume.status_code, 200)
        self.assertEqual(consume.data, sample_bytes)
        self.assertFalse(sample_path.exists())
        consume.close()


if __name__ == "__main__":
    unittest.main()
