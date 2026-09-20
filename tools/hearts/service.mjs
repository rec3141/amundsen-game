import { createSession, sessionApply, stdDeck } from '@parlour/engine';
import { heartsGame, passDirectionFor } from '@parlour/game-hearts';
import { randomBytes, randomInt } from 'node:crypto';
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// The ship server owns the deal; clients receive only their seat's view and legal moves.
const file = process.env.AMUNDSEN_HEARTS_DB;
let rooms = {};
if (file) {
  try { rooms = JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
function save() {
  if (!file) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file + '.tmp', JSON.stringify(rooms), { mode: 0o600 });
  renameSync(file + '.tmp', file);
}
function deal(room) {
  // The deck uses server-only cryptographic randomness rather than a recoverable seed.
  const deck = [...stdDeck().cardIds];
  for (let i = deck.length - 1; i > 0; i--) { const j = randomInt(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  const session = createSession(heartsGame, { seed: randomInt(0x100000000), seats: 4,
    deckOrder: deck, config: { passDirection: passDirectionFor(room.hand - 1, true) } });
  room.session = session;
  room.ready = [];
}
function view(room, seat) {
  const session = room.session;
  const state = session ? heartsGame.playerView(session.state, seat) : null;
  return { code: room.code, seat, revision: room.revision, hand: room.hand, scores: room.scores,
    players: room.players.map(p => p ? { name: p.name, online: Date.now() - p.seen < 15000 } : null),
    state, ready: room.ready, finished: room.finished,
    legal: session ? heartsGame.flow.legalMovesFor(session.state, session.phase, seat) : [] };
}
function handle(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'Expected a table request.');
  const { action } = data;
  let room, seat, token;
  if (action === 'create' || action === 'join') {
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name || name.length > 40 || /[\x00-\x1f\x7f]/.test(name)) fail(400, 'Enter a name of up to 40 characters.');
    for (const [code, r] of Object.entries(rooms)) if (Date.now() - r.touched > 86400000) delete rooms[code];
    if (action === 'create') {
      if (Object.keys(rooms).length >= 64) fail(429, 'All tables are occupied. Try again later.');
      let code;
      do { code = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(31)]).join(''); } while (rooms[code]);
      room = rooms[code] = { code, players: [null, null, null, null], revision: 0, hand: 1,
        scores: [0, 0, 0, 0], ready: [], finished: false, touched: Date.now() };
    } else {
      room = rooms[String(data.code).toUpperCase()];
      if (!room) fail(404, 'Table not found. Check the code or create a table.');
      if (room.session) fail(409, 'This table has started. Rejoin from your original browser.');
    }
    seat = room.players.indexOf(null);
    if (seat < 0) fail(409, 'This table is full.');
    token = randomBytes(24).toString('hex');
    room.players[seat] = { name, token, seen: Date.now() };
  } else {
    room = rooms[data.code];
    if (!room) fail(404, 'Table not found. Create or join a table.');
    seat = room.players.findIndex(p => p && p.token === data.token);
    if (seat < 0) fail(403, 'Your seat could not be found. Join the table again.');
    if (action === 'poll') {
      room.players[seat].seen = Date.now(); room.touched = Date.now();
      return view(room, seat);
    }
    const simultaneous = (action === 'move' && data.move === 'passCards' && room.session?.state.passing) || action === 'ready';
    if (data.revision !== room.revision && !simultaneous) fail(409, 'The table changed. Try your move again.');
    if (action === 'leave') {
      if (room.session) fail(409, 'Your seat is reserved until this match ends. Close the table and return to resume.');
      room.players[seat] = null; room.revision++; room.touched = Date.now(); save();
      return { left: true };
    }
    if (action === 'start') {
      if (room.session) fail(409, 'This match has already started.');
      if (room.players.some(p => !p)) fail(409, 'Four players are needed to deal.');
      deal(room);
    } else if (action === 'move') {
      if (!room.session || room.finished) fail(409, 'There is no hand in play.');
      const outcome = sessionApply(heartsGame, room.session, seat, data.move, data.payload);
      if (outcome.rejected) fail(400, outcome.rejected.message);
      room.session = outcome.session;
      if (outcome.session.status === 'ended') {
        room.scores = room.scores.map((score, i) => score + outcome.session.state.handPoints[i]);
        room.finished = room.scores.some(score => score >= 100);
      }
    } else if (action === 'ready') {
      if (room.session?.status !== 'ended') fail(409, 'Finish this hand first.');
      if (!room.ready.includes(seat)) room.ready.push(seat);
      if (room.ready.length === 4) {
        if (room.finished) { room.hand = 1; room.scores = [0, 0, 0, 0]; room.finished = false; }
        else room.hand++;
        deal(room);
      }
    } else fail(400, 'Unknown table action.');
  }
  room.revision++; room.touched = Date.now();
  save();
  return { ...view(room, seat), ...(token ? { token } : {}) };
}
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  try { const data = JSON.parse(line); process.stdout.write(JSON.stringify({ status: 200, body: handle(data) }) + '\n'); }
  catch (error) { process.stdout.write(JSON.stringify({ status: error.status || 500,
    body: { error: error.status ? error.message : 'The table could not complete that request.' } }) + '\n');
    if (!error.status) console.error(error); }
});
