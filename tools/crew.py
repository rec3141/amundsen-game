#!/usr/bin/env python3
"""Launch one headless coding agent per crew idea in an isolated Git worktree."""
import argparse
import json
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
RESUME_NOTE = ('An earlier worker on this brief stopped with an error. Check git status and git log in this '
               'worktree, keep what is sound, and finish the brief below.\n\n')

def command(worker, state, run, model=None):
    """Both workers read the brief on stdin and stream JSON events to stdout."""
    if worker == 'codex':
        return ['codex', 'exec', '-C', state['worktree'], '-s', 'danger-full-access',
                '-c', 'approval_policy="never"', '--json', '-o', str(run / 'result.md'), '-']
    # A headless worker has nobody to approve tool calls, so permissions are bypassed.
    return ['claude', '-p', '--model', model or CLAUDE_MODEL, '--dangerously-skip-permissions',
            '--output-format', 'stream-json', '--verbose']

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

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    start = sub.add_parser('start')
    start.add_argument('slug')
    start.add_argument('brief', type=Path)
    start.add_argument('--worker', choices=['claude', 'codex'], default=DEFAULT_WORKER)
    sub.add_parser('status')
    worker = sub.add_parser('_worker')
    worker.add_argument('run', type=Path)
    args = parser.parse_args()
    RUNS.mkdir(parents=True, exist_ok=True)
    if args.command == 'start':
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
        state = {'branch': branch, 'worktree': str(worktree), 'worker': args.worker, 'status': 'starting', 'started': time.time()}
        (run / 'state.json').write_text(json.dumps(state, indent=2))
        with (run / 'launcher.log').open('ab') as log:
            process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '_worker', str(run)],
                                       stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        print(json.dumps({**state, 'supervisor_pid': process.pid}, indent=2))
    elif args.command == '_worker':
        run = args.run
        state = json.loads((run / 'state.json').read_text())
        worker = state.get('worker', 'codex')
        # A Claude run that errors (a classifier block, an API failure) is relaunched once on the fallback model.
        models = [CLAUDE_MODEL, FALLBACK_MODEL] if worker == 'claude' else [None]
        for attempt, model in enumerate(models):
            events = run / ('events.jsonl' if not attempt else f'events-{model}.jsonl')
            prompt = (run / 'brief.md').read_bytes()
            if attempt:
                prompt = RESUME_NOTE.encode() + prompt
            with events.open('wb') as output, (run / 'stderr.log').open('ab') as errors:
                process = subprocess.Popen(command(worker, state, run, model), cwd=state['worktree'],
                                           stdin=subprocess.PIPE, stdout=output, stderr=errors)
                state.update(status='running', pid=process.pid, model=model)
                (run / 'state.json').write_text(json.dumps(state, indent=2))
                process.communicate(prompt)
                code = process.returncode
            if worker == 'claude':
                report, failed = claude_result(events)
                (run / 'result.md').write_text(report)
                code = code or int(failed)
            if code == 0:
                break
        state.update(status='ready_for_review' if code == 0 else 'failed', exit_code=code, finished=time.time())
        (run / 'state.json').write_text(json.dumps(state, indent=2))
    else:
        for path in sorted(RUNS.glob('*/state.json')):
            state = json.loads(path.read_text())
            print(f"{state['branch']}: {state['status']} ({state.get('model') or state.get('worker', 'codex')} pid {state.get('pid', 'pending')})")

if __name__ == '__main__':
    main()
