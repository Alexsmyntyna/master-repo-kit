import unittest

import _paths  # noqa: F401
from session_digest import find_drift_candidates, opens_with_correction, render_session_markdown
from transcript_sources import DEFAULT_CORRECTION_PATTERNS, Exchange, Session, cwd_in_scope

PATTERNS = list(DEFAULT_CORRECTION_PATTERNS)


def make_session(*exchanges):
    for number, exchange in enumerate(exchanges, start=1):
        exchange.number = number
    return Session("claude", "abc12345", "t", "/work/demo", "", "", "p", list(exchanges))


class ScopingTests(unittest.TestCase):
    def test_prefix_covers_subdirectories_worktrees_and_old_paths(self):
        prefixes = ["/work/demo", "/old/name"]
        self.assertTrue(cwd_in_scope("/work/demo", prefixes))
        self.assertTrue(cwd_in_scope("/work/demo/sub/dir", prefixes))
        self.assertTrue(cwd_in_scope("/work/demo/.claude/worktrees/agent-1", prefixes))
        self.assertTrue(cwd_in_scope("/old/name/x", prefixes))
        self.assertFalse(cwd_in_scope("/work/demo2", prefixes))
        self.assertFalse(cwd_in_scope("/work/other", prefixes))
        self.assertFalse(cwd_in_scope("", prefixes))


class DriftTests(unittest.TestCase):
    def test_interrupt_denial_and_following_correction_are_flagged(self):
        session = make_session(
            Exchange(owner_text="build x", interrupted=True),
            Exchange(owner_text="no, I meant the other file", denials=["Edit a.py"]),
            Exchange(owner_text="fine, continue"),
            Exchange(owner_text="add a button"),
            Exchange(owner_text="Actually make it blue"),
        )
        flagged = {e.number: reasons for e, reasons in find_drift_candidates(session, PATTERNS)}
        self.assertEqual(sorted(flagged), [1, 2, 4])
        self.assertIn("owner interrupted the agent", flagged[1])
        self.assertTrue(any("next owner turn (#4)" in r or "#5" in r for r in flagged[4]))
        self.assertTrue(any("#2" in r for r in flagged[1]))

    def test_correction_pattern_is_anchored_to_the_opening(self):
        self.assertTrue(opens_with_correction("Wait, that is not it", PATTERNS))
        self.assertFalse(opens_with_correction("Please wait for the build", PATTERNS))
        self.assertFalse(opens_with_correction("notes on the design", PATTERNS))

    def test_owner_text_is_rendered_verbatim(self):
        text = "line one\n\n```swift\nlet x = 1\n```\n  indented   spacing"
        markdown = render_session_markdown(make_session(Exchange(owner_text=text)), PATTERNS, 400)
        self.assertIn(text, markdown)


if __name__ == "__main__":
    unittest.main()
