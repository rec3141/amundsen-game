#!/usr/bin/env python3
"""Launch one headless coding agent per crew idea in an isolated Git worktree."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / 'runtime/crew'
CLAUDE_MODEL = 'claude-fable-5-1'
FALLBACK_MODEL = 'claude-opus-5'
DEFAULT_WORKER = 'claude'
SETTINGS = RUNS / 'worker.json'
RESUME_NOTE = ('An earlier worker on this brief was interrupted before it finished. Check git status and git log in '
               'this worktree, keep what is sound, and finish the brief below.\n\n')

def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)

def preferences():
    try:
        settings = json.loads(SETTINGS.read_text())
    except FileNotFoundError:
        settings = {}
    return {'worker': settings.get('worker', DEFAULT_WORKER), 'fallback': settings.get('fallback', True)}

def configure(worker=None, fallback=None, only_if=None):
    with (RUNS / 'settings.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        settings = preferences()
        if only_if is not None and settings['worker'] != only_if:
            return settings
        if worker is not None:
            settings['worker'] = worker
        if fallback is not None:
            settings['fallback'] = fallback
        write_json(SETTINGS, settings)
        return settings

def rate_limited(events):
    """Inspect provider errors only; quoted task text and tool output are not limit signals."""
    if not events.exists():
        return False
    for line in events.read_text(errors='replace').splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if not isinstance(event, dict):
            continue
        kind = event.get('type')
        is_error = (kind in ('error', 'turn.failed') or
                    (kind == 'result' and event.get('is_error')) or
                    (kind == 'assistant' and event.get('error')) or
                    (kind == 'rate_limit_event' and event.get('rate_limit_info', {}).get('status') == 'rejected'))
        if not is_error:
            continue
        if event.get('api_error_status') == 429:
            return True
        message = json.dumps({key: event.get(key) for key in
                              ('error', 'message', 'result', 'rate_limit_info')}).lower()
        if re.search(r"rate.?limit|usage.?limit|session.?limit|quota|insufficient_quota|too many requests|usage_limit_reached|hit your.*limit", message):
            return True
    return False

def last_events(run):
    state = json.loads((run / 'state.json').read_text())
    if state.get('events'):
        return run / state['events']
    return max(run.glob('events*.jsonl'), key=lambda path: path.stat().st_mtime, default=run / 'events.jsonl')

def command(worker, state, run, model=None):
    """Both workers read the brief on stdin and stream JSON events to stdout."""
    if worker == 'codex':
        return ['codex', 'exec', '-C', state['worktree'], '-s', 'danger-full-access',
                '-c', 'approval_policy="never"', '--json', '-o', str(run / 'result.md'), '-']
    # A headless worker has nobody to approve tool calls, so permissions are bypassed.
    return ['claude', '-p', '--model', model or CLAUDE_MODEL, '--dangerously-skip-permissions',
            '--output-format', 'stream-json', '--verbose']

def supervise(run):
    """Detach a supervisor for the run and return its pid."""
    with (run / 'launcher.log').open('ab') as log:
        process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '_worker', str(run)],
                                   stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    return process.pid

def alive(pid):
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except (OSError, TypeError):
        return False
    return True

def claude_result(events):
    """Return (final report, failed) from Claude Code's stream-json events."""
    for line in reversed(events.read_text().splitlines()):
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if isinstance(event, dict) and event.get('type') == 'result':
            return event.get('result') or '', bool(event.get('is_error'))
    return '', True

def run_worker(run):
    state = json.loads((run / 'state.json').read_text())
    worker = state.get('worker', preferences()['worker'])
    tried = set()
    code, limited = 1, False
    state['supervisor_pid'] = os.getpid()
    while worker not in tried:
        tried.add(worker)
        models = [CLAUDE_MODEL, FALLBACK_MODEL] if worker == 'claude' else [None]
        for model in models:
            attempt = state['attempts'] = state.get('attempts', 0) + 1
            events = run / ('events.jsonl' if attempt == 1 else f'events-{attempt}-{model or worker}.jsonl')
            report_path = run / f'result-{attempt}.md'
            prompt = (run / 'brief.md').read_bytes()
            if attempt > 1:
                prompt = (RESUME_NOTE + 'Continue in the SAME branch/worktree. Read the existing diff and commits before editing. '
                          'NO TESTS: do not create test files. Keep the original file scope and do not deploy or merge.\n\n').encode() + prompt
            state.update(status='running', worker=worker, model=model, events=events.name)
            argv = command(worker, state, run, model)
            if worker == 'codex':
                argv[argv.index('-o') + 1] = str(report_path)
            with events.open('wb') as output, (run / f'stderr-{attempt}.log').open('wb') as errors:
                try:
                    process = subprocess.Popen(argv, cwd=state['worktree'], stdin=subprocess.PIPE, stdout=output, stderr=errors)
                    state['pid'] = process.pid
                    write_json(run / 'state.json', state)
                    process.communicate(prompt)
                    code = process.returncode
                except OSError as error:
                    state['error'] = str(error)
                    code = 127
            limited = rate_limited(events)
            if worker == 'claude':
                report, failed = claude_result(events)
                report_path.write_text(report)
                code = code or int(failed)
            code = code or int(limited)
            state.setdefault('history', []).append({'worker': worker, 'model': model, 'attempt': attempt,
                'events': events.name, 'exit_code': code, 'rate_limited': limited, 'finished': time.time()})
            if report_path.exists():
                (run / 'result.md').write_text(report_path.read_text())
            if code == 0 or limited or code == 127:
                break
        if code == 0 or not limited or not preferences()['fallback']:
            break
        alternate = 'codex' if worker == 'claude' else 'claude'
        if alternate in tried:
            break
        state['switch_reason'] = f'{worker} usage limit; continuing with {alternate}'
        state['status'] = 'switching'
        write_json(run / 'state.json', state)
        configure(alternate, only_if=worker)
        print(state['switch_reason'], flush=True)
        worker = alternate
    state.update(status='ready_for_review' if code == 0 else 'limited' if limited else 'failed',
                 exit_code=code, finished=time.time())
    write_json(run / 'state.json', state)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    start = sub.add_parser('start')
    start.add_argument('slug')
    start.add_argument('brief', type=Path)
    start.add_argument('--worker', choices=['claude', 'codex'], help='override the saved worker preference')
    resume = sub.add_parser('resume', help='relaunch a dead or failed run in its existing worktree')
    resume.add_argument('slug')
    resume.add_argument('--worker', choices=['claude', 'codex'], help='continue the existing worktree with this worker')
    switch = sub.add_parser('switch', help='show or change the worker for new/resumed jobs')
    switch.add_argument('worker', nargs='?', choices=['claude', 'codex'])
    switch.add_argument('--fallback', choices=['on', 'off'])
    sub.add_parser('status')
    worker = sub.add_parser('_worker')
    worker.add_argument('run', type=Path)
    args = parser.parse_args()
    RUNS.mkdir(parents=True, exist_ok=True)
    if args.command == 'switch':
        print(json.dumps(configure(args.worker, None if args.fallback is None else args.fallback == 'on'), indent=2))
    elif args.command == 'start':
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', args.slug):
            parser.error('Use a lowercase slug with hyphens.')
        run = RUNS / args.slug
        if run.exists():
            parser.error('This run already exists; inspect its status before retrying.')
        brief = args.brief.read_text()
        branch = f'crew/{args.slug}'
        worktree = ROOT.parent / 'amundsen-game-worktrees' / args.slug
        subprocess.run(['git', '-C', str(ROOT), 'worktree', 'add', '-b', branch, str(worktree), 'main'], check=True)
        run.mkdir()
        (run / 'brief.md').write_text(brief)
        state = {'branch': branch, 'worktree': str(worktree), 'worker': args.worker or preferences()['worker'], 'status': 'starting', 'started': time.time()}
        (run / 'state.json').write_text(json.dumps(state, indent=2))
        print(json.dumps({**state, 'supervisor_pid': supervise(run)}, indent=2))
    elif args.command == 'resume':
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', args.slug):
            parser.error('Use a lowercase slug with hyphens.')
        run = RUNS / args.slug
        state = json.loads((run / 'state.json').read_text())
        if state['status'] in ('starting', 'running', 'switching') and (alive(state.get('pid')) or alive(state.get('supervisor_pid'))):
            parser.error('This run is still working.')
        if state['status'] == 'retired':
            parser.error('This prototype is retired; scope a new run instead.')
        if state['status'] == 'merged':
            parser.error('This run is merged; start a new revision branch.')
        state.update(status='starting', worker=args.worker or preferences()['worker'], started=time.time(), attempts=state.get('attempts', 1))
        state.pop('finished', None); state.pop('exit_code', None)
        (run / 'state.json').write_text(json.dumps(state, indent=2))
        print(json.dumps({**state, 'supervisor_pid': supervise(run)}, indent=2))
    elif args.command == '_worker':
        run = args.run
        with (run / 'worker.lock').open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return
            run_worker(run)
    else:
        settings = preferences()
        print(f"Preferred worker: {settings['worker']} · automatic fallback: {'on' if settings['fallback'] else 'off'}")
        for path in sorted(RUNS.glob('*/state.json')):
            state = json.loads(path.read_text())
            status = state['status']
            if status in ('starting', 'running', 'switching') and not (alive(state.get('pid')) or alive(state.get('supervisor_pid'))):
                status = 'DEAD (resume it)'
            print(f"{state['branch']}: {status} ({state.get('model') or state.get('worker', 'codex')} pid {state.get('pid', 'pending')})")

if __name__ == '__main__':
    main()
