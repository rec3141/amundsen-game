"""Serialized access to the bundled Parlour Hearts service and its private table store."""
import atexit
import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import threading
import queue
import crew_chat

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


def _request(data):
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


CHAT_QUEUE = queue.Queue(maxsize=4)
CHAT_LOCK = threading.Lock()
CHAT_WORKER = None


def chat_worker():
    while True:
        job = CHAT_QUEUE.get()
        try:
            for index, handle in enumerate(job['speakers']):
                context = {**job['context'], 'conversationTurn': index + 1}
                if index:
                    context['replyTo'] = job['context']['chat'][-1]
                text = crew_chat.reply(handle, context)
                earlier = [message['text'] for message in job['context']['chat']
                           if message.get('crew') and message.get('turnReply')]
                if earlier and any(crew_chat.reply_similarity(text, prior) >= 0.72 for prior in earlier):
                    retry_context = {**context,
                                     'distinctReplyRequired': ('Your draft repeated an earlier answer to this turn. Add a new '
                                                               'card-table observation in your own voice without reusing its '
                                                               'opening or sentence structure. If there is nothing new to add, '
                                                               'reply with exactly NO DISTINCT CONTRIBUTION.')}
                    text = crew_chat.reply(handle, retry_context, temperature=1.2)
                    if text.strip().upper() == 'NO DISTINCT CONTRIBUTION' or any(
                            crew_chat.reply_similarity(text, prior) >= 0.72 for prior in earlier):
                        text = ''
                name = crew_chat.PERSONAS[handle]['name']
                _request({'action': 'crewReply', 'code': job['code'], 'name': name,
                          'crew': handle, 'text': text, 'done': index == len(job['speakers']) - 1})
                if text:
                    job['context']['chat'].append({'name': name, 'text': text, 'crew': handle, 'turnReply': True})
        except Exception:
            _request({'action': 'crewReply', 'code': job['code'], 'name': 'Table',
                      'text': 'The crew conversation is unavailable. Try again in a moment.', 'done': True})
        finally:
            CHAT_QUEUE.task_done()


def queue_chat(job):
    global CHAT_WORKER
    if CHAT_QUEUE.full():
        return False
    CHAT_QUEUE.put_nowait(job)
    if CHAT_WORKER is None or not CHAT_WORKER.is_alive():
        CHAT_WORKER = threading.Thread(target=chat_worker, name='card-table-crew', daemon=True)
        CHAT_WORKER.start()
    return True


def request(data):
    if not isinstance(data, dict) or data.get('action') == 'crewReply':
        return 400, {'error': 'Unknown table request.'}
    with CHAT_LOCK:
        if data.get('action') == 'chat' and CHAT_QUEUE.full():
            return 429, {'error': 'The crew are talking at other tables. Try again shortly.'}
        status, body = _request(data)
        job = body.pop('aiJob', None)
        if job:
            queue_chat(job)
        return status, body
