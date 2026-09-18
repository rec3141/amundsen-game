const stylesheet = new URL('./crew-18.css', import.meta.url);
const archive = new URL('../data/crew-18-wrecks.json', import.meta.url);
const moves = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };

export const game = {
  title: 'Shipwrecks',
  mount(root, { complete }) {
    const events = new AbortController();
    let alive = true, submitted = false, sites = [], results = [], current = null, score = 0;
    let x = 0, y = 0, target = 0, supply = 65, scans = [], visited = new Set(), message = '';
    const previousFocus = document.activeElement;
    root.innerHTML = `<section class="c18" tabindex="-1" aria-label="Shipwrecks">
      <link rel="stylesheet" href="${stylesheet.href}">
      <header><div><p class="c18-eyebrow">AMUNDSEN / HISTORICAL SURVEY</p><h2>Shipwrecks</h2></div><strong data-score>0 points</strong></header>
      <p>Follow the archive into three Arctic wreck sites. Triangulate a hull, lower the ROV, and add the discovery to your chart.</p>
      <div data-loading role="status">Opening the ship’s archive…</div>
      <div data-content hidden>
        <div class="c18-layout"><aside><h3>Archive chart</h3>
          <svg data-atlas viewBox="0 0 300 155" role="img" aria-label="Regional wreck positions, longitude horizontal and latitude vertical"></svg>
          <p class="c18-small">Regional archive positions · °N / °W</p><div class="c18-sites" data-sites></div>
          <p class="c18-small">Historical records: Underway shipboard archive. Positions retain the archive’s regional precision.</p>
        </aside><div><h3 data-title>Select a wreck region</h3><p data-location></p>
          <div class="c18-grid" data-grid role="group" aria-label="Generated sonar search grid"></div>
          <p class="c18-small">Generated search grid · north ↑ · ◆ ship · · visited · ≋ sonar fix · ⚑ hull</p>
          <p data-meter></p><p data-status role="status" aria-live="polite"></p>
          <div class="c18-controls" data-controls>
            <div class="c18-pad"><button type="button" data-action="up" aria-label="Move north">↑</button><button type="button" data-action="left" aria-label="Move west">←</button><button type="button" data-action="down" aria-label="Move south">↓</button><button type="button" data-action="right" aria-label="Move east">→</button></div>
            <button type="button" data-action="ping">Ping [P] · 4</button><button type="button" data-action="rov">Lower ROV [Space] · 6</button><button type="button" data-action="leave">End site [N]</button>
          </div>
          <p class="c18-small">Arrows / WASD: move (1 supply). Ping gives distance in grid steps: east–west plus north–south. Take fixes from two different cells, then lower the ROV directly over the hull. Each site has 65 supply.</p>
          <ol class="c18-fixes" data-fixes aria-label="Sonar fixes"></ol>
        </div></div>
        <section class="c18-log"><h3>Discovery log</h3><div data-log>No hulls charted yet.</div></section>
        <div class="c18-end"><button type="button" data-action="finish">Bank expedition [F]</button><button type="button" data-action="replay">New expedition [R]</button></div>
        <p class="c18-small">A hull earns 100 points, plus twice its remaining supply. Banking ends this expedition.</p>
      </div></section>`;
    const panel = root.querySelector('.c18');
    const find = selector => panel.querySelector(selector);
    panel.focus();

    function reset() {
      results = []; current = null; score = 0; message = 'Choose a region with its button or keys 1–3.';
      find('[data-log]').textContent = 'No hulls charted yet.';
      draw();
    }
    function start(index) {
      if (current !== null || results.some(r => r.index === index) || !sites[index]) return;
      current = index; x = 0; y = 0; target = 1 + Math.floor(Math.random() * 63);
      supply = 65; scans = []; visited = new Set([0]);
      message = 'The towfish is ready. Take a first fix, move, and compare a second range.';
      draw();
    }
    function endSite(found) {
      const site = sites[current];
      const points = found ? 100 + supply * 2 : 0;
      results.push({ index: current, ship: site.ship, found, points, supply });
      score += points;
      const entry = document.createElement('p');
      entry.textContent = found ? `${site.ship} — charted, +${points}. ${site.story}` : `${site.ship} — survey incomplete. ${site.place} remains in the archive.`;
      if (results.length === 1) find('[data-log]').textContent = '';
      find('[data-log]').append(entry);
      message = found ? `${site.ship} identified. ${site.story}` : 'Survey ended. Choose another region or bank the expedition.';
      current = null;
      if (results.length === sites.length) message += ' Expedition complete. Bank your points or start a new expedition.';
    }
    function act(action) {
      if (!alive || submitted || !sites.length) return;
      if (action === 'finish') {
        submitted = true;
        const detail = { title: 'Shipwrecks', charted: results.filter(r => r.found).length, sites: results.map(r => ({ ...r })), unfinishedSite: current === null ? null : sites[current].ship };
        panel.querySelectorAll('button').forEach(b => { b.disabled = true; });
        find('[data-status]').textContent = `Expedition banked: ${score} points.`;
        complete(score, detail);
        return;
      }
      if (action === 'replay') { reset(); return; }
      if (action.startsWith('site-')) { start(Number(action.slice(5))); return; }
      if (current === null) return;
      const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[action];
      const cost = delta ? 1 : action === 'ping' ? 4 : action === 'rov' ? 6 : 0;
      if (cost > supply) { message = 'Supply too low for that action. Move, end this site, or bank your expedition.'; draw(); return; }
      if (delta) {
        const nx = x + delta[0], ny = y + delta[1];
        if (nx < 0 || nx > 7 || ny < 0 || ny > 7) return;
        x = nx; y = ny; supply--; visited.add(y * 8 + x);
        message = 'Towfish moved. Compare the range rings on the chart.';
      } else if (action === 'ping') {
        if (scans.some(s => s.x === x && s.y === y)) { message = 'This fix is already logged. Move to a different cell for another bearing on the hull.'; draw(); return; }
        supply -= cost;
        const range = Math.abs(x - target % 8) + Math.abs(y - Math.floor(target / 8));
        scans.push({ x, y, range });
        message = `Fix ${scans.length}: hull echo ${range} grid steps away. Bright cells fit every logged range.`;
      } else if (action === 'rov') {
        if (scans.length < 2) { message = 'Log sonar fixes from two different cells before deploying the ROV.'; draw(); return; }
        supply -= cost;
        if (y * 8 + x === target) { endSite(true); draw(); return; }
        message = 'The ROV sees sediment. The hull is elsewhere; compare your sonar fixes.';
      } else if (action === 'leave') { endSite(false); draw(); return; }
      if (supply === 0) endSite(false);
      draw();
    }
    function draw() {
      const active = current !== null;
      find('[data-score]').textContent = `${score} points · ${results.filter(r => r.found).length}/3 hulls`;
      find('[data-title]').textContent = active ? sites[current].place : 'Choose your next region';
      find('[data-location]').textContent = active ? `${sites[current].lat.toFixed(2)}°N, ${Math.abs(sites[current].lon).toFixed(2)}°W · regional archive position` : '1–3: select region. Each survey opens a fresh search grid.';
      find('[data-status]').textContent = message;
      find('[data-meter]').textContent = active ? `${supply} supply · vessel at ${String.fromCharCode(65 + x)}${y + 1} · ${scans.length} sonar fixes` : `${results.length}/3 regions surveyed`;
      find('[data-sites]').replaceChildren(...sites.map((site, i) => {
        const b = document.createElement('button'); b.type = 'button'; b.dataset.action = `site-${i}`;
        const done = results.find(r => r.index === i);
        b.textContent = `${i + 1}. ${site.ship}${done ? done.found ? ' ⚑' : ' — surveyed' : ''}`;
        b.disabled = active || !!done; return b;
      }));
      find('[data-grid]').replaceChildren(...Array.from({ length: 64 }, (_, i) => {
        const cell = document.createElement('span'), cx = i % 8, cy = Math.floor(i / 8);
        const possible = active && scans.length > 0 && scans.every(s => Math.abs(s.x - cx) + Math.abs(s.y - cy) === s.range);
        const fix = active && scans.some(s => s.x === cx && s.y === cy);
        cell.className = possible ? 'c18-possible' : '';
        cell.textContent = active && cx === x && cy === y ? '◆' : fix ? '≋' : active && visited.has(i) ? '·' : '';
        cell.setAttribute('aria-label', `${String.fromCharCode(65 + cx)}${cy + 1}${possible ? ', possible hull' : ''}${active && cx === x && cy === y ? ', ship' : ''}`);
        return cell;
      }));
      find('[data-fixes]').replaceChildren(...(active ? scans : []).map(s => {
        const li = document.createElement('li'); li.textContent = `${String.fromCharCode(65 + s.x)}${s.y + 1}: ${s.range} steps`; return li;
      }));
      find('[data-controls]').querySelectorAll('button').forEach(b => { b.disabled = !active; });
      find('[data-atlas]').innerHTML = `<path d="M30 10V130H290 M30 70H290 M160 10V130" fill="none" stroke="#456574"/><text x="0" y="18">76°N</text><text x="0" y="130">67°N</text><text x="30" y="149">120°W</text><text x="235" y="149">95°W</text>${sites.map((s, i) => `<circle cx="${30 + (s.lon + 120) * 10}" cy="${10 + (76 - s.lat) * 13}" r="5" fill="${results.some(r => r.index === i && r.found) ? '#f5c46d' : '#9ae3da'}"/><text x="${40 + (s.lon + 120) * 10}" y="${14 + (76 - s.lat) * 13}">${i + 1}</text>`).join('')}`;
    }
    panel.addEventListener('click', event => {
      const button = event.target.closest('button[data-action]');
      if (button && panel.contains(button)) act(button.dataset.action);
    }, { signal: events.signal });
    window.addEventListener('keydown', event => {
      if (!alive || submitted || event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const delta = moves[key];
      const action = delta ? delta[0] < 0 ? 'left' : delta[0] > 0 ? 'right' : delta[1] < 0 ? 'up' : 'down' : { p: 'ping', ' ': 'rov', n: 'leave', f: 'finish', r: 'replay', 1: 'site-0', 2: 'site-1', 3: 'site-2' }[key];
      if (!action) return;
      // Space retains native activation when a control has keyboard focus.
      if (key === ' ' && event.target.closest?.('button')) { event.stopPropagation(); return; }
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) act(action);
    }, { capture: true, signal: events.signal });
    fetch(archive, { signal: events.signal }).then(response => {
      if (!response.ok) throw new Error('Archive unavailable');
      return response.json();
    }).then(data => {
      if (!alive) return;
      if (!Array.isArray(data.sites) || data.sites.length !== 3 || data.sites.some(s => typeof s.ship !== 'string' || typeof s.place !== 'string' || typeof s.story !== 'string' || !Number.isFinite(s.lat) || !Number.isFinite(s.lon))) throw new Error('Archive incomplete');
      sites = data.sites;
      find('[data-loading]').hidden = true; find('[data-content]').hidden = false;
      reset();
    }).catch(error => {
      if (alive && error.name !== 'AbortError') find('[data-loading]').textContent = 'The wreck archive could not be opened. Close and reopen Shipwrecks to retry.';
    });
    return () => {
      alive = false; events.abort(); panel.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  },
};
