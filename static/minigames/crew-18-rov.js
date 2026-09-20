// Procedural dive geometry uses metres in a local frame: x across, y up, z along the hull.
// Archive positions and depths stay in the survey model; this explorable hull is generated scenery.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const ROV_KEYS = { w: 'forward', s: 'back', a: 'left', d: 'right', q: 'rise', e: 'sink', ArrowLeft: 'yawLeft', ArrowRight: 'yawRight', ArrowUp: 'lookUp', ArrowDown: 'lookDown', ' ': 'scan' };
export function createROV(kind) {
  const wreck = kind === 'wreck';
  return {
    kind, x: 0, y: 10, z: -36, yaw: 0, pitch: -0.18, speed: 0, silt: 0,
    remaining: 240, elapsed: 0, paused: false, ready: false, message: '',
    nodes: wreck ? [
      { name: 'Stern frames', x: 0, y: 3, z: -15 },
      { name: 'Port hull', x: -5, y: 3, z: 0 },
      { name: 'Bow frames', x: 0, y: 4, z: 15 },
      { name: 'Starboard hull', x: 5, y: 3, z: 0 },
    ].map(n => ({ ...n, progress: 0 })) : [{ name: 'Contact', x: 0, y: 2, z: 0, progress: 0 }],
  };
}
export function cameraPoint(r, p) {
  const dx = p.x - r.x, dy = p.y - r.y, dz = p.z - r.z;
  const side = dx * Math.cos(r.yaw) - dz * Math.sin(r.yaw);
  const forward = dx * Math.sin(r.yaw) + dz * Math.cos(r.yaw);
  return { x: side, y: dy * Math.cos(r.pitch) - forward * Math.sin(r.pitch), z: dy * Math.sin(r.pitch) + forward * Math.cos(r.pitch) };
}
// A segment crossing the hull volume cannot produce a camera scan through its planking.
function crossesHull(a, b, padding = 0) {
  let lo = 0, hi = 1;
  for (const [axis, min, max] of [['x', -4 - padding, 4 + padding], ['y', 0, 6 + padding], ['z', -14 - padding, 14 + padding]]) {
    const d = b[axis] - a[axis];
    if (Math.abs(d) < 1e-8) { if (a[axis] < min || a[axis] > max) return false; }
    else { const t1 = (min - a[axis]) / d, t2 = (max - a[axis]) / d; lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2)); if (lo > hi) return false; }
  }
  return hi > 0.01 && lo < 0.99;
}
export function scanTarget(r) {
  return r.nodes.find(n => {
    const p = cameraPoint(r, n), distance = Math.hypot(n.x - r.x, n.y - r.y, n.z - r.z);
    return n.progress < 1 && distance >= 3 && distance <= 13 && p.z > 0 && Math.hypot(p.x, p.y) / p.z < 0.19 && (r.kind !== 'wreck' || !crossesHull(r, n));
  });
}
export function advanceROV(r, controls, dt) {
  if (r.paused || r.ready || r.remaining <= 0) return;
  dt = clamp(dt, 0, 0.1);
  r.elapsed += dt; r.remaining = Math.max(0, r.remaining - dt);
  const axis = (a, b) => Number(controls.has(a)) - Number(controls.has(b));
  r.yaw += axis('yawRight', 'yawLeft') * dt * 0.85;
  r.pitch = clamp(r.pitch + axis('lookUp', 'lookDown') * dt * 0.65, -1.25, 1.25);
  const forward = axis('forward', 'back'), side = axis('right', 'left'), up = axis('rise', 'sink');
  const scale = 6 * dt / Math.max(1, Math.hypot(forward, side, up));
  const next = {
    x: clamp(r.x + (Math.sin(r.yaw) * forward + Math.cos(r.yaw) * side) * scale, -60, 60),
    y: clamp(r.y + up * scale, 1.5, 30),
    z: clamp(r.z + (Math.cos(r.yaw) * forward - Math.sin(r.yaw) * side) * scale, -60, 60),
  };
  const bump = r.kind === 'wreck' && crossesHull(r, next, 0.8);
  r.speed = dt ? Math.hypot(next.x - r.x, next.y - r.y, next.z - r.z) / dt : 0;
  if (!bump) Object.assign(r, next);
  r.silt = clamp(r.silt + (bump || (r.y < 3 && r.speed > 1) ? dt * 0.8 : -dt * 0.3), 0, 1);
  const target = scanTarget(r);
  r.message = bump ? 'Hull clearance — back away or rise.' : r.silt > 0.3 ? 'Sediment in the lights — rise and let it settle.' : r.speed > 0.5 ? 'Release thrusters to hold station.' : target ? `Hold Scan: ${target.name}` : 'Approach a marker to 3–13 m and centre it in the reticle.';
  if (controls.has('scan') && target && r.speed < 0.5 && r.silt <= 0.3) {
    target.progress = Math.min(1, target.progress + dt / 2.5);
    r.message = `Scanning ${target.name} · ${Math.round(target.progress * 100)}%`;
  }
  r.ready = r.nodes.every(n => n.progress >= 1);
  if (r.ready) r.message = r.kind === 'wreck' ? 'Four views recorded. Recover to log the wreck.' : `${r.kind === 'seabed' ? 'Bare sediment' : r.kind === 'scour' ? 'Iceberg scour' : r.kind === 'boulder' ? 'Boulder' : 'Rock outcrop'} recorded. Recover to resume the survey.`;
}

export function drawROV(ctx, r, width, height) {
  const focal = Math.min(width, height) * 0.85;
  const project = p => ({ x: width / 2 + p.x / p.z * focal, y: height / 2 - p.y / p.z * focal });
  const grad = ctx.createLinearGradient(0, 0, 0, height); grad.addColorStop(0, '#03141f'); grad.addColorStop(1, '#214b51');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, width, height);
  function line(a, b, colour = '#89a7a0', weight = 1) {
    let p = cameraPoint(r, a), q = cameraPoint(r, b);
    if (p.z < 0.3 && q.z < 0.3) return;
    if (p.z < 0.3 || q.z < 0.3) {
      if (p.z > q.z) [p, q] = [q, p];
      const t = (0.3 - p.z) / (q.z - p.z); p = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: 0.3 };
    }
    const a2 = project(p), b2 = project(q);
    ctx.globalAlpha = clamp(1 - (p.z + q.z) / 190, 0.12, 0.95);
    ctx.strokeStyle = colour; ctx.lineWidth = weight; ctx.beginPath(); ctx.moveTo(a2.x, a2.y); ctx.lineTo(b2.x, b2.y); ctx.stroke(); ctx.globalAlpha = 1;
  }
  for (let i = -60; i <= 60; i += 5) {
    line({ x: i, y: 0, z: -60 }, { x: i, y: 0, z: 60 }, '#39666b');
    line({ x: -60, y: 0, z: i }, { x: 60, y: 0, z: i }, '#39666b');
  }
  if (r.kind === 'wreck') {
    // Hull panels are depth-sorted in camera space; the frame edges remain visible in the lights.
    const faces = [], section = z => { const beam = 4 * (1 - Math.pow(Math.abs(z) / 19, 4)); return [{ x: -beam, y: 5, z }, { x: -beam * 0.7, y: 1, z }, { x: beam * 0.7, y: 1, z }, { x: beam, y: 5, z }]; };
    for (let z = -16; z < 16; z += 4) {
      const a = section(z), b = section(z + 4);
      for (let j = 0; j < 3; j++) faces.push([a[j], a[j + 1], b[j + 1], b[j]]);
    }
    faces.sort((a, b) => b.reduce((s, p) => s + cameraPoint(r, p).z, 0) - a.reduce((s, p) => s + cameraPoint(r, p).z, 0));
    for (const face of faces) {
      const ps = face.map(p => cameraPoint(r, p));
      if (ps.every(p => p.z > 0.3)) { ctx.fillStyle = '#384c48'; ctx.beginPath(); ps.map(project).forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.fill(); }
      face.forEach((p, i) => line(p, face[(i + 1) % face.length], '#b8b698', 2));
    }
    for (let z = -12; z <= 12; z += 4) line({ x: -4, y: 5, z }, { x: 4, y: 5, z }, '#858d78', 2);
    line({ x: 0, y: 2, z: 2 }, { x: 2, y: 11, z: 5 }, '#c0b392', 4);
  } else {
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8, b = (i + 1) * Math.PI / 8, radius = r.kind === 'scour' ? 10 : r.kind === 'seabed' ? 2 : 5;
      const p = { x: Math.cos(a) * radius, y: 0.2, z: Math.sin(a) * radius };
      line(p, { x: Math.cos(b) * radius, y: 0.2, z: Math.sin(b) * radius }, '#abb49b', 2);
      if (r.kind === 'boulder' || r.kind === 'outcrop') line(p, { x: 0, y: 5, z: 0 }, '#abb49b', 2);
    }
  }
  for (const n of r.nodes) {
    const p = cameraPoint(r, n);
    if (p.z <= 0.3 || (r.kind === 'wreck' && crossesHull(r, n))) continue;
    const v = project(p), done = n.progress >= 1;
    ctx.strokeStyle = done ? '#85e4b6' : '#ffd27a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(v.x, v.y, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle; ctx.font = '11px system-ui'; ctx.fillText(done ? '✓' : n.name, v.x + 13, v.y + 4);
    if (n.progress > 0) { ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(v.x, v.y, 13, -Math.PI / 2, -Math.PI / 2 + n.progress * Math.PI * 2); ctx.stroke(); }
  }
  ctx.fillStyle = `rgba(140,125,88,${r.silt * 0.65})`; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#e0f5ed'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(width / 2, height / 2, 12, 0, Math.PI * 2); ctx.moveTo(width / 2 - 20, height / 2); ctx.lineTo(width / 2 + 20, height / 2); ctx.stroke();
  // Local plan view keeps the hull and vehicle legible when the camera faces open water.
  const mx = width - 64, my = height - 65, scale = 0.7;
  ctx.fillStyle = '#021822dd'; ctx.fillRect(width - 126, height - 128, 120, 122);
  ctx.strokeStyle = '#577b7d'; ctx.strokeRect(mx - 4 * scale, my - 16 * scale, 8 * scale, 32 * scale);
  for (const n of r.nodes) { ctx.fillStyle = n.progress >= 1 ? '#85e4b6' : '#ffd27a'; ctx.fillRect(mx + n.x * scale - 2, my - n.z * scale - 2, 4, 4); }
  ctx.fillStyle = '#ff9277'; const px = mx + r.x * scale, py = my - r.z * scale;
  ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#ff9277'; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.sin(r.yaw) * 10, py - Math.cos(r.yaw) * 10); ctx.stroke();
  ctx.fillStyle = '#d6eeeb'; ctx.font = '11px system-ui'; ctx.fillText('LOCAL PLAN · 120 m', width - 120, height - 113);
  ctx.fillStyle = '#03141fcc'; ctx.fillRect(0, 0, width, 51);
  ctx.fillStyle = '#d6eeeb'; ctx.font = '12px system-ui';
  ctx.fillText(`ROV · altitude ${r.y.toFixed(1)} m · ${r.speed.toFixed(1)} m/s`, 10, 20);
  ctx.fillText(`${r.nodes.filter(n => n.progress >= 1).length}/${r.nodes.length} views · ${Math.ceil(r.remaining)}s bottom window`, 10, 39);
  if (r.paused) { ctx.fillStyle = '#03141fbb'; ctx.fillRect(0, 51, width, height - 51); ctx.fillStyle = '#fff'; ctx.font = '20px system-ui'; ctx.fillText('Dive paused', 20, height / 2 - 30); }
}
