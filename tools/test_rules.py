import json
from datetime import date
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parent))
import rules


class Rules(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.write('companies/demo/company.json', json.dumps({'name': 'Demo Product'}))

    def write(self, path, text):
        file = self.root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text)

    def test_audit(self):
        self.write('standards/design.md', '- Demo Product uses system fonts. (owner: missing/file.md, 2020-01-01)\n- Rule without a source.\n## Thin evidence\n')
        self.write('local/standards/stack.md', '- demo product uses system fonts! (agent, 2026-10-28)\n')
        report = rules.audit(self.root, budget=10, level_budget=10, on=date(2026, 10, 28))
        for kind in ('duplicate', 'project-name', 'evidence', 'stale', 'budget', 'provenance', 'notes', 'level-budget'):
            self.assertIn(kind, report['counts'])
        self.assertTrue(all(f['line'] >= 0 and f['file'] for f in report['findings']))

    def test_kit_provenance(self):
        self.write('standards/design.md', '- Use fonts. (kit)\n')
        record = rules.load_rules(self.root)[0]
        self.assertEqual(record['provenance'], 'kit')
        self.assertEqual(record['text'], 'Use fonts.')
        self.assertNotIn('provenance', rules.audit(self.root)['counts'])

    def test_jaccard_threshold(self):
        self.write('standards/testing.md', '- Always test important user flows before release. (agent, 2026-10-28)\n- Always test important user flows before deployment. (agent, 2026-10-28)\n- Use native controls for navigation. (agent, 2026-10-28)\n')
        report = rules.audit(self.root)
        self.assertEqual(report['counts']['near-duplicate'], 1)

    def test_layers_dates_evidence_and_context(self):
        self.write('standards/design.md', '- Use fonts. (agent, 2020-01-01; reviewed 2026-10-28)\n')
        self.write('local/standards/design.md', '- ~~Use fonts.~~ (owner, 2026-10-28)\n')
        self.write('companies/demo/standards.md', '## design\n- Use native fonts. (code: companies/demo/company.json, 2026-10-28)\n')
        self.write('companies/other/standards.md', '## stack\n- Other rule. (agent, 2026-10-28)\n')
        records = rules.load_rules(self.root, 'demo')
        self.assertEqual([r['scope'] for r in records], list(rules.LEVELS))
        self.assertEqual(records[-1]['area'], 'design')
        self.assertEqual(len(rules.effective_rules(records)), 1)
        report = rules.audit(self.root, project='demo', on=date(2026, 10, 28))
        self.assertNotIn('evidence', report['counts'])
        self.assertNotIn('stale', report['counts'])
        self.assertGreater(report['context']['tokens'], rules.audit(self.root)['context']['tokens'])
        self.assertIn('unknown', rules.condensation(self.root))
        self.write('holding/rules-condensed.json', '{"date": "2020-01-01"}')
        self.assertIn('over 30 days', rules.condensation(self.root))

    def test_slug_boundary_and_traversal(self):
        self.write('standards/stack.md', '- demo uses Python. (agent, 2026-10-28)\n- demographic tools work. (agent, 2026-10-28)\n')
        self.assertEqual(rules.audit(self.root)['counts']['project-name'], 1)
        with self.assertRaises(ValueError):
            rules.load_rules(self.root, '../outside')
