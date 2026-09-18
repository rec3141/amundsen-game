"""Offline intranet game server with shared, durable meeting suggestions."""
import argparse
import json
import os
from pathlib import Path
import re
import sqlite3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

ROOT = Path(__file__).parent
DB = Path(os.environ.get('AMUNDSEN_GAME_DB', ROOT / 'runtime/suggestions.sqlite'))

def connect():
    DB.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute('CREATE TABLE IF NOT EXISTS suggestions (id INTEGER PRIMARY KEY, name TEXT, title TEXT, description TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP)')
    db.execute('CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY, idea INTEGER NOT NULL, name TEXT, body TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP)')
    return db

def build_status():
    """Latest crew-worker state per idea id, read from runtime/crew/idea-<id>-*/state.json."""
    latest = {}
    for path in (ROOT / 'runtime/crew').glob('idea-*/state.json'):
        try:
            ident = int(path.parent.name.split('-')[1])
            state = json.loads(path.read_text())
        except (ValueError, IndexError, OSError):
            continue
        if ident not in latest or state.get('started', 0) > latest[ident].get('started', 0):
            latest[ident] = state
    names = {'starting': 'building', 'running': 'building', 'ready_for_review': 'review', 'merged': 'live', 'failed': 'failed'}
    return {ident: names.get(state.get('status'), state.get('status')) for ident, state in latest.items()}

def clean(data, fields):
    """Return stripped string fields within their limits, or None when the payload is unusable."""
    if not isinstance(data, dict):
        return None
    values = []
    for key, limit in fields:
        value = data.get(key, '')
        if not isinstance(value, str) or len(value.strip()) > limit:
            return None
        values.append(value.strip())
    return values

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'static'), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def respond(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urlsplit(self.path).path == '/api/suggestions':
            with connect() as db:
                ideas = [dict(row) for row in db.execute('SELECT * FROM suggestions ORDER BY id DESC LIMIT 200')]
                comments = db.execute('SELECT * FROM comments WHERE idea IN (%s) ORDER BY id' % ','.join('?' * len(ideas)), [i['id'] for i in ideas]).fetchall() if ideas else []
            status = build_status()
            for idea in ideas:
                idea['comments'] = [dict(c) for c in comments if c['idea'] == idea['id']]
                idea['build'] = status.get(idea['id'])
            return self.respond(200, ideas)
        return super().do_GET()

    def read_json(self):
        if self.headers.get('Sec-Fetch-Site') == 'cross-site':
            return 403, {'error': 'Open the form on this site to submit.'}
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return 415, {'error': 'JSON required'}
        size = int(self.headers.get('Content-Length', '0') or 0)
        if not 0 < size <= 12000:
            return 413, {'error': 'Submission too large or empty'}
        try:
            return 200, json.loads(self.rfile.read(size))
        except (ValueError, UnicodeDecodeError):
            return 400, {'error': 'Malformed JSON'}

    def do_POST(self):
        path = urlsplit(self.path).path
        comment = re.fullmatch(r'/api/suggestions/(\d+)/comments', path)
        if path != '/api/suggestions' and not comment:
            return self.respond(404, {'error': 'Unknown endpoint'})
        status, data = self.read_json()
        if status != 200:
            return self.respond(status, data)
        if comment:
            fields = clean(data, [('name', 60), ('body', 1500)])
            if not fields or not fields[1]:
                return self.respond(400, {'error': 'Write a comment within the form limits.'})
            fields[0] = fields[0] or 'Anonymous scientist'
            with connect() as db:
                if not db.execute('SELECT 1 FROM suggestions WHERE id=?', (int(comment[1]),)).fetchone():
                    return self.respond(404, {'error': 'No such idea'})
                ident = db.execute('INSERT INTO comments(idea,name,body) VALUES (?,?,?)', (int(comment[1]), *fields)).lastrowid
            return self.respond(201, {'id': ident})
        fields = clean(data, [('name', 60), ('title', 100), ('description', 1500)])
        if not fields or not fields[1] or not fields[2]:
            return self.respond(400, {'error': 'Add a title and description within the form limits.'})
        fields[0] = fields[0] or 'Anonymous scientist'
        with connect() as db:
            ident = db.execute('INSERT INTO suggestions(name,title,description) VALUES (?,?,?)', fields).lastrowid
        return self.respond(201, {'id': ident})

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='0.0.0.0')
    parser.add_argument('--port', type=int, default=8050)
    args = parser.parse_args()
    connect().close()
    print(f'Amundsen Expedition listening on http://{args.host}:{args.port}', flush=True)
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()
