"""Verify queue limits and duplicate handling without starting real workers."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('crew_watch', Path(__file__).resolve().parents[1] / 'tools/crew_watch.py')
queue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(queue)

class QueueTests(unittest.TestCase):
    def test_existing_idea_skipped_and_new_ideas_all_start(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            runs = root / 'runtime/crew'
            runs.mkdir(parents=True)
            for slug in ['idea-1-ice-thickness', 'ctd-real-layers']:
                path = runs / slug
                path.mkdir()
                (path / 'state.json').write_text(json.dumps({'branch': 'crew/'+slug, 'status': 'running'}))
            ideas = [{'id': n, 'title': f'Idea {n}', 'description': 'A research game', 'name': 'Crew'} for n in range(1, 4)]
            with patch.object(queue, 'ROOT', root), patch.object(queue, 'RUNS', runs), \
                 patch.object(queue.urllib.request, 'urlopen', return_value=io.BytesIO(json.dumps(ideas).encode())), \
                 patch.object(queue.subprocess, 'run') as launch:
                queue.sync()
                self.assertEqual([call.args[0][-2] for call in launch.call_args_list], ['idea-2-minigame', 'idea-3-minigame'])
                prompt = (root / 'runtime/idea-2-minigame-brief.md').read_text()
                self.assertIn('static/minigames/crew-2.js', prompt)
                self.assertIn('/data/underway_server/www', prompt)

    def test_completed_and_failed_ideas_not_duplicated(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            runs = root / 'runtime/crew'
            runs.mkdir(parents=True)
            for n, status in [(1, 'ready_for_review'), (2, 'failed')]:
                path = runs / str(n)
                path.mkdir()
                (path / 'state.json').write_text(json.dumps({'branch': f'crew/idea-{n}-minigame', 'status': status}))
            ideas = [{'id': n, 'title': str(n)} for n in [1, 2]]
            with patch.object(queue, 'ROOT', root), patch.object(queue, 'RUNS', runs), \
                 patch.object(queue.urllib.request, 'urlopen', return_value=io.BytesIO(json.dumps(ideas).encode())), \
                 patch.object(queue.subprocess, 'run') as launch:
                queue.sync()
                launch.assert_not_called()

if __name__ == '__main__':
    unittest.main()
