#!/usr/bin/env python3
"""Reconcile only the game's route in the local Caddy admin API."""
import argparse
import json
from pathlib import Path
import urllib.request

BASE = 'http://127.0.0.1:2019'
URL = BASE + '/config/apps/http/servers/srv0/routes'
IDENTIFIER = 'amundsen-expedition-game'
ROUTE = {
    '@id': IDENTIFIER,
    'match': [{'path': ['/game', '/game/*']}],
    'handle': [{'handler': 'subroute', 'routes': [
        {'match': [{'path': ['/game']}], 'handle': [{'handler': 'static_response',
          'status_code': 302, 'headers': {'Location': ['/game/']}}], 'terminal': True},
        {'handle': [{'handler': 'rewrite', 'strip_path_prefix': '/game'},
                    {'handler': 'reverse_proxy', 'upstreams': [{'dial': '127.0.0.1:8050'}]}]}
    ]}],
    'terminal': True,
}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--remove', action='store_true')
    args = parser.parse_args()
    with urllib.request.urlopen(URL, timeout=5) as response:
        raw = response.read()
    routes = json.loads(raw)
    existing = next((route for route in routes if route.get('@id') == IDENTIFIER), None)
    if args.remove:
        if existing:
            request = urllib.request.Request(BASE + '/id/' + IDENTIFIER, method='DELETE')
            with urllib.request.urlopen(request, timeout=5):
                pass
    elif existing != ROUTE:
        if existing:
            raise RuntimeError('Game route differs; inspect before replacing it.')
        with urllib.request.urlopen('http://127.0.0.1:8050/', timeout=5):
            pass
        backup = Path(__file__).resolve().parents[1] / 'runtime/caddy-before-game.json'
        if not backup.exists():
            backup.write_bytes(raw)
        # Inserting one element preserves concurrent changes to other routes.
        request = urllib.request.Request(URL + '/0', data=json.dumps(ROUTE).encode(),
                                         method='PUT', headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(request, timeout=5):
            pass
        print('Game route installed')
