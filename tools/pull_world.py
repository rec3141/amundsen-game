#!/usr/bin/env python3
"""Build the offline open-world assets from the underway GIS and ice-chart sources.

Reads (never writes) the GEBCO 2024 sub-ice GeoTIFF release, the OSM land polygons
the underway coastline tiles are cut from, the Natural Earth glaciated areas and
communities published with the dashboard, the newest CIS ice chart per region, the
ship's underway track and the Leg 3 cruise plan.

Writes under static/data/world/:
  world.bin.gz  gzip of the concatenated grid layers listed in world.json
  world.json    projection, bounds, layer table, ice classes, places, ship track,
                starting position and the provenance of every source file

The grid is WGS84 polar stereographic (true scale 78 N, central meridian 90 W),
north up along 90 W. static/world.js implements the same projection.

Needs numpy and the GDAL command-line tools (gdalbuildvrt, gdalwarp, ogr2ogr,
gdal_rasterize); GDAL reads the GeoTIFFs straight from the release zip.
"""
import argparse
import gzip
import hashlib
import json
import math
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

try:
    import numpy as np
except ImportError:
    sys.exit('pull_world.py needs numpy (pip install numpy).')

PROJ = {'lat_ts': 78.0, 'lon_0': -90.0, 'a': 6378137.0, 'f': 1 / 298.257223563}
PROJ4 = f"+proj=stere +lat_0=90 +lat_ts={PROJ['lat_ts']} +lon_0={PROJ['lon_0']} +datum=WGS84 +units=m +no_defs"
# Projected metres: Beaufort Sea to Baffin Bay, Gulf of Boothia to the Lincoln Sea.
EXTENT = (-1300000, -2400000, 1300000, -600000)
LAND_SUBCELLS = 4          # the shore is rasterised this many times finer than the grid
LAND_FRACTION = 0.55       # a cell is land when more than this share of it is land, which keeps straits open
TOOLS = ('gdalbuildvrt', 'gdalwarp', 'ogr2ogr', 'gdal_rasterize')


def run(*args):
    subprocess.run([str(a) for a in args], check=True, stdout=subprocess.DEVNULL)


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        while chunk := handle.read(1 << 22):
            digest.update(chunk)
    return digest.hexdigest()


def source(path, role):
    path = Path(path)
    stat = path.stat()
    return {'role': role, 'path': str(path), 'bytes': stat.st_size, 'sha256': sha256(path),
            'modified': datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(timespec='seconds')}


def forward(lon, lat):
    """WGS84 polar stereographic, north pole aspect (Snyder 21-33, 21-34, 15-9)."""
    e = math.sqrt(2 * PROJ['f'] - PROJ['f'] ** 2)
    def t(phi):
        s = math.sin(phi)
        return math.tan(math.pi / 4 - phi / 2) / ((1 - e * s) / (1 + e * s)) ** (e / 2)
    phi_c = math.radians(PROJ['lat_ts'])
    m_c = math.cos(phi_c) / math.sqrt(1 - (e * math.sin(phi_c)) ** 2)
    rho = PROJ['a'] * m_c * t(math.radians(lat)) / t(phi_c)
    lam = math.radians(lon - PROJ['lon_0'])
    return rho * math.sin(lam), -rho * math.cos(lam)


def inverse(x, y):
    e = math.sqrt(2 * PROJ['f'] - PROJ['f'] ** 2)
    phi_c = math.radians(PROJ['lat_ts'])
    s = math.sin(phi_c)
    t_c = math.tan(math.pi / 4 - phi_c / 2) / ((1 - e * s) / (1 + e * s)) ** (e / 2)
    m_c = math.cos(phi_c) / math.sqrt(1 - (e * s) ** 2)
    t = math.hypot(x, y) * t_c / (PROJ['a'] * m_c)
    phi = math.pi / 2 - 2 * math.atan(t)
    for _ in range(8):
        s = math.sin(phi)
        phi = math.pi / 2 - 2 * math.atan(t * ((1 - e * s) / (1 + e * s)) ** (e / 2))
    return PROJ['lon_0'] + math.degrees(math.atan2(x, -y)), math.degrees(phi)


def lonlat_bounds():
    xmin, ymin, xmax, ymax = EXTENT
    edge = [(xmin + (xmax - xmin) * i / 64, y) for i in range(65) for y in (ymin, ymax)]
    edge += [(x, ymin + (ymax - ymin) * i / 64) for i in range(65) for x in (xmin, xmax)]
    points = [inverse(x, y) for x, y in edge]
    lons, lats = [p[0] for p in points], [p[1] for p in points]
    return min(lons), min(lats), max(lons), max(lats)


def read_grid(path, dtype, cols, rows):
    data = np.fromfile(path, dtype=dtype)
    if data.size != cols * rows:
        raise ValueError(f'{path}: expected {cols}x{rows} cells, found {data.size}')
    return data.reshape(rows, cols)


def te(res):
    return ['-te', *EXTENT, '-tr', res, res]


def build_elevation(zip_path, work, res, cols, rows, bounds):
    """Average the 15 arc-second GEBCO cells that fall in each grid cell."""
    names = []
    for west in (-180, -90, 0, 90):
        if bounds[0] < west + 90 and bounds[2] > west:
            names.append(f'gebco_2024_sub_ice_n90.0_s0.0_w{west:.1f}_e{west + 90:.1f}.tif')
    vrt = work / 'gebco.vrt'
    run('gdalbuildvrt', '-q', vrt, *[f'/vsizip/{zip_path}/{name}' for name in names])
    out = work / 'elevation.bin'
    run('gdalwarp', '-q', '-overwrite', '-t_srs', PROJ4, *te(res), '-r', 'average', '-ot', 'Int16',
        '-of', 'ENVI', '-wm', '1024', vrt, out)
    return read_grid(out, '<i2', cols, rows), names


def rasterize(vector, out, res, attribute=None, init=0, layer=None, create=True):
    args = ['gdal_rasterize', '-q']
    if layer:
        args += ['-l', layer]
    args += ['-a', attribute] if attribute else ['-burn', '1']
    if create:
        args += ['-init', init, '-a_nodata', init, *te(res), '-ot', 'Byte', '-of', 'ENVI']
    run(*args, vector, out)


def reproject(src, dst, bounds, layer=None, segmentize=None):
    args = ['ogr2ogr', '-q', '-overwrite', '-f', 'GPKG', '-t_srs', PROJ4, '-nlt', 'PROMOTE_TO_MULTI',
            '-spat', *bounds, '-spat_srs', 'EPSG:4326', '-nln', 'layer', '-makevalid']
    if segmentize:
        args += ['-segmentize', segmentize]
    args += [dst, src]
    if layer:
        args.append(layer)
    run(*args)


def build_land(land_path, land_layer, work, res, cols, rows, bounds):
    """Share of each grid cell covered by the land polygons."""
    shore = work / 'land.gpkg'
    reproject(land_path, shore, bounds, layer=land_layer)
    fine = work / 'land.bin'
    rasterize(shore, fine, res / LAND_SUBCELLS, layer='layer')
    n = LAND_SUBCELLS
    mask = read_grid(fine, 'u1', cols * n, rows * n)
    return mask.reshape(rows, n, cols, n).mean(axis=(1, 3))


def build_glaciers(path, work, res, cols, rows, bounds):
    shape = work / 'glaciers.gpkg'
    reproject(path, shape, bounds, segmentize=0.05)
    out = work / 'glaciers.bin'
    rasterize(shape, out, res, layer='layer')
    return read_grid(out, 'u1', cols, rows)


def newest_charts(folder):
    """The newest CIS chart of each region: {region-slug: path}."""
    newest = {}
    for path in sorted(Path(folder).glob('*-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].geojson')):
        newest[path.stem[:-11]] = path       # sorted by name, so the last date wins
    return newest


def dominant_partial(p):
    """Stage and form of the partial concentration that covers the most water."""
    best = ('a', -1)
    for key in 'abc':
        try:
            share = int(p.get('C' + key.upper(), '-9'))
        except ValueError:
            share = -9
        if share > best[1]:
            best = (key, share)
    key = best[0]
    return p.get(f'stage_{key}') or 'Not reported', p.get(f'form_{key}') or 'Not reported'


def build_ice(charts, work, res, cols, rows, bounds):
    """Total concentration (percent, 255 where no chart covers) and an ice-class index per cell."""
    classes = [{'stage': 'Not reported', 'form': 'Not reported'}]
    lookup = {('Not reported', 'Not reported'): 0}
    conc_path, class_path = work / 'ice_conc.bin', work / 'ice_class.bin'
    used = []
    for index, (region, path) in enumerate(sorted(charts.items())):
        chart = json.loads(Path(path).read_text())
        features = []
        for feature in chart['features']:
            p = feature['properties']
            kind = p.get('polygon_type')
            if kind == 'W':
                conc, key = 0, ('Not reported', 'Not reported')
            elif kind == 'I' and p.get('concentration') is not None:
                conc, key = round(float(p['concentration']) * 10), dominant_partial(p)
            elif kind == 'S':
                conc, key = 100, ('Ice shelf', 'Ice shelf')
            else:
                continue                      # no-data and land polygons leave the cell uncharted
            if key not in lookup:
                lookup[key] = len(classes)
                classes.append({'stage': key[0], 'form': key[1]})
            features.append({'type': 'Feature', 'geometry': feature['geometry'],
                             'properties': {'conc': int(conc), 'cls': lookup[key]}})
        raw = work / f'ice_{index}.geojson'
        raw.write_text(json.dumps({'type': 'FeatureCollection', 'features': features}))
        shape = work / f'ice_{index}.gpkg'
        reproject(raw, shape, bounds, segmentize=0.05)
        rasterize(shape, conc_path, res, attribute='conc', init=255, layer='layer', create=index == 0)
        rasterize(shape, class_path, res, attribute='cls', init=0, layer='layer', create=index == 0)
        meta = chart.get('chart', {})
        used.append({'region': meta.get('region', region), 'date': meta.get('date'), 'validTime': meta.get('valid_time'),
                     'attribution': meta.get('attribution'), 'sourceUrl': meta.get('source_url'),
                     'polygons': len(features), **source(path, 'CIS regional ice chart (egg-code polygons)')})
    if len(classes) > 255:
        raise ValueError('More than 255 ice classes')
    return read_grid(conc_path, 'u1', cols, rows), read_grid(class_path, 'u1', cols, rows), classes, used


def inside(x, y):
    return EXTENT[0] <= x <= EXTENT[2] and EXTENT[1] <= y <= EXTENT[3]


def build_places(path):
    places = []
    for feature in json.loads(Path(path).read_text())['features']:
        if feature['geometry']['type'] != 'Point':
            continue
        lon, lat = feature['geometry']['coordinates'][:2]
        p = feature['properties']
        name = p.get('name') or p.get('NAME') or p.get('name_en')
        if name and inside(*forward(lon, lat)):
            places.append({'name': name, 'lon': round(lon, 4), 'lat': round(lat, 4)})
    return sorted(places, key=lambda place: place['name'])


def build_track(path, spacing):
    """The ship's logged positions inside the world, thinned to one fix per `spacing` metres."""
    data = json.loads(Path(path).read_text())
    track, last = [], None
    for lon, lat in zip(data['lon'], data['lat']):
        if lon is None or lat is None:
            continue
        x, y = forward(lon, lat)
        if not inside(x, y):
            last = None
            continue
        if last is None or math.hypot(x - last[0], y - last[1]) >= spacing:
            track.append([round(lon, 3), round(lat, 3)])
            last = (x, y)
    return track, {'start': data.get('start'), 'end': data.get('end')}


def clearance(land, res):
    """Distance in cells from each water cell to the nearest land cell (chamfer-free BFS rings, capped)."""
    dist = np.where(land, 0, 255).astype(np.uint8)
    for ring in range(1, 40):
        near = np.zeros_like(land)
        reached = dist < ring
        near[1:, :] |= reached[:-1, :]
        near[:-1, :] |= reached[1:, :]
        near[:, 1:] |= reached[:, :-1]
        near[:, :-1] |= reached[:, 1:]
        dist[(dist == 255) & near] = ring
    return dist


def pick_start(plan_path, land, res, cols, rows):
    """The first waypoint of the Leg 3 plan with 15 km of sea room: the opening of the leg, clear of the pier."""
    plan = json.loads(Path(plan_path).read_text())
    room = clearance(land, res)
    for track in plan['tracks']:
        if track.get('alternate'):
            continue
        coords = track['coords']
        for (lon0, lat0), (lon1, lat1) in zip(coords, coords[1:]):
            for step in range(20):
                lon, lat = lon0 + (lon1 - lon0) * step / 20, lat0 + (lat1 - lat0) * step / 20
                x, y = forward(lon, lat)
                col, row = int((x - EXTENT[0]) / res), int((EXTENT[3] - y) / res)
                if 0 <= col < cols and 0 <= row < rows and int(room[row, col]) * res >= 15000:
                    return {'lon': round(lon, 4), 'lat': round(lat, 4), 'plan': plan.get('name'), 'track': track.get('name')}
    raise ValueError('No open-water waypoint on the cruise plan')


def delta_rows(grid):
    """Row-wise differences (wrapping int16): smooth terrain gzips to a fraction of its raw size."""
    out = grid.astype('<i2').copy()
    out[:, 1:] = (grid[:, 1:].astype(np.int32) - grid[:, :-1].astype(np.int32)).astype('<i2')
    return out


def pull(args):
    missing = [tool for tool in TOOLS if not shutil.which(tool)]
    if missing:
        sys.exit(f"pull_world.py needs the GDAL command-line tools; missing: {', '.join(missing)}")
    www = args.www.resolve()
    res = args.resolution
    cols, rows = round((EXTENT[2] - EXTENT[0]) / res), round((EXTENT[3] - EXTENT[1]) / res)
    bounds = lonlat_bounds()
    charts = newest_charts(www / 'data/ice-charts')
    if not charts:
        sys.exit(f'No ice charts under {www}/data/ice-charts')
    with tempfile.TemporaryDirectory(prefix='amundsen-world-') as tmp:
        work = Path(tmp)
        print(f'grid {cols}x{rows} at {res} m; lon/lat window {[round(b, 2) for b in bounds]}')
        elevation, gebco_tiles = build_elevation(args.gebco, work, res, cols, rows, bounds)
        print('elevation done')
        fraction = build_land(args.land, args.land_layer, work, res, cols, rows, bounds)
        print('shore done')
        glaciers = build_glaciers(www / 'static/geo/glaciated_areas.geojson', work, res, cols, rows, bounds)
        conc, cls, classes, chart_sources = build_ice(charts, work, res, cols, rows, bounds)
        print('ice done')
    land = fraction > LAND_FRACTION
    # The shore comes from the land polygons; GEBCO only supplies heights and depths on either side of it.
    # Sub-ice bedrock below sea level (under ice caps) stays land, and a strait GEBCO closes stays water.
    elevation = np.where(land, np.maximum(elevation, 1), np.minimum(elevation, -2)).astype('<i2')
    conc = np.where(land, 255, conc).astype('u1')
    cls = np.where(land | (conc == 255), 0, cls).astype('u1')
    cover = (land & (glaciers > 0)).astype('u1')

    layers, blob = [], b''
    for name, dtype, encoding, grid in (('elevation', 'int16', 'row-delta', delta_rows(elevation)),
                                        ('iceConcentration', 'uint8', 'raw', conc),
                                        ('iceClass', 'uint8', 'raw', cls),
                                        ('glacier', 'uint8', 'raw', cover)):
        raw = grid.tobytes()
        layers.append({'name': name, 'dtype': dtype, 'encoding': encoding, 'offset': len(blob), 'bytes': len(raw)})
        blob += raw
    args.output.mkdir(parents=True, exist_ok=True)
    packed = gzip.compress(blob, 9, mtime=0)
    (args.output / 'world.bin.gz').write_bytes(packed)

    track, track_span = build_track(www / 'data/w-1y.json', 8000)
    start = pick_start(www / 'data/plan.json', land, res, cols, rows)
    water = ~land
    charted = water & (conc != 255)
    world = {
        'version': 1,
        'generated': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'generator': 'tools/pull_world.py',
        'projection': {'name': 'WGS84 polar stereographic, north', 'proj4': PROJ4, 'latTs': PROJ['lat_ts'],
                       'lon0': PROJ['lon_0'], 'a': PROJ['a'], 'f': PROJ['f']},
        'grid': {'cols': cols, 'rows': rows, 'resolution': res, 'xmin': EXTENT[0], 'ymin': EXTENT[1],
                 'xmax': EXTENT[2], 'ymax': EXTENT[3], 'origin': 'top-left cell first, rows run north to south',
                 'lonLatWindow': [round(b, 3) for b in bounds]},
        'data': {'file': 'world.bin.gz', 'compression': 'gzip', 'bytes': len(packed), 'rawBytes': len(blob),
                 'sha256': hashlib.sha256(packed).hexdigest(), 'byteOrder': 'little-endian', 'layers': layers},
        'units': {'elevation': 'metres; land is >= 1, water is <= -2',
                  'iceConcentration': 'percent of the sea surface (CIS total concentration, tenths x 10); 255 = land or no chart',
                  'iceClass': 'index into ice.classes: stage of development and floe form of the dominant partial concentration',
                  'glacier': '1 where Natural Earth maps glacier or ice cap over land'},
        'ice': {'classes': classes, 'charts': [{k: c[k] for k in ('region', 'date', 'validTime', 'attribution')} for c in chart_sources]},
        'start': start,
        'places': build_places(www / 'static/geo/communities.geojson'),
        'shipTrack': {'span': track_span, 'spacing': 8000, 'lonLat': track},
        'stats': {'landCells': int(land.sum()), 'waterCells': int(water.sum()), 'iceChartedWaterCells': int(charted.sum()),
                  'iceCells40': int((charted & (conc >= 40)).sum()), 'deepest': int(elevation.min()), 'highest': int(elevation.max())},
        'method': f'GEBCO 15 arc-second cells averaged onto the grid (gdalwarp -r average). Shore: OSM land polygons rasterised at '
                  f'{res // LAND_SUBCELLS} m; a cell is land when more than {LAND_FRACTION:.0%} of it is land. Ice: newest chart per '
                  'region burned in region order; water polygons are 0, no-data polygons leave 255.',
        'sources': [
            {**source(args.gebco, 'GEBCO 2024 sub-ice topography and bathymetry, 15 arc-second GeoTIFF release'), 'tiles': gebco_tiles},
            {**source(args.land, 'OSM land polygons (shore)'), 'layer': args.land_layer},
            source(www / 'static/geo/glaciated_areas.geojson', 'Natural Earth glaciated areas'),
            source(www / 'static/geo/communities.geojson', 'Communities'),
            source(www / 'data/w-1y.json', 'CCGS Amundsen underway track, past year'),
            source(www / 'data/plan.json', 'Leg 3 cruise plan (starting position)'),
            *[{k: v for k, v in c.items() if k not in ('attribution', 'validTime')} for c in chart_sources],
        ],
    }
    (args.output / 'world.json').write_text(json.dumps(world, indent=1, ensure_ascii=False) + '\n')
    print(f"world.bin.gz {len(packed) / 1e6:.2f} MB ({len(blob) / 1e6:.1f} MB raw); "
          f"{world['stats']['waterCells']} water cells, {world['stats']['iceCells40']} with ice >= 4/10; start {start['lon']}, {start['lat']}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--gebco', type=Path, default=Path('/data/gis/gebco/gebco_2024_sub_ice_topo_geotiff.zip'))
    parser.add_argument('--land', type=Path, default=Path('/data/gis/shoreline/arctic_coast.gpkg'))
    parser.add_argument('--land-layer', default='land')
    parser.add_argument('--www', type=Path, default=Path('/data/underway_server/www'))
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'static/data/world')
    parser.add_argument('--resolution', type=int, default=2000, help='grid cell size in projected metres')
    pull(parser.parse_args())
