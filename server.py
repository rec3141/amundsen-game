"""Offline intranet game server with shared, durable meeting suggestions and a live fleet presence relay."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).parent
DB = Path(os.environ.get('AMUNDSEN_GAME_DB', ROOT / 'runtime/suggestions.sqlite'))

def connect():
    DB.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute('CREATE TABLE IF NOT EXISTS suggestions (id INTEGER PRIMARY KEY, name TEXT, title TEXT, description TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP)')
    db.execute('CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY, idea INTEGER NOT NULL, name TEXT, body TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP)')
    db.execute('CREATE TABLE IF NOT EXISTS scores (id INTEGER PRIMARY KEY, player TEXT NOT NULL, activity TEXT NOT NULL, title TEXT, points INTEGER NOT NULL, created TEXT DEFAULT CURRENT_TIMESTAMP)')
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
    names = {'starting': 'building', 'running': 'building', 'switching': 'building', 'limited': 'failed', 'ready_for_review': 'review', 'merged': 'live', 'failed': 'failed'}
    return {ident: names.get(state.get('status'), state.get('status')) for ident, state in latest.items()}

def leaderboard():
    """Overall career points per player plus each activity's best single score per player, top ten each."""
    with connect() as db:
        overall = [dict(r) for r in db.execute('SELECT player, SUM(points) AS points, COUNT(*) AS operations FROM scores GROUP BY player ORDER BY points DESC, operations ASC LIMIT 10')]
        rows = db.execute('SELECT activity, title, player, MAX(points) AS points, MIN(created) AS created FROM scores GROUP BY activity, player ORDER BY activity, points DESC, created ASC').fetchall()
    activities = {}
    for r in rows:
        entry = activities.setdefault(r['activity'], {'activity': r['activity'], 'title': r['title'], 'top': []})
        if len(entry['top']) < 10:
            entry['top'].append({'player': r['player'], 'points': r['points']})
    return {'overall': overall, 'activities': list(activities.values())}

# Fleet presence: every open chart reports its own ship about once a second and receives the others in reply.
# Entries live only in memory, under FLEET_LOCK, and drop out FLEET_TTL seconds after their last report; a session
# reporting faster than FLEET_INTERVAL is refused. The relay carries nothing but a display name, a fleet ship id,
# a chart position and a heading; the session secret never leaves this table, only its derived public id does.
FLEET_TTL, FLEET_INTERVAL, FLEET_MAX, FLEET_MAX_PER_ADDRESS = 15.0, 0.4, 64, 8
FLEET, FLEET_LOCK = {}, threading.Lock()
SESSION_RE, SHIP_RE, NAME_RE = re.compile(r'[0-9a-f]{16,32}'), re.compile(r'[a-z0-9-]{1,24}'), re.compile(r'[^\x00-\x1f\x7f]{0,40}')

def fleet_number(value, low, high):
    """A finite JSON number within [low, high], or None."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        return None
    return float(value)

def fleet_expire(now):
    for session in [s for s, e in FLEET.items() if now - e['seen'] > FLEET_TTL]:
        del FLEET[session]

def fleet_view(now, exclude=None):
    """The public picture of every ship but `exclude`, oldest report first, without session secrets or addresses."""
    return [{'id': e['id'], 'name': e['name'], 'ship': e['ship'], 'x': e['x'], 'y': e['y'], 'heading': e['heading'], 'age': round(now - e['seen'], 1)}
            for session, e in sorted(FLEET.items(), key=lambda item: item[1]['seen']) if session != exclude]

def fleet_report(data, address):
    """Record one ship's report and answer with the rest of the fleet, or reject it with a status and reason."""
    session = data.get('session') if isinstance(data, dict) else None
    if not isinstance(session, str) or not SESSION_RE.fullmatch(session):
        return 400, {'error': 'A fleet report needs a session id.'}
    now = time.monotonic()
    with FLEET_LOCK:
        fleet_expire(now)
        if data.get('leave') is True:
            FLEET.pop(session, None)
            return 200, {'players': [], 'ttl': FLEET_TTL}
        name, ship = data.get('name', ''), data.get('ship')
        x, y, heading = fleet_number(data.get('x'), 0, 1), fleet_number(data.get('y'), 0, 1), fleet_number(data.get('heading'), -7, 7)
        if not isinstance(name, str) or not NAME_RE.fullmatch(name) or not isinstance(ship, str) or not SHIP_RE.fullmatch(ship) or None in (x, y, heading):
            return 400, {'error': 'A fleet report carries a name, a ship, a chart position and a heading.'}
        entry = FLEET.get(session)
        if entry is None:
            if len(FLEET) >= FLEET_MAX:
                return 503, {'error': 'The fleet chart is full.'}
            if sum(1 for e in FLEET.values() if e['address'] == address) >= FLEET_MAX_PER_ADDRESS:
                return 429, {'error': 'Too many ships from this computer.'}
            entry = FLEET[session] = {'id': hashlib.sha256(session.encode()).hexdigest()[:12], 'address': address, 'seen': now - FLEET_INTERVAL}
        elif now - entry['seen'] < FLEET_INTERVAL:
            return 429, {'error': 'Report about once a second.'}
        entry.update(name=name.strip(), ship=ship, x=x, y=y, heading=heading, seen=now)
        return 200, {'players': fleet_view(now, session), 'ttl': FLEET_TTL}

def fleet_list(session=None):
    now = time.monotonic()
    with FLEET_LOCK:
        fleet_expire(now)
        return {'players': fleet_view(now, session if isinstance(session, str) and SESSION_RE.fullmatch(session) else None), 'ttl': FLEET_TTL}

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
        if urlsplit(self.path).path == '/api/leaderboard':
            return self.respond(200, leaderboard())
        if urlsplit(self.path).path == '/api/fleet':
            return self.respond(200, fleet_list(parse_qs(urlsplit(self.path).query).get('session', [None])[0]))
        return super().do_GET()

    def client(self):
        """The reporting computer: the first forwarded address behind the site proxy, else the socket peer."""
        forwarded = self.headers.get('X-Forwarded-For', '').split(',')[0].strip()
        return forwarded or self.client_address[0]

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
        if path not in ('/api/suggestions', '/api/scores', '/api/fleet') and not comment:
            return self.respond(404, {'error': 'Unknown endpoint'})
        status, data = self.read_json()
        if status != 200:
            return self.respond(status, data)
        if path == '/api/fleet':
            return self.respond(*fleet_report(data, self.client()))
        if path == '/api/scores':
            fields = clean(data, [('player', 60), ('activity', 40), ('title', 100)])
            points = data.get('points') if isinstance(data, dict) else None
            if not fields or not fields[0] or not fields[1] or not isinstance(points, int) or isinstance(points, bool) or not 0 <= points <= 1000000:
                return self.respond(400, {'error': 'A score needs a player, an activity and whole points.'})
            with connect() as db:
                ident = db.execute('INSERT INTO scores(player,activity,title,points) VALUES (?,?,?,?)', (*fields, points)).lastrowid
            return self.respond(201, {'id': ident})
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

class Server(ThreadingHTTPServer):
    """A dozen open charts each poll the relay every second and load some forty modules apiece; a deeper listen backlog
    than the stock five keeps a burst of simultaneous connections from being reset."""
    request_queue_size = 64

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='0.0.0.0')
    parser.add_argument('--port', type=int, default=8050)
    args = parser.parse_args()
    connect().close()
    print(f'Amundsen Expedition listening on http://{args.host}:{args.port}', flush=True)
    Server((args.host, args.port), Handler).serve_forever()
