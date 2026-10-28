import contextlib
import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import _paths  # noqa: F401
import context_usage
import session_digest
from fixtures import PROJECT, claude_assistant, claude_user, codex_meta, make_config, text_block, write_jsonl


def assistant_with_usage(tokens: int, sidechain=False) -> dict:
    record = claude_assistant([text_block("hi")], "2026-10-05T10:00:00Z")
    record["isSidechain"] = sidechain
    record["message"]["usage"] = {"input_tokens": 3, "cache_read_input_tokens": tokens - 13, "cache_creation_input_tokens": 10, "output_tokens": 99}
    return record


def token_count(last_input: int) -> dict:
    return {"type": "event_msg", "timestamp": "2026-10-05T10:00:00Z",
            "payload": {"type": "token_count", "info": {"last_token_usage": {"input_tokens": last_input, "total_tokens": last_input + 5},
                                                         "model_context_window": 258400}}}


class ContextReadoutTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(lambda: shutil.rmtree(self.tmp, ignore_errors=True))

    def test_claude_sums_input_and_both_cache_fields_of_last_main_chain_record(self):
        path = write_jsonl(self.tmp / "c.jsonl", [assistant_with_usage(100_000), assistant_with_usage(165_000), assistant_with_usage(900_000, sidechain=True)])
        reading = context_usage.read_context(path)
        self.assertEqual((reading.agent, reading.tokens), ("claude", 165_000))

    def test_codex_uses_last_token_count_input_and_reports_window(self):
        path = write_jsonl(self.tmp / "x.jsonl", [codex_meta("s", "2026-10-05T10:00:00Z"), token_count(40_000), token_count(77_000)])
        reading = context_usage.read_context(path)
        self.assertEqual((reading.agent, reading.tokens, reading.window), ("codex", 77_000, 258400))

    def test_reading_finds_usage_beyond_the_tail_chunk(self):
        records = [assistant_with_usage(50_000)] + [claude_user("filler " * 50, "2026-10-05T10:00:00Z") for _ in range(40)]
        path = write_jsonl(self.tmp / "big.jsonl", records)
        reading = context_usage.read_context(path)
        self.assertEqual(reading.tokens, 50_000)
        lines = list(context_usage.tail_lines(path, chunk_bytes=500))
        self.assertEqual(len(lines), len(records))

    def test_handoff_state_uses_both_thresholds(self):
        states = [context_usage.handoff_state(t, 150_000, 200_000) for t in (149_999, 150_000, 200_000)]
        self.assertEqual(states, [context_usage.BELOW_TARGET, context_usage.PAST_TARGET, context_usage.PAST_HARD_LIMIT])

    def test_session_digest_context_prints_size_thresholds_and_state(self):
        config = make_config(self.tmp)
        write_jsonl(self.tmp / "claude" / "proj" / "sess.jsonl", [claude_user("go", "2026-10-05T09:00:00Z"), assistant_with_usage(182_000)])
        config_path = self.tmp / "config.json"
        config_path.write_text(json.dumps({"claude_projects_dir": config.claude_projects_dir, "codex_session_dirs": [config.codex_session_dirs[0]],
                                           "repo_prefixes": [PROJECT]}))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = session_digest.main(["--context", "--config", str(config_path), "--project", str(self.tmp)])
        text = out.getvalue()
        self.assertEqual(code, 0)
        self.assertIn("182000 tokens", text)
        self.assertIn("target 150K, hard 200K", text)
        self.assertIn("handoff due at the next subtask boundary", text)


if __name__ == "__main__":
    unittest.main()
