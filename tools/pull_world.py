#!/usr/bin/env python3
"""Build the offline open-world assets from the underway GIS and ice-chart sources.

Reads (never writes) the GEBCO 2024 sub-ice GeoTIFF release, the OSM land polygons
the underway coastline tiles are cut from, the Natural Earth land and minor-island
polygons where the OSM extract stops, the Natural Earth glaciated areas published
with the dashboard, the GeoNames dumps for Canada and Greenland, the newest CIS ice
chart per region, the ship's underway track and the Leg 3 cruise plan.

Writes under static/data/world/:
  world.bin.gz  gzip of the concatenated grid layers listed in world.json
  world.json    projection, bounds, layer table, ice classes, places, ship track,
                starting position and the provenance of every source file

The grid is WGS84 polar stereographic (true scale 78 N, central meridian 90 W),
north up along 90 W. It covers the sector 0-180 W, 50-90 N with the pole inside:
the rectangle that encloses that half-disc, whose corners reach below 50 N in the
mid-Atlantic and the north-east Pacific. static/world.js implements the same
projection; static/exploration.js carries saved voyages between grids.

Needs numpy, scipy and the GDAL command-line tools (gdalbuildvrt, gdalwarp, ogr2ogr,
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
import zipfile
from datetime import datetime, timezone
from pathlib import Path

try:
    import numpy as np
    from scipy import ndimage
except ImportError:
    sys.exit('pull_world.py needs numpy and scipy (pip install numpy scipy).')

PROJ = {'lat_ts': 78.0, 'lon_0': -90.0, 'a': 6378137.0, 'f': 1 / 298.257223563}
PROJ4 = f"+proj=stere +lat_0=90 +lat_ts={PROJ['lat_ts']} +lon_0={PROJ['lon_0']} +datum=WGS84 +units=m +no_defs"
# Projected metres. The parallel of 50 N is 4,600.4 km from the pole; 0 W and 180 W lie along y = 0, so
# the sector fills y <= 0 and the top edge stands 60 km beyond the pole. The edges are multiples of 20 km
# from the previous grid's, so the 20 km fog cells of saved voyages map one to one (exploration.js).
EXTENT = (-4620000, -4620000, 4620000, 60000)
# The OSM extract's window in lon/lat; Natural Earth supplies the shore outside it.
OSM_BBOX = (-150.0, 45.0, -15.0, 86.0)
LAND_SUBCELLS = 4          # the shore is rasterised this many times finer than the grid
LAND_FRACTION = 0.55       # a cell is land when more than this share of it is land, which keeps straits open
SEA_APPROACH = 2           # a place is charted when a water cell lies within this many cells of it
# The opening of Leg 3: the Plan A track off Pituffik where the ship first has 15 km of sea room, as fixed on
# the first chart. Kept while it stays on the plan's track and keeps that sea room on the current grid.
START = (-70.5573, 76.5109)
SEA_ROOM = 15000
SKIP_PLACE_CODES = {'PPLQ', 'PPLH', 'PPLW', 'PPLX', 'PPLCH'}   # abandoned, historical, destroyed, sections of places
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


E = math.sqrt(2 * PROJ['f'] - PROJ['f'] ** 2)


def forward(lon, lat):
    """WGS84 polar stereographic, north pole aspect (Snyder 21-33, 21-34, 15-9)."""
    def t(phi):
        s = math.sin(phi)
        return math.tan(math.pi / 4 - phi / 2) / ((1 - E * s) / (1 + E * s)) ** (E / 2)
    phi_c = math.radians(PROJ['lat_ts'])
    m_c = math.cos(phi_c) / math.sqrt(1 - (E * math.sin(phi_c)) ** 2)
    rho = PROJ['a'] * m_c * t(math.radians(lat)) / t(phi_c)
    lam = math.radians(lon - PROJ['lon_0'])
    return rho * math.sin(lam), -rho * math.cos(lam)


def inverse(x, y):
    """Inverse projection; x and y may be numpy arrays."""
    phi_c = math.radians(PROJ['lat_ts'])
    s = math.sin(phi_c)
    t_c = math.tan(math.pi / 4 - phi_c / 2) / ((1 - E * s) / (1 + E * s)) ** (E / 2)
    m_c = math.cos(phi_c) / math.sqrt(1 - (E * s) ** 2)
    t = np.hypot(x, y) * t_c / (PROJ['a'] * m_c)
    phi = np.pi / 2 - 2 * np.arctan(t)
    for _ in range(8):
        s = np.sin(phi)
        phi = np.pi / 2 - 2 * np.arctan(t * ((1 - E * s) / (1 + E * s)) ** (E / 2))
    return PROJ['lon_0'] + np.degrees(np.arctan2(x, -y)), np.degrees(phi)


def lonlat_bounds():
    """Lon/lat window that contains the grid: every longitude once the pole is inside it."""
    xmin, ymin, xmax, ymax = EXTENT
    corners = [inverse(x, y) for x in (xmin, xmax) for y in (ymin, ymax)]
    lat_min = min(float(lat) for _, lat in corners)
    if xmin < 0 < xmax and ymin < 0 < ymax:
        return -180.0, lat_min, 180.0, 90.0
    edge = [(xmin + (xmax - xmin) * i / 64, y) for i in range(65) for y in (ymin, ymax)]
    edge += [(x, ymin + (ymax - ymin) * i / 64) for i in range(65) for x in (xmin, xmax)]
    points = [inverse(x, y) for x, y in edge]
    return min(float(p[0]) for p in points), lat_min, max(float(p[0]) for p in points), max(float(p[1]) for p in points)


def cell_lonlat(res, cols, rows):
    """Lon/lat of every cell centre."""
    x = EXTENT[0] + (np.arange(cols) + .5) * res
    y = EXTENT[3] - (np.arange(rows) + .5) * res
    return inverse(x[None, :], y[:, None])


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
        '-of', 'ENVI', '-wm', '2048', '-multi', '-wo', 'NUM_THREADS=ALL_CPUS', vrt, out)
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


def land_fraction(shapes, work, name, res, cols, rows):
    """Share of each grid cell covered by the polygons of `shapes`, burned in turn."""
    fine = work / f'{name}.bin'
    for index, shape in enumerate(shapes):
        rasterize(shape, fine, res / LAND_SUBCELLS, layer='layer', create=index == 0)
    n = LAND_SUBCELLS
    mask = read_grid(fine, 'u1', cols * n, rows * n)
    return mask.reshape(rows, n, cols, n).mean(axis=(1, 3))


def build_land(args, work, res, cols, rows, bounds, lon, lat):
    """Share of each grid cell that is land: the OSM polygons inside their window, Natural Earth beyond it."""
    osm = work / 'osm.gpkg'
    reproject(args.land, osm, bounds, layer=args.land_layer)
    fraction = land_fraction([osm], work, 'osm', res, cols, rows)
    ne_land, ne_islands = work / 'ne_land.gpkg', work / 'ne_islands.gpkg'
    reproject(args.ne_land, ne_land, bounds)
    reproject(args.ne_islands, ne_islands, bounds)
    beyond = land_fraction([ne_land, ne_islands], work, 'ne', res, cols, rows)
    west, south, east, north = OSM_BBOX
    covered = (lon >= west) & (lon <= east) & (lat >= south) & (lat <= north)
    return np.where(covered, fraction, beyond), int((~covered).sum())


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


def cell_of(x, y, res):
    return int((x - EXTENT[0]) / res), int((EXTENT[3] - y) / res)


def geonames_rows(zip_path):
    """The tab-separated records of a GeoNames country dump (geonames.org, CC BY 4.0)."""
    with zipfile.ZipFile(zip_path) as archive:
        name = next(n for n in archive.namelist() if n.endswith('.txt') and n != 'readme.txt')
        with archive.open(name) as handle:
            for line in handle:
                yield line.decode('utf-8').rstrip('\n').split('\t')


def build_places(zips, water, res, cols, rows):
    """Settlements with a sea approach: GeoNames populated places on the grid with charted water within
    SEA_APPROACH cells. North of 55 N, in Nunavut, the Northwest Territories and Greenland every place counts;
    further south only places with a recorded population or an administrative seat, which keeps the southern
    coasts to their towns."""
    near_water = ndimage.binary_dilation(water, structure=np.ones((3, 3), bool), iterations=SEA_APPROACH) if SEA_APPROACH else water
    places, seen = [], set()
    for zip_path in zips:
        for r in geonames_rows(zip_path):
            if r[6] != 'P' or r[7] in SKIP_PLACE_CODES:
                continue
            lat, lon, code, admin = float(r[4]), float(r[5]), r[7], r[10]
            x, y = forward(lon, lat)
            if not inside(x, y):
                continue
            pop = int(r[14]) if r[14].isdigit() else 0
            north = r[8] == 'GL' or admin in ('13', '14') or lat >= 55
            if not (north or pop > 0 or code.startswith('PPLA') or code == 'PPLC'):
                continue
            col, row = cell_of(x, y, res)
            if not (0 <= col < cols and 0 <= row < rows) or not near_water[row, col]:
                continue
            key = (r[1], round(lon, 2), round(lat, 2))
            if key in seen:
                continue
            seen.add(key)
            places.append({'name': r[1], 'lon': round(lon, 4), 'lat': round(lat, 4), 'pop': pop})
    return sorted(places, key=lambda place: (place['name'], -place['pop']))


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


def clearance(land, limit):
    """Distance in cells from each water cell to the nearest land cell (BFS rings, capped at `limit`)."""
    dist = np.where(land, 0, 255).astype(np.uint8)
    for ring in range(1, limit + 1):
        near = np.zeros_like(land)
        reached = dist < ring
        near[1:, :] |= reached[:-1, :]
        near[:-1, :] |= reached[1:, :]
        near[:, 1:] |= reached[:, :-1]
        near[:, :-1] |= reached[:, 1:]
        dist[(dist == 255) & near] = ring
    return dist


def on_segment(x, y, a, b, tolerance):
    """Whether (x, y) lies within `tolerance` metres of the segment a-b."""
    (ax, ay), (bx, by) = a, b
    dx, dy = bx - ax, by - ay
    t = 0 if dx == dy == 0 else max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - ax - t * dx, y - ay - t * dy) <= tolerance


def pick_start(plan_path, land, res, cols, rows):
    """The starting position: START while it lies on the Leg 3 Plan A track with SEA_ROOM of water around it on
    this grid, otherwise the first point of that track with the sea room: the opening of the leg, clear of the pier."""
    plan = json.loads(Path(plan_path).read_text())
    room = clearance(land, math.ceil(SEA_ROOM / res) + 1)

    def clear(lon, lat):
        col, row = cell_of(*forward(lon, lat), res)
        return 0 <= col < cols and 0 <= row < rows and int(room[row, col]) * res >= SEA_ROOM

    for track in plan['tracks']:
        if track.get('alternate'):
            continue
        coords = track['coords']
        segments = [(forward(*a), forward(*b)) for a, b in zip(coords, coords[1:])]
        x, y = forward(*START)
        if clear(*START) and any(on_segment(x, y, a, b, res / 2) for a, b in segments):
            return {'lon': START[0], 'lat': START[1], 'plan': plan.get('name'), 'track': track.get('name')}
        for (lon0, lat0), (lon1, lat1) in zip(coords, coords[1:]):
            for step in range(20):
                lon, lat = lon0 + (lon1 - lon0) * step / 20, lat0 + (lat1 - lat0) * step / 20
                if clear(lon, lat):
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
    lon, lat = cell_lonlat(res, cols, rows)
    with tempfile.TemporaryDirectory(prefix='amundsen-world-', dir=args.tmp) as tmp:
        work = Path(tmp)
        print(f'grid {cols}x{rows} at {res} m; lon/lat window {[round(b, 2) for b in bounds]}', flush=True)
        elevation, gebco_tiles = build_elevation(args.gebco, work, res, cols, rows, bounds)
        print('elevation done', flush=True)
        fraction, beyond_osm = build_land(args, work, res, cols, rows, bounds, lon, lat)
        print('shore done', flush=True)
        glaciers = build_glaciers(www / 'static/geo/glaciated_areas.geojson', work, res, cols, rows, bounds)
        conc, cls, classes, chart_sources = build_ice(charts, work, res, cols, rows, bounds)
        print('ice done', flush=True)
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

    water = ~land
    track, track_span = build_track(www / 'data/w-1y.json', 8000)
    start = pick_start(www / 'data/plan.json', land, res, cols, rows)
    geonames = sorted(args.geonames.glob('[A-Z][A-Z].zip'))
    places = build_places(geonames, water, res, cols, rows)
    labels, count = ndimage.label(water)
    start_cell = cell_of(*forward(start['lon'], start['lat']), res)
    main_sea = labels == labels[start_cell[1], start_cell[0]]
    charted = water & (conc != 255)
    world = {
        'version': 1,
        'generated': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'generator': 'tools/pull_world.py',
        'projection': {'name': 'WGS84 polar stereographic, north', 'proj4': PROJ4, 'latTs': PROJ['lat_ts'],
                       'lon0': PROJ['lon_0'], 'a': PROJ['a'], 'f': PROJ['f']},
        'grid': {'cols': cols, 'rows': rows, 'resolution': res, 'xmin': EXTENT[0], 'ymin': EXTENT[1],
                 'xmax': EXTENT[2], 'ymax': EXTENT[3], 'origin': 'top-left cell first, rows run north to south',
                 'sector': 'longitude 0-180 W, latitude 50-90 N, the pole inside; the corners of the rectangle reach further south',
                 'lonLatWindow': [round(b, 3) for b in bounds]},
        'data': {'file': 'world.bin.gz', 'compression': 'gzip', 'bytes': len(packed), 'rawBytes': len(blob),
                 'sha256': hashlib.sha256(packed).hexdigest(), 'byteOrder': 'little-endian', 'layers': layers},
        'units': {'elevation': 'metres; land is >= 1, water is <= -2',
                  'iceConcentration': 'percent of the sea surface (CIS total concentration, tenths x 10); 255 = land or no chart',
                  'iceClass': 'index into ice.classes: stage of development and floe form of the dominant partial concentration',
                  'glacier': f'1 where Natural Earth maps glacier or ice cap over land, within longitude {OSM_BBOX[0]:.0f} to {OSM_BBOX[2]:.0f} only'},
        'ice': {'classes': classes, 'charts': [{k: c[k] for k in ('region', 'date', 'validTime', 'attribution')} for c in chart_sources]},
        'start': start,
        'places': places,
        'shipTrack': {'span': track_span, 'spacing': 8000, 'lonLat': track},
        'stats': {'landCells': int(land.sum()), 'waterCells': int(water.sum()), 'seaComponents': int(count),
                  'startSeaCells': int(main_sea.sum()), 'iceChartedWaterCells': int(charted.sum()),
                  'iceCells40': int((charted & (conc >= 40)).sum()), 'deepest': int(elevation.min()), 'highest': int(elevation.max()),
                  'cellsBeyondOsmShore': beyond_osm},
        'method': f'GEBCO 15 arc-second cells averaged onto the grid (gdalwarp -r average). Shore: OSM land polygons inside '
                  f'longitude {OSM_BBOX[0]:.0f} to {OSM_BBOX[2]:.0f}, latitude {OSM_BBOX[1]:.0f} to {OSM_BBOX[3]:.0f}, Natural Earth '
                  f'land and minor islands beyond, rasterised at {res // LAND_SUBCELLS} m; a cell is land when more than '
                  f'{LAND_FRACTION:.0%} of it is land. Ice: newest chart per region burned in region order; water polygons are 0, '
                  f'no-data polygons leave 255. Places: GeoNames populated places with water within {SEA_APPROACH} cells.',
        'sources': [
            {**source(args.gebco, 'GEBCO 2024 sub-ice topography and bathymetry, 15 arc-second GeoTIFF release'), 'tiles': gebco_tiles},
            {**source(args.land, 'OSM land polygons (shore inside the extract window)'), 'layer': args.land_layer, 'window': list(OSM_BBOX)},
            source(args.ne_land, 'Natural Earth 10 m land (shore beyond the OSM window)'),
            source(args.ne_islands, 'Natural Earth 10 m minor islands (shore beyond the OSM window)'),
            source(www / 'static/geo/glaciated_areas.geojson', 'Natural Earth glaciated areas'),
            *[{**source(path, 'GeoNames country dump, populated places (CC BY 4.0)'), 'country': path.stem} for path in geonames],
            source(www / 'data/w-1y.json', 'CCGS Amundsen underway track, past year'),
            source(www / 'data/plan.json', 'Leg 3 cruise plan (starting position)'),
            *[{k: v for k, v in c.items() if k not in ('attribution', 'validTime')} for c in chart_sources],
        ],
    }
    (args.output / 'world.json').write_text(json.dumps(world, indent=1, ensure_ascii=False) + '\n')
    print(f"world.bin.gz {len(packed) / 1e6:.2f} MB ({len(blob) / 1e6:.1f} MB raw); "
          f"{world['stats']['waterCells']} water cells ({world['stats']['startSeaCells']} joined to the start), "
          f"{world['stats']['iceCells40']} with ice >= 4/10; {len(places)} places; start {start['lon']}, {start['lat']}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--gebco', type=Path, default=Path('/data/gis/gebco/gebco_2024_sub_ice_topo_geotiff.zip'))
    parser.add_argument('--land', type=Path, default=Path('/data/gis/shoreline/arctic_coast.gpkg'))
    parser.add_argument('--land-layer', default='land')
    parser.add_argument('--ne-land', type=Path, default=Path('/data/gis/naturalearth/ne_10m_land.shp'))
    parser.add_argument('--ne-islands', type=Path, default=Path('/data/gis/naturalearth/ne_10m_minor_islands.shp'))
    parser.add_argument('--geonames', type=Path, default=Path('/data/gis/geonames'), help='folder of GeoNames country dumps (XX.zip)')
    parser.add_argument('--www', type=Path, default=Path('/data/underway_server/www'))
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'static/data/world')
    parser.add_argument('--resolution', type=int, default=3000, help='grid cell size in projected metres')
    parser.add_argument('--tmp', type=Path, default=None, help='scratch folder for the GDAL intermediates (default: the system temp)')
    pull(parser.parse_args())
