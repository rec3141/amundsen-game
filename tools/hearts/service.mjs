import { createSession, sessionApply, stdDeck, makeRng } from '@parlour/engine';
import { heartsGame, passDirectionFor, easyBot, mediumBot } from '@parlour/game-hearts';
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
const CREW = { capn: { name: "Cap'n Barnacle", policy: mediumBot }, doc: { name: 'Doc', policy: easyBot }, ada: { name: 'Ada', policy: mediumBot }, polly: { name: 'Polly', policy: easyBot } };
for (const room of Object.values(rooms)) room.aiPending = false;
function roster(room) { return room.players.map(p => p ? { name: p.name, crew: p.crew || null, online: !!p.crew || Date.now() - p.seen < 15000 } : null); }
function cardFace(card) { return `${({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' })[Number(card.slice(1))] || card.slice(1)}${({ C: '♣', D: '♦', S: '♠', H: '♥' })[card[0]] || ''}`; }
function publicContext(room) { const players = roster(room); return { game: 'Hearts', hand: room.hand,
  scoreboard: players.map((player, seat) => ({ player: player?.name, points: room.scores[seat] })),
  players, passing: room.session?.state.passing, heartsBroken: room.session?.state.heartsBroken,
  visiblePlays: (room.session?.state.plays || []).map(play => ({ seat: roster(room)[play.seat]?.name, card: cardFace(play.card) })),
  priorHands: (room.history || []).map(hand => ({ hand: hand.hand, results: players.map((player, seat) => ({ player: player?.name, points: hand.points[seat] })) })),
  chat: (room.chat || []).slice(-12) }; }
function tableAside(room) {
  const state = room.session?.state;
  const previous = room.asideHand === room.hand ? room.asideTrick || 0 : 0;
  const milestone = [3, 6, 9, 12].find(trick => state?.tricksPlayed >= trick && trick > previous);
  if (!state || room.aiPending || !milestone) return null;
  const speakers = room.players.filter(p => p?.crew).map(p => p.crew);
  if (!speakers.length) return null;
  const first = randomInt(speakers.length), second = speakers.length > 1 ? (first + 1 + randomInt(speakers.length - 1)) % speakers.length : first;
  room.asideHand = room.hand; room.asideTrick = milestone; room.aiPending = true; room.revision++; save();
  return { code: room.code, speakers: speakers.length > 1 ? [speakers[first], speakers[second]] : [speakers[first]], context: { ...publicContext(room), aside: true, factRequested: milestone === 9 } };
}
function sameMove(left, right) {
  if (!left || !right || left.id !== right.id) return false;
  if (left.id === 'playCard') return left.payload.card === right.payload.card;
  if (left.id === 'passCards') return [...left.payload.cards].sort().join() === [...right.payload.cards].sort().join();
  return true;
}
function trackDecision(room, seat, move, payload) {
  const legal = heartsGame.flow.legalMovesFor(room.session.state, room.session.phase, seat);
  const reference = mediumBot.chooseMove(heartsGame.playerView(room.session.state, seat), seat, legal,
    makeRng(1), { thinkMs: () => 100 });
  const actual = { id: move, payload };
  if (!legal.some(candidate => sameMove(candidate, actual))) return;
  if (!reference || !sameMove(reference, actual)) {
    room.learning ||= {};
    const profile = room.learning[seat] ||= { choices: 0, carefulChoices: 0 };
    profile.choices++;
    return;
  }
  room.learning ||= {};
  const profile = room.learning[seat] ||= { choices: 0, carefulChoices: 0 };
  profile.choices++; profile.carefulChoices++;
}
function crewPolicy(room, crew) {
  if (CREW[crew].policy !== easyBot) return CREW[crew].policy;
  const profiles = Object.values(room.learning || {});
  const choices = profiles.reduce((sum, profile) => sum + profile.choices, 0);
  const carefulChoices = profiles.reduce((sum, profile) => sum + profile.carefulChoices, 0);
  if (choices < 12) return easyBot;
  const carefulRate = (carefulChoices + 6) / (choices + 12);
  const carefulChance = Math.max(0.15, Math.min(0.75, (carefulRate - 0.2) / 0.7));
  return randomInt(1000) < carefulChance * 1000 ? mediumBot : easyBot;
}
function applyMove(room, seat, move, payload) {
  const outcome = sessionApply(heartsGame, room.session, seat, move, payload);
  if (outcome.rejected) fail(400, outcome.rejected.message);
  room.session = outcome.session;
  if (outcome.session.status === 'ended') {
    room.history ||= [];
    room.history.push({ hand: room.hand, tricks: outcome.session.state.tricksPlayed,
      heartsBroken: outcome.session.state.heartsBroken, points: outcome.session.state.handPoints,
      moonShooter: outcome.session.state.moonShooter });
    room.history = room.history.slice(-20);
    room.scores = room.scores.map((score, i) => score + outcome.session.state.handPoints[i]);
    room.finished = room.scores.some(score => score >= 100);
    room.ready = room.players.flatMap((p, i) => p?.crew ? [i] : []);
  }
}
function advanceCrew(room) {
  if (!room.session || room.session.status !== 'playing' || Date.now() < (room.nextBotAt || 0)) return;
  const seat = room.players.findIndex((p, i) => p?.crew && heartsGame.flow.legalMovesFor(room.session.state, room.session.phase, i).length);
  if (seat < 0) return;
  const legal = heartsGame.flow.legalMovesFor(room.session.state, room.session.phase, seat);
  const crew = room.players[seat].crew;
  const move = crewPolicy(room, crew).chooseMove(heartsGame.playerView(room.session.state, seat), seat, legal, makeRng(randomInt(0x100000000)), { thinkMs: () => 100 });
  if (!move) return;
  applyMove(room, seat, move.id, move.payload); room.nextBotAt = Date.now() + 900; room.revision++; save();
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
    players: roster(room), game: 'hearts', chat: room.chat || [], aiPending: !!room.aiPending,
    history: room.history || [],
    state, ready: room.ready, finished: room.finished,
    legal: session ? heartsGame.flow.legalMovesFor(session.state, session.phase, seat) : [] };
}
function handle(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'Expected a table request.');
  const { action } = data;
  const requestLocale = String(data.locale || '').toLowerCase() === 'fr-ca' ? 'fr-CA' : 'en';
  let room, seat, token;
  if (action === 'list') return { tables: Object.values(rooms).filter(r => Date.now() - r.touched < 86400000 && r.players.some(p => p && !p.crew)).map(r => ({
    id: r.code, game: 'hearts', name: `${r.players.find(p => p && !p.crew).name}'s table`,
    players: roster(r), openSeats: r.session ? 0 : r.players.filter(p => !p || p.crew).length,
    started: !!r.session, hand: r.hand,
  })), games: [{ id: 'hearts', title: 'Hearts' }] };
  // Crew replies arrive only through the Python server's internal worker path.
  if (action === 'crewReply') {
    room = rooms[data.code]; if (!room) return {};
    room.chat ||= [];
    if (data.text) room.chat.push({ name: data.name, text: data.text, crew: data.crew || null });
    room.chat = room.chat.slice(-40); room.aiPending = !data.done; room.revision++; save(); return {};
  }
  if (action === 'create' || action === 'join') {
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name || name.length > 40 || /[\x00-\x1f\x7f]/.test(name)) fail(400, 'Enter a name of up to 40 characters.');
    for (const [code, r] of Object.entries(rooms)) if (Date.now() - r.touched > 86400000) delete rooms[code];
    if (action === 'create') {
      if (data.game && data.game !== 'hearts') fail(400, 'This game is not aboard yet. Choose Hearts.');
      if (Object.keys(rooms).length >= 64) fail(429, 'All tables are occupied. Try again later.');
      let code;
      do { code = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(31)]).join(''); } while (rooms[code]);
      room = rooms[code] = { code, players: [null, null, null, null], revision: 0, hand: 1, locale: requestLocale,
        scores: [0, 0, 0, 0], ready: [], history: [], finished: false, touched: Date.now() };
    } else {
      room = rooms[String(data.code).toUpperCase()];
      if (!room) fail(404, 'That table has closed. Choose another table.');
      if (room.session) fail(409, 'This table has started. Rejoin from your original browser.');
    }
    seat = room.players.findIndex(p => !p || p.crew);
    if (seat < 0) fail(409, 'This table is full.');
    token = randomBytes(24).toString('hex');
    room.players[seat] = { name, token, seen: Date.now() };
  } else {
    room = rooms[data.code];
    if (!room) fail(404, 'Table not found. Create or join a table.');
    seat = room.players.findIndex(p => p && !p.crew && typeof data.token === 'string' && p.token === data.token);
    if (seat < 0) fail(403, 'Your seat could not be found. Join the table again.');
    room.locale = requestLocale;
    if (action === 'poll') {
      room.players[seat].seen = Date.now(); room.touched = Date.now();
      advanceCrew(room);
      const aiJob = tableAside(room);
      return { ...view(room, seat), ...(aiJob ? { aiJob } : {}) };
    }
    if (action === 'chat') {
      const text = typeof data.text === 'string' ? data.text.trim() : '';
      if (!text || text.length > 1000) fail(400, 'Write a message of up to 1000 characters.');
      if (room.aiPending) fail(409, 'The crew are answering. Give them a moment.');
      room.chat ||= []; room.chat.push({ name: room.players[seat].name, text }); room.chat = room.chat.slice(-40);
      const mentions = [...text.matchAll(/@(capn|doc|ada|polly|crew)\b/gi)].map(m => m[1].toLowerCase());
      const speakers = mentions.includes('crew') ? Object.keys(CREW) : mentions.length ? [...new Set(mentions)] : [room.players.find(p => p?.crew)?.crew || 'polly'];
      room.aiPending = true; room.revision++; save();
      return { ...view(room, seat), aiJob: { code: room.code, speakers,
        context: { ...publicContext(room), locale: requestLocale } } };
    }
    if (action === 'inviteCrew' || action === 'setCrew') {
      if (room.session) fail(409, 'Choose the crew before the deal.');
      if (action === 'inviteCrew') {
        const available = Object.keys(CREW).filter(id => !room.players.some(p => p?.crew === id));
        room.players = room.players.map(p => p || (() => { const crew = available.shift(); return { name: CREW[crew].name, crew }; })());
      } else {
        const target = data.seatIndex;
        if (!Number.isInteger(target) || target < 0 || target > 3 || (room.players[target] && !room.players[target].crew)) fail(400, 'Choose an empty or crew seat.');
        if (data.crew && (!Object.hasOwn(CREW, data.crew) || room.players.some(p => p?.crew === data.crew))) fail(400, 'Choose a crew member who is not already seated.');
        room.players[target] = data.crew ? { name: CREW[data.crew].name, crew: data.crew } : null;
      }
      room.revision++; save(); return view(room, seat);
    }
    const simultaneous = action === 'move' || action === 'ready';
    if (simultaneous && data.hand !== undefined && data.hand !== room.hand) fail(409, 'A new hand has started. Choose again.');
    if (data.revision !== room.revision && !simultaneous) fail(409, 'The table changed. Try your move again.');
    if (action === 'leave') {
      room.players[seat] = null; room.revision++; room.touched = Date.now();
      if (!room.players.some(p => p && !p.crew)) delete rooms[room.code];
      else if (room.session) {
        const crew = Object.keys(CREW).find(id => !room.players.some(p => p?.crew === id));
        room.players[seat] = { name: CREW[crew].name, crew };
      }
      save();
      return { left: true };
    }
    if (action === 'start') {
      if (room.session) fail(409, 'This match has already started.');
      if (room.players.some(p => !p)) fail(409, 'Four players are needed to deal.');
      deal(room);
    } else if (action === 'move') {
      if (!room.session || room.finished) fail(409, 'There is no hand in play.');
      trackDecision(room, seat, data.move, data.payload);
      applyMove(room, seat, data.move, data.payload);
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
