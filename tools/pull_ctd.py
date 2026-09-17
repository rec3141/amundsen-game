#!/usr/bin/env python3
"""Bundle published underway CTD JSON byte-for-byte for offline play."""
import argparse
import hashlib
import json
from pathlib import Path


def pull(source, output, leg):
    source = source.resolve()
    index_path = source / 'data/casts/index.json'
    raw_index = index_path.read_bytes()
    entries = json.loads(raw_index)['casts']
    output.mkdir(parents=True, exist_ok=True)
    casts = []
    for entry in sorted(entries, key=lambda x: x['id']):
        if entry['leg'] != leg or entry['kind'] != 'CTD':
            continue
        path = (source / entry['file']).resolve()
        if not path.is_relative_to(source):
            raise ValueError('Cast path escapes source root')
        raw = path.read_bytes()
        profile = json.loads(raw)
        if not profile.get('p') or not isinstance(profile.get('vars'), dict):
            continue
        name = f"{leg}_{entry['cast']}.json"
        (output / name).write_bytes(raw)
        casts.append({'id': entry['id'], 'station': entry.get('station', ''),
                      'file': name, 'source': entry['file'],
                      'sha256': hashlib.sha256(raw).hexdigest()})
    manifest = {'sourceRoot': str(source), 'sourceIndex': 'data/casts/index.json',
                'indexSha256': hashlib.sha256(raw_index).hexdigest(), 'leg': leg,
                'method': 'Published JSON copied byte-for-byte; arrays and units unmodified. '
                          'Underway dashboard/casts.py bins classic CNV downcasts to 1 dbar; '
                          'published plot-derived profiles retain their source representation.',
                'casts': casts}
    (output / 'index.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Bundled {len(casts)} profiles in {output}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('/data/underway_server/www'))
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'static/data/ctd')
    parser.add_argument('--leg', default='2026_LEG_03')
    args = parser.parse_args()
    pull(args.source, args.output, args.leg)
