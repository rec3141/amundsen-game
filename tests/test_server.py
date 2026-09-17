"""Exercise the shared suggestion API using an isolated database and server."""
import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

class SuggestionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        server.DB = Path(cls.temp.name) / 'suggestions.sqlite'
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def request(self, method, path, data=None, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.http.server_port)
        conn.request(method, path, json.dumps(data) if data is not None else None,
                     headers or {'Content-Type': 'application/json'})
        response = conn.getresponse()
        status, body = response.status, response.read()
        conn.close()
        return status, body

    def test_submission_shared_and_persistent(self):
        status, body = self.request('POST', '/api/suggestions', {
            'name': 'CTD team', 'title': 'Bottle race', 'description': 'Close bottles at the right depth.'})
        self.assertEqual(status, 201)
        ident = json.loads(body)['id']
        status, body = self.request('GET', '/api/suggestions')
        self.assertEqual(status, 200)
        self.assertTrue(any(row['id'] == ident and row['title'] == 'Bottle race' for row in json.loads(body)))
        with server.connect() as db:
            self.assertEqual(db.execute('SELECT name FROM suggestions WHERE id=?', (ident,)).fetchone()[0], 'CTD team')

    def test_bad_payloads(self):
        for data in [[], None, {'title': 'No description'}, {'title': 42}, {'title': 'x'*101, 'description': 'text'}]:
            status, _ = self.request('POST', '/api/suggestions', data)
            self.assertIn(status, (400, 413))

    def test_cross_site_rejected(self):
        status, _ = self.request('POST', '/api/suggestions', {'title':'x','description':'y'},
                                {'Content-Type':'application/json','Sec-Fetch-Site':'cross-site'})
        self.assertEqual(status, 403)

    def test_assets_and_private_files(self):
        for path in ['/', '/game.js', '/style.css', '/minigames/registry.js', '/minigames/ctd.js']:
            self.assertEqual(self.request('GET', path)[0], 200, path)
        for path in ['/server.py', '/runtime/suggestions.sqlite', '/../server.py']:
            self.assertEqual(self.request('GET', path)[0], 404, path)

if __name__ == '__main__':
    unittest.main()
