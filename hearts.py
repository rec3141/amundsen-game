"""Serialized access to the bundled Parlour Hearts service and its private table store."""
import atexit
import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import threading

ROOT = Path(__file__).parent
LOCK = threading.Lock()
PROCESS = None


def stop():
    global PROCESS
    if PROCESS is not None:
        PROCESS.terminate()
        try:
            PROCESS.wait(timeout=2)
        except subprocess.TimeoutExpired:
            PROCESS.kill()
            PROCESS.wait()
        PROCESS = None


atexit.register(stop)


def request(data):
    global PROCESS
    with LOCK:
        try:
            if PROCESS is None or PROCESS.poll() is not None:
                node = os.environ.get('AMUNDSEN_HEARTS_NODE') or shutil.which('node')
                if not node:
                    return 503, {'error': 'The card table needs Node.js on the game server.'}
                env = dict(os.environ)
                env.setdefault('AMUNDSEN_HEARTS_DB', str(ROOT / 'runtime/hearts.json'))
                PROCESS = subprocess.Popen([node, str(ROOT / 'hearts-service.cjs')],
                                           stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                           env=env, bufsize=0)
            PROCESS.stdin.write(json.dumps(data).encode() + b'\n')
            with selectors.DefaultSelector() as selector:
                selector.register(PROCESS.stdout, selectors.EVENT_READ)
                if not selector.select(timeout=8):
                    raise TimeoutError('Card table did not respond')
            result = json.loads(PROCESS.stdout.readline())
            return result['status'], result['body']
        except (OSError, ValueError, TimeoutError):
            stop()
            return 503, {'error': 'The card table is reconnecting. Try again in a moment.'}
