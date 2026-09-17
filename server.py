"""Offline intranet game server with shared, durable meeting suggestions."""
import argparse
import json
import os
from pathlib import Path
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
    return db

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
                rows = db.execute('SELECT * FROM suggestions ORDER BY id DESC LIMIT 200').fetchall()
            return self.respond(200, [dict(row) for row in rows])
        return super().do_GET()

    def do_POST(self):
        if self.path != '/api/suggestions':
            return self.respond(404, {'error': 'Unknown endpoint'})
        if self.headers.get('Sec-Fetch-Site') == 'cross-site':
            return self.respond(403, {'error': 'Open the form on this site to submit.'})
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.respond(415, {'error': 'JSON required'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 12000:
                return self.respond(413, {'error': 'Submission too large or empty'})
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError()
            fields = []
            for key, limit in [('name', 60), ('title', 100), ('description', 1500)]:
                value = data.get(key, '')
                if not isinstance(value, str) or len(value.strip()) > limit:
                    raise ValueError()
                fields.append(value.strip())
            if not fields[1] or not fields[2]:
                raise ValueError()
        except (ValueError, UnicodeDecodeError):
            return self.respond(400, {'error': 'Add a title and description within the form limits.'})
        fields[0] = fields[0] or 'Anonymous scientist'
        with connect() as db:
            cursor = db.execute('INSERT INTO suggestions(name,title,description) VALUES (?,?,?)', fields)
            ident = cursor.lastrowid
        return self.respond(201, {'id': ident})

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='0.0.0.0')
    parser.add_argument('--port', type=int, default=8050)
    args = parser.parse_args()
    connect().close()
    print(f'Amundsen Expedition listening on http://{args.host}:{args.port}', flush=True)
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()
