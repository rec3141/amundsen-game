#!/usr/bin/env python3
"""Launch one headless Codex process per crew idea in an isolated Git worktree."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / 'runtime/crew'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    start = sub.add_parser('start')
    start.add_argument('slug')
    start.add_argument('brief', type=Path)
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
        state = {'branch': branch, 'worktree': str(worktree), 'status': 'starting', 'started': time.time()}
        (run / 'state.json').write_text(json.dumps(state, indent=2))
        with (run / 'launcher.log').open('ab') as log:
            process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '_worker', str(run)],
                                       stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        print(json.dumps({**state, 'supervisor_pid': process.pid}, indent=2))
    elif args.command == '_worker':
        run = args.run
        state = json.loads((run / 'state.json').read_text())
        with (run / 'brief.md').open('rb') as brief, (run / 'events.jsonl').open('wb') as output, (run / 'stderr.log').open('wb') as errors:
            process = subprocess.Popen(['codex', 'exec', '-C', state['worktree'], '-s', 'danger-full-access',
                                        '-c', 'approval_policy="never"', '--json', '-o', str(run / 'result.md'), '-'],
                                       stdin=brief, stdout=output, stderr=errors)
            state.update(status='running', pid=process.pid)
            (run / 'state.json').write_text(json.dumps(state, indent=2))
            code = process.wait()
        state.update(status='ready_for_review' if code == 0 else 'failed', exit_code=code, finished=time.time())
        (run / 'state.json').write_text(json.dumps(state, indent=2))
    else:
        for path in sorted(RUNS.glob('*/state.json')):
            state = json.loads(path.read_text())
            print(f"{state['branch']}: {state['status']} (pid {state.get('pid', 'pending')})")

if __name__ == '__main__':
    main()
