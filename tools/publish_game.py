#!/usr/bin/env python3
"""Mirror the committed game through the underway ship → grid → web route."""
import argparse
import fcntl
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / 'runtime'
SHIP_COPY = Path('/data/underway_server/www/game')
GRID_COPY = '/data/underway_server/www/game'
WEB_COPY = 'dreamhost:cryomics.org/underway/game/'


def run(*argv):
    subprocess.run(argv, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage-only', action='store_true', help='build the public export without network transfer')
    args = parser.parse_args()
    RUNTIME.mkdir(exist_ok=True)
    with (RUNTIME / 'publish.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        revision = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip()
        with tempfile.TemporaryDirectory(prefix='game-public-', dir=RUNTIME) as temp:
            stage = Path(temp)
            stage.chmod(0o755)
            archive = subprocess.check_output(['git', '-C', str(ROOT), 'archive', 'HEAD:static'])
            with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
                tar.extractall(stage, filter='data')
            (stage / 'site.js').write_text('export const publicMirror = true;\n')
            (stage / 'release.json').write_text(json.dumps({'revision': revision, 'published': datetime.now(timezone.utc).isoformat()}) + '\n')
            (stage / '.htaccess').write_text('''DirectoryIndex index.html
Options -Indexes
AddType application/javascript .js
AddType application/json .json
AddType application/gzip .gz
RemoveEncoding .gz
<IfModule mod_headers.c>
  Header set Cache-Control "no-cache, must-revalidate"
  <FilesMatch "\\.gz$">
    Header unset Content-Encoding
  </FilesMatch>
</IfModule>
''')
            SHIP_COPY.mkdir(parents=True, exist_ok=True)
            run('rsync', '-a', '--delete-delay', '--delay-updates', str(stage) + '/', str(SHIP_COPY) + '/')
        print(f'Staged {revision[:12]} at {SHIP_COPY}', flush=True)
        if args.stage_only:
            return
        # The same grid lock protects the dashboard's scheduled mirror deployment.
        run('rsync', '-az', '--delete-delay', '--delay-updates', '--timeout=120',
            '-e', 'ssh -o BatchMode=yes -o ConnectTimeout=15',
            '--rsync-path=flock -w 600 /data/underway_server/.publish.lock rsync',
            str(SHIP_COPY) + '/', f'grid:{GRID_COPY}/')
        run('ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'grid',
            f'flock -w 600 /data/underway_server/.publish.lock rsync -az --delete-delay --delay-updates --timeout=120 {GRID_COPY}/ {WEB_COPY}')
        (RUNTIME / 'game-published.json').write_text(json.dumps({'revision': revision, 'published': datetime.now(timezone.utc).isoformat()}) + '\n')
        print('Published https://cryomics.org/underway/game/', flush=True)


if __name__ == '__main__':
    main()
