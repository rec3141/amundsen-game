// ../../vendor/parlour/engine/src/types.ts
function rngSeedFrom(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function createFx() {
  const events = [];
  return {
    events,
    emit(kind, payload, at) {
      events.push(at === void 0 ? { kind, payload } : { kind, payload, at });
    }
  };
}
var Fx = {
  DealCard: "card.fly",
  // {card, from:'stock'|'discard', to:`hand:${seat}`, dur}
  DrawCard: "card.draw",
  // {card, seat, from:'stock'|'discard'}
  DiscardCard: "card.discard",
  // {card, seat, to:'discard'}
  FlipCard: "card.flip",
  // {card, seat|'discard'}
  ShuffleStock: "stock.shuffle",
  // {}
  TurnRing: "turn.ring",
  // {seat}
  Knock: "burst.knock",
  // {seat}
  Blitz: "burst.blitz",
  // {seat, handValue}
  ChipLoss: "chip.loss",
  // {seat, livesLeft}
  ShowdownReveal: "showdown.reveal",
  // {seat, handValue}
  RoundEnd: "round.end"
  // {reason}
};
function actingSeats(phase) {
  if (phase.actors && phase.actors.length > 0) return phase.actors;
  return phase.actor === null ? [] : [phase.actor];
}
function isActingSeat(phase, seat) {
  return actingSeats(phase).includes(seat);
}
function stdDeck() {
  const suits = ["S", "H", "D", "C"];
  const suitNames = {
    S: "spades",
    H: "hearts",
    D: "diamonds",
    C: "clubs"
  };
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const cardIds = [];
  const faces = {};
  for (const s of suits) {
    for (let r = 0; r < ranks.length; r++) {
      const id = `${s}${r + 1}`;
      cardIds.push(id);
      faces[id] = {
        label: `${ranks[r]}${s}`,
        short: String(ranks[r]),
        suit: suitNames[s],
        rank: r + 1,
        color: s === "H" || s === "D" ? "red" : "black"
      };
    }
  }
  return { id: "std-52", cardIds, faces };
}
function defineGameCatalog(entry) {
  return entry;
}

// ../../vendor/parlour/engine/src/zones.ts
function shuffledIds(deck, rng) {
  return rng.shuffle(deck.cardIds);
}
function stableCardOrder(cards, compare) {
  return cards.map((card, index) => ({ card, index })).sort((left, right) => compare(left.card, right.card) || left.index - right.index).map(({ card }) => card);
}

// ../../vendor/parlour/engine/src/veil.ts
var VEIL_HANDLE_PREFIX = "v#";
function isVeilHandle(value) {
  return typeof value === "string" && value.startsWith(VEIL_HANDLE_PREFIX);
}
function veilHandleIndex(value) {
  if (!isVeilHandle(value)) return null;
  const raw = value.slice(VEIL_HANDLE_PREFIX.length);
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) return null;
  return Number(raw);
}
function substituteCardIds(value, mapping) {
  if (mapping.size === 0) return value;
  return substitute(value, mapping);
}
function substitute(value, mapping) {
  if (typeof value === "string") return mapping.get(value) ?? value;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    let changed2 = false;
    const next2 = value.map((entry) => {
      const mapped = substitute(entry, mapping);
      if (mapped !== entry) changed2 = true;
      return mapped;
    });
    return changed2 ? next2 : value;
  }
  const source = value;
  let changed = false;
  const next = {};
  for (const [key, entry] of Object.entries(source)) {
    const mapped = substitute(entry, mapping);
    if (mapped !== entry) changed = true;
    next[key] = mapped;
  }
  return changed ? next : value;
}
function stateContainsCardId(value, id) {
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string") {
      if (current === id) return true;
      continue;
    }
    if (current === null || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      for (const entry of current) pending.push(entry);
      continue;
    }
    for (const entry of Object.values(current)) pending.push(entry);
  }
  return false;
}
function revealError(code, message) {
  return { code, message };
}
function validateReveals(state, reveals) {
  const handles = /* @__PURE__ */ new Set();
  const cards = /* @__PURE__ */ new Set();
  for (const reveal of reveals) {
    if (!Array.isArray(reveal) || reveal.length !== 2) {
      return revealError("bad-reveal", "each reveal must be a [handle, card] pair");
    }
    const [handle2, card] = reveal;
    if (typeof handle2 !== "string" || typeof card !== "string" || card.length === 0) {
      return revealError("bad-reveal", "reveal entries must be card ids");
    }
    if (veilHandleIndex(handle2) === null) {
      return revealError("not-a-handle", `${handle2} is not a veil handle`);
    }
    if (isVeilHandle(card)) {
      return revealError("reveal-to-handle", `${handle2} cannot be opened to another handle`);
    }
    if (handles.has(handle2)) {
      return revealError("duplicate-reveal", `${handle2} is opened twice in one move`);
    }
    if (cards.has(card)) {
      return revealError("duplicate-card", `${card} is revealed twice in one move`);
    }
    if (!stateContainsCardId(state, handle2)) {
      return revealError("unknown-handle", `${handle2} is not in play`);
    }
    if (stateContainsCardId(state, card)) {
      return revealError("card-already-open", `${card} is already visible at the table`);
    }
    handles.add(handle2);
    cards.add(card);
  }
  return null;
}
function applyReveals(state, reveals) {
  if (reveals.length === 0) return state;
  return substituteCardIds(state, new Map(reveals));
}
function validateRecycle(state, recycle, minHandleIndex = 0) {
  const { retire, issue } = recycle;
  if (!Array.isArray(retire) || !Array.isArray(issue)) {
    return revealError("bad-recycle", "a recycle needs a retire list and an issue list");
  }
  if (retire.length === 0) {
    return revealError("empty-recycle", "a recycle must retire at least one card");
  }
  if (retire.length !== issue.length) {
    return revealError(
      "recycle-not-conserved",
      `retiring ${retire.length} cards cannot issue ${issue.length} handles`
    );
  }
  const seenCards = /* @__PURE__ */ new Set();
  for (const card of retire) {
    if (typeof card !== "string" || card.length === 0 || isVeilHandle(card)) {
      return revealError("bad-recycle", `${String(card)} is not a public card`);
    }
    if (seenCards.has(card)) {
      return revealError("duplicate-retire", `${card} is retired twice`);
    }
    if (!stateContainsCardId(state, card)) {
      return revealError("unknown-card", `${card} is not in play`);
    }
    seenCards.add(card);
  }
  const seenHandles = /* @__PURE__ */ new Set();
  for (const handle2 of issue) {
    const index = veilHandleIndex(handle2);
    if (index === null) {
      return revealError("not-a-handle", `${String(handle2)} is not a veil handle`);
    }
    if (index < minHandleIndex) {
      return revealError(
        "stale-handle",
        `${handle2} reuses a handle from an earlier deck epoch (need index \u2265 ${minHandleIndex})`
      );
    }
    if (seenHandles.has(handle2)) {
      return revealError("duplicate-handle", `${handle2} is issued twice`);
    }
    if (stateContainsCardId(state, handle2)) {
      return revealError("handle-in-use", `${handle2} is already in play`);
    }
    seenHandles.add(handle2);
  }
  return null;
}
function recycleSettled(state, recycle) {
  for (const card of recycle.retire) {
    if (stateContainsCardId(state, card)) {
      return revealError("retire-not-applied", `${card} is still on the table after the recycle`);
    }
  }
  for (const handle2 of recycle.issue) {
    if (!stateContainsCardId(state, handle2)) {
      return revealError("issue-not-applied", `${handle2} never reached the table`);
    }
  }
  return null;
}
function dealOrder(ctx, deck) {
  if (!ctx.deckOrder) return shuffledIds(deck, ctx.rng);
  if (ctx.deckOrder.length !== deck.cardIds.length) {
    throw new Error(
      `veiled deck order has ${ctx.deckOrder.length} entries, expected ${deck.cardIds.length}`
    );
  }
  return [...ctx.deckOrder];
}
function resolveDeck(pack, config) {
  return typeof pack.deck === "function" ? pack.deck(config) : pack.deck;
}
function veilSupport(pack) {
  const mode = pack.publicSetup ?? "none";
  return {
    deck: (config) => resolveDeck(pack, config),
    redealMove: pack.redealMove,
    publicOpens: pack.publicOpens,
    selfOpens: pack.selfOpens,
    publicSetupFrom(seats, config) {
      if (mode === "none") return resolveDeck(pack, config).cardIds.length;
      const size = typeof pack.handSize === "function" ? pack.handSize(config, seats) : pack.handSize ?? 0;
      return seats * size;
    },
    publicSetupReady(opened, _seats, config) {
      if (mode === "none") return opened.length === 0;
      if (mode === "one") return opened.length === 1;
      return mode(opened, config);
    }
  };
}

// ../../vendor/parlour/engine/src/seats.ts
function advanceSeat(from, seats, steps = 1, direction = 1) {
  if (!Number.isInteger(seats) || seats < 1) {
    throw new Error(`seat ring requires a positive seat count, got ${seats}`);
  }
  const offset = direction * steps;
  return ((from + offset) % seats + seats) % seats;
}

// ../../vendor/pure-rand/src/generator/LinearCongruential.ts
var MULTIPLIER = 214013;
var INCREMENT = 2531011;
var MASK = 4294967295;
var MASK_2 = (1 << 31) - 1;
var computeNextSeed = function(seed) {
  return seed * MULTIPLIER + INCREMENT & MASK;
};
var computeValueFromNextSeed = function(nextseed) {
  return (nextseed & MASK_2) >> 16;
};
var LinearCongruential32 = class _LinearCongruential32 {
  constructor(seed) {
    this.seed = seed;
  }
  clone() {
    return new _LinearCongruential32(this.seed);
  }
  next() {
    const nextRng = new _LinearCongruential32(this.seed);
    const out = nextRng.unsafeNext();
    return [out, nextRng];
  }
  unsafeNext() {
    const s1 = computeNextSeed(this.seed);
    const v1 = computeValueFromNextSeed(s1);
    const s2 = computeNextSeed(s1);
    const v2 = computeValueFromNextSeed(s2);
    this.seed = computeNextSeed(s2);
    const v3 = computeValueFromNextSeed(this.seed);
    const vnext = v3 + (v2 + (v1 << 15) << 15);
    return vnext | 0;
  }
  getState() {
    return [this.seed];
  }
};
function fromState(state) {
  const valid = state.length === 1;
  if (!valid) {
    throw new Error("The state must have been produced by a congruential32 RandomGenerator");
  }
  return new LinearCongruential32(state[0]);
}
var congruential32 = Object.assign(
  function(seed) {
    return new LinearCongruential32(seed);
  },
  { fromState }
);

// ../../vendor/pure-rand/src/generator/MersenneTwister.ts
var MersenneTwister = class _MersenneTwister {
  constructor(states, index) {
    this.states = states;
    this.index = index;
  }
  static N = 624;
  static M = 397;
  static R = 31;
  static A = 2567483615;
  static F = 1812433253;
  static U = 11;
  static S = 7;
  static B = 2636928640;
  static T = 15;
  static C = 4022730752;
  static L = 18;
  static MASK_LOWER = 2 ** _MersenneTwister.R - 1;
  static MASK_UPPER = 2 ** _MersenneTwister.R;
  static twist(prev) {
    const mt = prev.slice();
    for (let idx = 0; idx !== _MersenneTwister.N - _MersenneTwister.M; ++idx) {
      const y2 = (mt[idx] & _MersenneTwister.MASK_UPPER) + (mt[idx + 1] & _MersenneTwister.MASK_LOWER);
      mt[idx] = mt[idx + _MersenneTwister.M] ^ y2 >>> 1 ^ -(y2 & 1) & _MersenneTwister.A;
    }
    for (let idx = _MersenneTwister.N - _MersenneTwister.M; idx !== _MersenneTwister.N - 1; ++idx) {
      const y2 = (mt[idx] & _MersenneTwister.MASK_UPPER) + (mt[idx + 1] & _MersenneTwister.MASK_LOWER);
      mt[idx] = mt[idx + _MersenneTwister.M - _MersenneTwister.N] ^ y2 >>> 1 ^ -(y2 & 1) & _MersenneTwister.A;
    }
    const y = (mt[_MersenneTwister.N - 1] & _MersenneTwister.MASK_UPPER) + (mt[0] & _MersenneTwister.MASK_LOWER);
    mt[_MersenneTwister.N - 1] = mt[_MersenneTwister.M - 1] ^ y >>> 1 ^ -(y & 1) & _MersenneTwister.A;
    return mt;
  }
  static seeded(seed) {
    const out = Array(_MersenneTwister.N);
    out[0] = seed;
    for (let idx = 1; idx !== _MersenneTwister.N; ++idx) {
      const xored = out[idx - 1] ^ out[idx - 1] >>> 30;
      out[idx] = Math.imul(_MersenneTwister.F, xored) + idx | 0;
    }
    return out;
  }
  static from(seed) {
    return new _MersenneTwister(_MersenneTwister.twist(_MersenneTwister.seeded(seed)), 0);
  }
  clone() {
    return new _MersenneTwister(this.states, this.index);
  }
  next() {
    const nextRng = new _MersenneTwister(this.states, this.index);
    const out = nextRng.unsafeNext();
    return [out, nextRng];
  }
  unsafeNext() {
    let y = this.states[this.index];
    y ^= this.states[this.index] >>> _MersenneTwister.U;
    y ^= y << _MersenneTwister.S & _MersenneTwister.B;
    y ^= y << _MersenneTwister.T & _MersenneTwister.C;
    y ^= y >>> _MersenneTwister.L;
    if (++this.index >= _MersenneTwister.N) {
      this.states = _MersenneTwister.twist(this.states);
      this.index = 0;
    }
    return y;
  }
  getState() {
    return [this.index, ...this.states];
  }
  static fromState(state) {
    const valid = state.length === _MersenneTwister.N + 1 && state[0] >= 0 && state[0] < _MersenneTwister.N;
    if (!valid) {
      throw new Error("The state must have been produced by a mersenne RandomGenerator");
    }
    return new _MersenneTwister(state.slice(1), state[0]);
  }
};
function fromState2(state) {
  return MersenneTwister.fromState(state);
}
var mersenne = Object.assign(
  function(seed) {
    return MersenneTwister.from(seed);
  },
  { fromState: fromState2 }
);

// ../../vendor/pure-rand/src/generator/XorShift.ts
var XorShift128Plus = class _XorShift128Plus {
  constructor(s01, s00, s11, s10) {
    this.s01 = s01;
    this.s00 = s00;
    this.s11 = s11;
    this.s10 = s10;
  }
  clone() {
    return new _XorShift128Plus(this.s01, this.s00, this.s11, this.s10);
  }
  next() {
    const nextRng = new _XorShift128Plus(this.s01, this.s00, this.s11, this.s10);
    const out = nextRng.unsafeNext();
    return [out, nextRng];
  }
  unsafeNext() {
    const a0 = this.s00 ^ this.s00 << 23;
    const a1 = this.s01 ^ (this.s01 << 23 | this.s00 >>> 9);
    const b0 = a0 ^ this.s10 ^ (a0 >>> 18 | a1 << 14) ^ (this.s10 >>> 5 | this.s11 << 27);
    const b1 = a1 ^ this.s11 ^ a1 >>> 18 ^ this.s11 >>> 5;
    const out = this.s00 + this.s10 | 0;
    this.s01 = this.s11;
    this.s00 = this.s10;
    this.s11 = b1;
    this.s10 = b0;
    return out;
  }
  jump() {
    const nextRng = new _XorShift128Plus(this.s01, this.s00, this.s11, this.s10);
    nextRng.unsafeJump();
    return nextRng;
  }
  unsafeJump() {
    let ns01 = 0;
    let ns00 = 0;
    let ns11 = 0;
    let ns10 = 0;
    const jump = [1667051007, 2321340297, 1548169110, 304075285];
    for (let i = 0; i !== 4; ++i) {
      for (let mask = 1; mask; mask <<= 1) {
        if (jump[i] & mask) {
          ns01 ^= this.s01;
          ns00 ^= this.s00;
          ns11 ^= this.s11;
          ns10 ^= this.s10;
        }
        this.unsafeNext();
      }
    }
    this.s01 = ns01;
    this.s00 = ns00;
    this.s11 = ns11;
    this.s10 = ns10;
  }
  getState() {
    return [this.s01, this.s00, this.s11, this.s10];
  }
};
function fromState3(state) {
  const valid = state.length === 4;
  if (!valid) {
    throw new Error("The state must have been produced by a xorshift128plus RandomGenerator");
  }
  return new XorShift128Plus(state[0], state[1], state[2], state[3]);
}
var xorshift128plus = Object.assign(
  function(seed) {
    return new XorShift128Plus(-1, ~seed, seed | 0, 0);
  },
  { fromState: fromState3 }
);

// ../../vendor/pure-rand/src/generator/XoroShiro.ts
var XoroShiro128Plus = class _XoroShiro128Plus {
  constructor(s01, s00, s11, s10) {
    this.s01 = s01;
    this.s00 = s00;
    this.s11 = s11;
    this.s10 = s10;
  }
  clone() {
    return new _XoroShiro128Plus(this.s01, this.s00, this.s11, this.s10);
  }
  next() {
    const nextRng = new _XoroShiro128Plus(this.s01, this.s00, this.s11, this.s10);
    const out = nextRng.unsafeNext();
    return [out, nextRng];
  }
  unsafeNext() {
    const out = this.s00 + this.s10 | 0;
    const a0 = this.s10 ^ this.s00;
    const a1 = this.s11 ^ this.s01;
    const s00 = this.s00;
    const s01 = this.s01;
    this.s00 = s00 << 24 ^ s01 >>> 8 ^ a0 ^ a0 << 16;
    this.s01 = s01 << 24 ^ s00 >>> 8 ^ a1 ^ (a1 << 16 | a0 >>> 16);
    this.s10 = a1 << 5 ^ a0 >>> 27;
    this.s11 = a0 << 5 ^ a1 >>> 27;
    return out;
  }
  jump() {
    const nextRng = new _XoroShiro128Plus(this.s01, this.s00, this.s11, this.s10);
    nextRng.unsafeJump();
    return nextRng;
  }
  unsafeJump() {
    let ns01 = 0;
    let ns00 = 0;
    let ns11 = 0;
    let ns10 = 0;
    const jump = [3639956645, 3750757012, 1261568508, 386426335];
    for (let i = 0; i !== 4; ++i) {
      for (let mask = 1; mask; mask <<= 1) {
        if (jump[i] & mask) {
          ns01 ^= this.s01;
          ns00 ^= this.s00;
          ns11 ^= this.s11;
          ns10 ^= this.s10;
        }
        this.unsafeNext();
      }
    }
    this.s01 = ns01;
    this.s00 = ns00;
    this.s11 = ns11;
    this.s10 = ns10;
  }
  getState() {
    return [this.s01, this.s00, this.s11, this.s10];
  }
};
function fromState4(state) {
  const valid = state.length === 4;
  if (!valid) {
    throw new Error("The state must have been produced by a xoroshiro128plus RandomGenerator");
  }
  return new XoroShiro128Plus(state[0], state[1], state[2], state[3]);
}
var xoroshiro128plus = Object.assign(
  function(seed) {
    return new XoroShiro128Plus(-1, ~seed, seed | 0, 0);
  },
  { fromState: fromState4 }
);

// ../../vendor/pure-rand/src/distribution/internals/UnsafeUniformIntDistributionInternal.ts
function unsafeUniformIntDistributionInternal(rangeSize, rng) {
  const MaxAllowed = rangeSize > 2 ? ~~(4294967296 / rangeSize) * rangeSize : 4294967296;
  let deltaV = rng.unsafeNext() + 2147483648;
  while (deltaV >= MaxAllowed) {
    deltaV = rng.unsafeNext() + 2147483648;
  }
  return deltaV % rangeSize;
}

// ../../vendor/pure-rand/src/distribution/internals/UnsafeUniformArrayIntDistributionInternal.ts
function unsafeUniformArrayIntDistributionInternal(out, rangeSize, rng) {
  const rangeLength = rangeSize.length;
  while (true) {
    for (let index = 0; index !== rangeLength; ++index) {
      const indexRangeSize = index === 0 ? rangeSize[0] + 1 : 4294967296;
      const g = unsafeUniformIntDistributionInternal(indexRangeSize, rng);
      out[index] = g;
    }
    for (let index = 0; index !== rangeLength; ++index) {
      const current = out[index];
      const currentInRange = rangeSize[index];
      if (current < currentInRange) {
        return out;
      } else if (current > currentInRange) {
        break;
      }
    }
  }
}

// ../../vendor/pure-rand/src/distribution/UnsafeUniformBigIntDistribution.ts
var One = typeof BigInt !== "undefined" ? BigInt(1) : void 0;
var ThirtyTwo = typeof BigInt !== "undefined" ? BigInt(32) : void 0;
var NumValues = typeof BigInt !== "undefined" ? BigInt(4294967296) : void 0;

// ../../vendor/pure-rand/src/distribution/internals/ArrayInt64.ts
function fromNumberToArrayInt64(out, n) {
  if (n < 0) {
    const posN = -n;
    out.sign = -1;
    out.data[0] = ~~(posN / 4294967296);
    out.data[1] = posN >>> 0;
  } else {
    out.sign = 1;
    out.data[0] = ~~(n / 4294967296);
    out.data[1] = n >>> 0;
  }
  return out;
}
function substractArrayInt64(out, arrayIntA, arrayIntB) {
  const lowA = arrayIntA.data[1];
  const highA = arrayIntA.data[0];
  const signA = arrayIntA.sign;
  const lowB = arrayIntB.data[1];
  const highB = arrayIntB.data[0];
  const signB = arrayIntB.sign;
  out.sign = 1;
  if (signA === 1 && signB === -1) {
    const low2 = lowA + lowB;
    const high = highA + highB + (low2 > 4294967295 ? 1 : 0);
    out.data[0] = high >>> 0;
    out.data[1] = low2 >>> 0;
    return out;
  }
  let lowFirst = lowA;
  let highFirst = highA;
  let lowSecond = lowB;
  let highSecond = highB;
  if (signA === -1) {
    lowFirst = lowB;
    highFirst = highB;
    lowSecond = lowA;
    highSecond = highA;
  }
  let reminderLow = 0;
  let low = lowFirst - lowSecond;
  if (low < 0) {
    reminderLow = 1;
    low = low >>> 0;
  }
  out.data[0] = highFirst - highSecond - reminderLow;
  out.data[1] = low;
  return out;
}

// ../../vendor/pure-rand/src/distribution/UnsafeUniformIntDistribution.ts
var safeNumberMaxSafeInteger = Number.MAX_SAFE_INTEGER;
var sharedA = { sign: 1, data: [0, 0] };
var sharedB = { sign: 1, data: [0, 0] };
var sharedC = { sign: 1, data: [0, 0] };
var sharedData = [0, 0];
function uniformLargeIntInternal(from, to, rangeSize, rng) {
  const rangeSizeArrayIntValue = rangeSize <= safeNumberMaxSafeInteger ? fromNumberToArrayInt64(sharedC, rangeSize) : substractArrayInt64(sharedC, fromNumberToArrayInt64(sharedA, to), fromNumberToArrayInt64(sharedB, from));
  if (rangeSizeArrayIntValue.data[1] === 4294967295) {
    rangeSizeArrayIntValue.data[0] += 1;
    rangeSizeArrayIntValue.data[1] = 0;
  } else {
    rangeSizeArrayIntValue.data[1] += 1;
  }
  unsafeUniformArrayIntDistributionInternal(sharedData, rangeSizeArrayIntValue.data, rng);
  return sharedData[0] * 4294967296 + sharedData[1] + from;
}
function unsafeUniformIntDistribution(from, to, rng) {
  const rangeSize = to - from;
  if (rangeSize <= 4294967295) {
    const g = unsafeUniformIntDistributionInternal(rangeSize + 1, rng);
    return g + from;
  }
  return uniformLargeIntInternal(from, to, rangeSize, rng);
}

// ../../vendor/parlour/engine/src/rng.ts
var UINT32 = 4294967296;
var POW_2_53 = 9007199254740992;
function isState(value) {
  return Array.isArray(value) && value.every((n) => typeof n === "number");
}
function makeRng(seed) {
  let gen = xoroshiro128plus(seed | 0);
  const rng = {
    int(maxExclusive) {
      if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
        throw new Error(`rng.int: maxExclusive must be a positive integer, got ${maxExclusive}`);
      }
      return unsafeUniformIntDistribution(0, maxExclusive - 1, gen);
    },
    float() {
      const hi = unsafeUniformIntDistribution(0, 2097151, gen);
      const lo = unsafeUniformIntDistribution(0, 4294967295, gen);
      return (hi * UINT32 + lo) / POW_2_53;
    },
    shuffle(items) {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = unsafeUniformIntDistribution(0, i, gen);
        const a = out[i];
        const b = out[j];
        out[i] = b;
        out[j] = a;
      }
      return out;
    },
    pick(items) {
      if (items.length === 0) throw new Error("rng.pick: empty collection");
      return items[unsafeUniformIntDistribution(0, items.length - 1, gen)];
    },
    fork(salt) {
      return makeRng(rngSeedFrom(`${gen.getState().join(",")}|${String(salt)}`));
    },
    getState() {
      return gen.getState().slice();
    },
    setState(state) {
      if (!isState(state)) throw new Error("rng.setState: expected a number[] state");
      gen = xoroshiro128plus.fromState(state);
    }
  };
  return rng;
}

// ../../vendor/parlour/engine/src/runtime.ts
var MAX_AUTO_ROUNDS = 1e3;
function canonical(value) {
  if (value === null || typeof value !== "object") {
    const json = JSON.stringify(value);
    return json === void 0 ? "null" : json;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value;
  const keys = Object.keys(obj).filter((k) => obj[k] !== void 0).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
}
function stateHash(state) {
  const text = canonical(state);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
function eventRng(seed, seq) {
  return makeRng(seed).fork(`ev:${seq}`);
}
function allBots(_seat) {
  return true;
}
function createSession(def, opts) {
  const rng = makeRng(opts.seed);
  const fx = createFx();
  const config = def.configSchema.resolve(opts.config);
  if (opts.veiled && !opts.deckOrder) {
    throw new Error(`${def.id}: a veiled session needs the ceremony deck order`);
  }
  const state = def.setup({
    config,
    seats: opts.seats,
    rng,
    fx,
    veiled: opts.veiled === true,
    deckOrder: opts.deckOrder
  });
  let phase = def.flow.start(state, opts.seats);
  const initialResult = def.end(state);
  if (initialResult) phase = { ...phase, actor: null };
  return {
    def,
    seed: opts.seed,
    config,
    seats: opts.seats,
    log: [],
    state,
    phase,
    status: initialResult ? "ended" : "playing",
    result: initialResult ?? null,
    botsEnabled: allBots,
    setupFx: fx.events.slice(),
    lastAppliedHash: null,
    veiled: opts.veiled === true,
    deckOrder: opts.deckOrder ? [...opts.deckOrder] : void 0
  };
}
function applyStep(def, seed, cursor, input2, fx) {
  const move = def.moves[input2.moveId];
  if (!move) throw new Error(`unknown move: ${input2.moveId}`);
  const seq = cursor.seq;
  const seat = input2.seat ?? -1;
  const opened = applyReveals(cursor.state, input2.reveals ?? []);
  const state = move.apply(opened, seat, input2.payload, {
    rng: eventRng(seed, seq),
    fx,
    event: input2.atMs === void 0 ? { seq } : { seq, atMs: input2.atMs },
    recycle: input2.recycle
  });
  if (input2.recycle) {
    const fault = recycleSettled(state, input2.recycle);
    if (fault) throw new Error(`${def.id}: ${fault.message}`);
  }
  const event = {
    seq,
    seat: input2.seat,
    move: input2.moveId,
    payload: input2.payload,
    hash: stateHash(state)
  };
  if (input2.automatic) event.automatic = true;
  if (input2.injected) event.injected = true;
  if (input2.atMs !== void 0) event.atMs = input2.atMs;
  if (input2.reveals && input2.reveals.length > 0) {
    event.reveals = input2.reveals.map(([handle2, card]) => [handle2, card]);
  }
  if (input2.recycle) {
    event.recycle = { retire: [...input2.recycle.retire], issue: [...input2.recycle.issue] };
  }
  cursor.state = state;
  cursor.seq = seq + 1;
  if (input2.atMs !== void 0) cursor.lastAtMs = input2.atMs;
  cursor.events.push(event);
  return event;
}
function settle(def, seed, seats, cursor, trigger, fx) {
  let event = trigger;
  for (let round = 0; round < MAX_AUTO_ROUNDS; round++) {
    const advance = def.flow.advance(cursor.state, event, seats);
    cursor.phase = advance.phase;
    if (advance.ended) {
      cursor.status = "ended";
      cursor.result = advance.ended;
      return;
    }
    const autos = advance.autoMoves ?? [];
    if (autos.length === 0) {
      const ended = def.end(cursor.state);
      if (ended) {
        cursor.status = "ended";
        cursor.result = ended;
      }
      return;
    }
    for (const auto of autos) {
      event = applyStep(
        def,
        seed,
        cursor,
        {
          seat: auto.seat,
          moveId: auto.move,
          payload: auto.payload,
          automatic: true,
          atMs: event.atMs
        },
        fx
      );
    }
  }
  throw new Error(`flow.advance did not settle after ${MAX_AUTO_ROUNDS} rounds`);
}
function rejection(session, code, message) {
  return { events: [], fx: [], session, rejected: { code, message } };
}
function sessionLastAtMs(session) {
  return session.lastAtMs ?? lastAtMsOf(session.log);
}
function revealRejection(def, session, reveals, recycle) {
  if (reveals.length === 0 && !recycle) return null;
  if (!session.veiled) {
    return rejection(session, "not-veiled", "this room is not running the Veil protocol");
  }
  if (!def.veil) {
    return rejection(session, "veil-unsupported", `${def.id} does not support veiled rooms`);
  }
  const deck = def.veil.deck(session.config);
  const faces = deck.faces;
  for (const [, card] of reveals) {
    if (!Object.hasOwn(faces, card)) {
      return rejection(session, "card-not-in-deck", `${String(card)} is not a card in this deck`);
    }
  }
  const fault = validateReveals(session.state, reveals);
  if (fault) return rejection(session, fault.code, fault.message);
  if (!recycle) return null;
  const recycleFault = validateRecycle(
    applyReveals(session.state, reveals),
    recycle,
    deck.cardIds.length
  );
  return recycleFault ? rejection(session, recycleFault.code, recycleFault.message) : null;
}
function timingError(lastAtMs, meta) {
  if (meta.atMs === void 0) return null;
  if (!Number.isSafeInteger(meta.atMs) || meta.atMs < 0) {
    return {
      code: "invalid-event-time",
      message: "atMs must be a non-negative safe integer"
    };
  }
  if (lastAtMs !== void 0 && meta.atMs < lastAtMs) {
    return {
      code: "event-time-regressed",
      message: `atMs ${meta.atMs} is earlier than the previous authority time ${lastAtMs}`
    };
  }
  return null;
}
function lastAtMsOf(log) {
  for (let index = log.length - 1; index >= 0; index--) {
    const previous = log[index]?.atMs;
    if (previous !== void 0) return previous;
  }
  return void 0;
}
function legalMovesForSeat(def, state, phase, seat) {
  return def.flow.legalMovesFor ? def.flow.legalMovesFor(state, phase, seat) : def.flow.legalMoves(state, phase);
}
function sessionApply(def, session, seat, moveId, payload, meta = {}) {
  if (session.status !== "playing") {
    return rejection(session, "match-ended", "the match has already ended");
  }
  if (!isActingSeat(session.phase, seat)) {
    return rejection(session, "not-your-turn", `seat ${seat} is not an acting seat`);
  }
  const invalidTiming = timingError(sessionLastAtMs(session), meta);
  if (invalidTiming) return rejection(session, invalidTiming.code, invalidTiming.message);
  const reveals = meta.reveals ?? [];
  const revealFault = revealRejection(def, session, reveals, meta.recycle);
  if (revealFault) return revealFault;
  const opened = applyReveals(session.state, reveals);
  const legal = legalMovesForSeat(def, opened, session.phase, seat);
  const match = legal.find((m) => m.id === moveId);
  if (!match) {
    return rejection(session, "illegal-move", `move ${moveId} is not legal right now`);
  }
  const move = def.moves[moveId];
  if (!move) {
    return rejection(session, "unknown-move", `move ${moveId} is not defined by ${def.id}`);
  }
  const effectivePayload = payload === void 0 ? match.payload : payload;
  const verdict = move.validate(opened, seat, effectivePayload, { recycle: meta.recycle });
  if (verdict !== true) {
    return { events: [], fx: [], session, rejected: verdict };
  }
  const fx = createFx();
  const cursor = {
    state: session.state,
    phase: session.phase,
    status: session.status,
    result: session.result,
    seq: session.log.length,
    events: [],
    lastAtMs: sessionLastAtMs(session)
  };
  const event = applyStep(
    def,
    session.seed,
    cursor,
    {
      seat,
      moveId,
      payload: effectivePayload,
      automatic: false,
      atMs: meta.atMs,
      reveals,
      recycle: meta.recycle
    },
    fx
  );
  settle(def, session.seed, session.seats, cursor, event, fx);
  const next = {
    ...session,
    log: [...session.log, ...cursor.events],
    state: cursor.state,
    phase: cursor.phase,
    status: cursor.status,
    result: cursor.result,
    lastAppliedHash: cursor.events[cursor.events.length - 1]?.hash ?? session.lastAppliedHash ?? null,
    lastAtMs: cursor.lastAtMs
  };
  return { events: cursor.events, fx: fx.events, session: next };
}

// ../../vendor/parlour/engine/src/config.ts
function coerce(field, value) {
  switch (field.kind) {
    case "toggle":
      return typeof value === "boolean" ? value : field.default;
    case "int": {
      if (typeof value !== "number" || !Number.isFinite(value)) return field.default;
      return Math.min(field.max, Math.max(field.min, Math.round(value)));
    }
    case "enum":
      return field.options.some((o) => o.value === value) ? value : field.default;
  }
}
function defineConfig(fields, presets = []) {
  const defaults = () => {
    const out = {};
    for (const field of fields) out[field.key] = field.default;
    return out;
  };
  return {
    fields,
    presets,
    defaults,
    resolve(values) {
      const out = defaults();
      for (const field of fields) {
        const given = values?.[field.key];
        if (given === void 0) continue;
        out[field.key] = coerce(field, given);
      }
      return out;
    }
  };
}

// ../../vendor/parlour/tricks/src/index.ts
var TrickFx = {
  /** {seat, card, index} — one per card landing on the table */
  Play: "tricks.play",
  /** {seat: winner, cards, count} — the completed trick sweeping to its taker */
  Collect: "tricks.collect"
};
function openTrick(leader) {
  return { leader, plays: [], ledSuit: null };
}
function trickPlaysNeeded(seats) {
  return Math.max(1, seats);
}
function isTrickComplete(trick, seats) {
  return trick.plays.length >= trickPlaysNeeded(seats);
}
function trickCards(trick) {
  return trick.plays.map((play) => play.card);
}
function playToTrick(trick, seat, card, rules) {
  const plays = [...trick.plays, { seat, card }];
  return {
    ...trick,
    plays,
    // Effective, not printed: leading the left bower leads TRUMP.
    ledSuit: trick.ledSuit ?? effectiveSuitOf(card, rules)
  };
}
function effectiveSuitOf(card, rules) {
  return rules.effectiveSuit ? rules.effectiveSuit(card) : rules.suitOf(card);
}
function hasSuit(cards, rules, suit) {
  return cards.some((card) => effectiveSuitOf(card, rules) === suit);
}
function followError(ctx, rules) {
  if (effectiveSuitOf(ctx.card, rules) === ctx.ledSuit) return null;
  return hasSuit(ctx.hand, rules, ctx.ledSuit) ? "must-follow-suit" : null;
}
function resolveTrickWinner(trick, rules) {
  const trump = rules.trumpSuit ?? null;
  let winner = null;
  let winningSuit = null;
  let winningRank = -Infinity;
  for (const play of trick.plays) {
    const suit = effectiveSuitOf(play.card, rules);
    if (suit === null) continue;
    const rank = rules.rankOf(play.card);
    const beatsTrump = trump !== null && suit === trump && winningSuit !== trump;
    const beatsLed = winningSuit !== null && suit === winningSuit && rank > winningRank;
    const firstCard = winningSuit === null;
    if (!(firstCard || beatsTrump || beatsLed)) continue;
    winner = play.seat;
    winningSuit = suit;
    winningRank = rank;
  }
  return winner;
}
function emitTrickPlay(fx, seat, card, index) {
  fx.emit(TrickFx.Play, { seat, card, index });
}
function emitTrickCollect(fx, seat, cards) {
  fx.emit(TrickFx.Collect, { seat, cards: [...cards], count: cards.length });
}

// ../../vendor/parlour/game-hearts/src/cards.ts
var SUIT_CLUBS = "clubs";
var SUIT_HEARTS = "hearts";
var SUIT_SPADES = "spades";
var SUIT_DIAMONDS = "diamonds";
var TWO_CLUBS = "C2";
var QUEEN_SPADES = "S12";
var JACK_DIAMONDS = "D11";
function isRealCard(card) {
  return !card.startsWith("v#");
}
function suitOfCard(card) {
  if (!isRealCard(card)) return null;
  switch (card[0]) {
    case "C":
      return SUIT_CLUBS;
    case "H":
      return SUIT_HEARTS;
    case "S":
      return SUIT_SPADES;
    case "D":
      return SUIT_DIAMONDS;
    default:
      return null;
  }
}
function rankOfCard(card) {
  if (!isRealCard(card)) return -1;
  const rank = Number.parseInt(card.slice(1), 10);
  return rank === 1 ? 14 : Number.isFinite(rank) ? rank : -1;
}
function isHeart(card) {
  return suitOfCard(card) === SUIT_HEARTS;
}
function isPenaltyCard(card, jackDiamonds) {
  void jackDiamonds;
  return isHeart(card) || card === QUEEN_SPADES;
}
function cardPoints(card, jackDiamonds) {
  if (isHeart(card)) return 1;
  if (card === QUEEN_SPADES) return 13;
  if (jackDiamonds && card === JACK_DIAMONDS) return -10;
  return 0;
}
function heartsTrickRules(deck) {
  void deck;
  return { suitOf: suitOfCard, rankOf: rankOfCard };
}
var HEARTS_HAND_SUIT_ORDER = {
  [SUIT_CLUBS]: 0,
  [SUIT_DIAMONDS]: 1,
  [SUIT_SPADES]: 2,
  [SUIT_HEARTS]: 3
};
var orderHeartsHand = (cards, context) => stableCardOrder(cards, (left, right) => {
  const aSuit = suitOfCard(left);
  const bSuit = suitOfCard(right);
  if (aSuit === null) return bSuit === null ? 0 : 1;
  if (bSuit === null) return -1;
  const suitDiff = (HEARTS_HAND_SUIT_ORDER[aSuit] ?? 99) - (HEARTS_HAND_SUIT_ORDER[bSuit] ?? 99);
  if (suitDiff !== 0) return suitDiff;
  const specialKey = (card) => card === QUEEN_SPADES || context.jackDiamonds === true && card === JACK_DIAMONDS ? 1 : 0;
  const specialDiff = specialKey(left) - specialKey(right);
  if (specialDiff !== 0) return specialDiff;
  const rankKey = (card) => rankOfCard(card) === 1 ? 14 : rankOfCard(card);
  return rankKey(left) - rankKey(right) || left.localeCompare(right);
});

// ../../vendor/parlour/game-hearts/src/audit.ts
function reconstructHands(finalHands, plays, seats, trickRules) {
  if (plays.length % seats !== 0) return null;
  const hands = finalHands.map((cards) => [...cards]);
  const tricks = plays.length / seats;
  for (let t = tricks - 1; t >= 0; t--) {
    const trickPlays = plays.slice(t * seats, (t + 1) * seats);
    const winner = resolveTrickWinner(
      { leader: trickPlays[0].seat, plays: trickPlays, ledSuit: null },
      trickRules
    );
    for (const play of trickPlays) {
      const hand = hands[play.seat];
      if (!hand) return null;
      hand.push(play.card);
    }
    void winner;
  }
  return hands;
}
function auditFollowSuit(finalHands, plays, seats, trickRules) {
  if (plays.length === 0 || plays.length % seats !== 0) return [];
  const startHands = reconstructHands(finalHands, plays, seats, trickRules);
  if (!startHands) return [];
  const working = startHands.map((cards) => [...cards ?? []]);
  const disputed = /* @__PURE__ */ new Set();
  for (let index = 0; index < plays.length; index++) {
    const play = plays[index];
    const trickStart = index - index % seats;
    const ledSuit = suitOfCard(plays[trickStart].card);
    const hand = working[play.seat] ?? [];
    const at = hand.indexOf(play.card);
    if (at >= 0) hand.splice(at, 1);
    if (ledSuit !== null && suitOfCard(play.card) !== ledSuit && hand.some((card) => suitOfCard(card) === ledSuit)) {
      disputed.add(play.seat);
    }
  }
  return [...disputed].sort((a, b) => a - b);
}

// ../../vendor/parlour/game-hearts/src/config.ts
var PASS_ROTATION_WITH_HOLD = ["left", "right", "across", "hold"];
var PASS_ROTATION_PLAIN = ["left", "right", "across"];
function passDirectionFor(handIndex, holdHand) {
  const rotation = holdHand ? PASS_ROTATION_WITH_HOLD : PASS_ROTATION_PLAIN;
  return rotation[(handIndex % rotation.length + rotation.length) % rotation.length];
}
function passOffset(direction) {
  switch (direction) {
    case "left":
      return 1;
    case "right":
      return -1;
    case "across":
      return 2;
    case "hold":
      return 0;
  }
}
var heartsConfigSchema = defineConfig(
  [
    {
      key: "passDirection",
      kind: "enum",
      label: "Passing",
      options: [
        { value: "left", label: "Left" },
        { value: "right", label: "Right" },
        { value: "across", label: "Across" },
        { value: "hold", label: "Hold (no pass)" }
      ],
      default: "left"
    },
    {
      key: "holdHand",
      kind: "toggle",
      label: "Hold hand every fourth deal",
      default: true
    },
    {
      key: "noPointsFirstTrick",
      kind: "toggle",
      label: "No penalty cards on the first trick",
      default: true
    },
    {
      key: "jackDiamonds",
      kind: "toggle",
      label: "Jack of diamonds scores \u221210",
      default: false
    },
    {
      key: "gameOver",
      kind: "enum",
      label: "Game ends at",
      options: [
        { value: 50, label: "50 points" },
        { value: 75, label: "75 points" },
        { value: 100, label: "100 points" }
      ],
      default: 100
    },
    {
      key: "moonShift",
      kind: "enum",
      label: "Shooting the moon",
      options: [
        { value: "opponents", label: "+26 to everyone else" },
        { value: "self", label: "\u221226 from your own score" }
      ],
      default: "opponents"
    }
  ],
  [
    { id: "classic", label: "Classic Hearts", values: {} },
    { id: "quickcut", label: "Quick Cut", values: { gameOver: 50 } },
    {
      id: "cutthroat",
      label: "Cutthroat",
      values: { jackDiamonds: true, noPointsFirstTrick: false }
    }
  ]
);

// ../../vendor/parlour/game-hearts/src/bots/evaluate.ts
function cardsSeen(state) {
  const seen = /* @__PURE__ */ new Set();
  for (const pile of state.taken) for (const card of pile) seen.add(card);
  for (const play of state.plays) seen.add(play.card);
  return seen;
}
function queenStillOut(state) {
  return !cardsSeen(state).has(QUEEN_SPADES);
}
function readTrick(plays, rankOf2, jackDiamonds = false) {
  let points = 0;
  if (plays.length === 0) {
    return {
      ledSuit: null,
      winningSeat: null,
      winningRank: -1,
      pointsOnTable: 0,
      heartsOnTable: 0
    };
  }
  const ledSuit = suitOfCard(plays[0].card);
  let winningSeat = plays[0].seat;
  let winningRank = rankOf2(plays[0].card);
  let hearts = 0;
  for (const play of plays) {
    if (isHeart(play.card)) {
      hearts += 1;
      points += 1;
    } else if (play.card === QUEEN_SPADES) {
      points += 13;
    } else if (jackDiamonds && play.card === JACK_DIAMONDS) {
      points -= 10;
    }
    if (suitOfCard(play.card) !== ledSuit) continue;
    if (rankOf2(play.card) > winningRank) {
      winningRank = rankOf2(play.card);
      winningSeat = play.seat;
    }
  }
  return { ledSuit, winningSeat, winningRank, pointsOnTable: points, heartsOnTable: hearts };
}
function passDanger(card, rules) {
  const rank = Number.parseInt(card.slice(1), 10) || 0;
  const suit = suitOfCard(card);
  let danger = rank;
  if (card === QUEEN_SPADES) danger += 20;
  else if (suit === "spades" && rank >= 13) danger += 12;
  if (suit === "hearts") danger += Math.max(0, rank - 6);
  void rules.jackDiamonds;
  return danger;
}
function voidBonus(hand, card) {
  const suit = suitOfCard(card);
  if (!suit || suit === "spades") return 0;
  const inSuit = hand.filter((other) => suitOfCard(other) === suit);
  if (inSuit.length <= 2 && inSuit.every((other) => (Number.parseInt(other.slice(1), 10) || 0) <= 6)) {
    return 4 - inSuit.length;
  }
  return 0;
}
function knownVoids(plays, seats) {
  const voids = /* @__PURE__ */ new Set();
  for (let index = 0; index < plays.length; index++) {
    const trickStart = index - index % seats;
    const led = suitOfCard(plays[trickStart].card);
    if (!led || index === trickStart) continue;
    const play = plays[index];
    if (suitOfCard(play.card) !== led) voids.add(`${play.seat}:${led}`);
  }
  return voids;
}

// ../../vendor/parlour/game-hearts/src/bots/shared.ts
function legalPlayCards(legal) {
  return legal.flatMap(
    (move) => move.id === "playCard" && typeof move.payload?.card === "string" ? [move.payload.card] : []
  );
}
function choosePassCards(state, seat, size, rng, tier) {
  const hand = [...state.hands[seat] ?? []];
  if (hand.length <= size) return hand;
  if (tier === 1) {
    const keeps = hand.filter(
      (card) => card === QUEEN_SPADES || suitOfCard(card) === "spades" && rankOf(card) >= 13
    );
    const rest = rng.shuffle(hand.filter((card) => !keeps.includes(card)));
    return [...rest, ...rng.shuffle(keeps)].slice(0, size);
  }
  const scored = hand.map((card) => ({
    card,
    score: passDanger(card, state.rules) + (tier >= 3 ? voidBonus(hand, card) : 0)
  })).sort((a, b) => b.score - a.score);
  return scored.slice(0, size).map((entry) => entry.card);
}
function duckUnder(hand, ledSuit, winningRank) {
  const followers = hand.filter((card) => suitOfCard(card) === ledSuit);
  const safe = followers.filter((card) => rankOf(card) < winningRank);
  if (safe.length === 0) return null;
  return safe.reduce((best, card) => rankOf(card) > rankOf(best) ? card : best);
}
function rankOf(card) {
  const value = Number.parseInt(card.slice(1), 10);
  return value === 1 ? 14 : Number.isFinite(value) ? value : -1;
}
function dumpOrder(hand, state) {
  return [...hand].sort((a, b) => discardUrgency(b, state) - discardUrgency(a, state));
}
function discardUrgency(card, state) {
  let urgency = rankOf(card);
  if (card === QUEEN_SPADES) urgency += 100;
  else if (suitOfCard(card) === "spades" && rankOf(card) >= 13 && queenStillOut(state))
    urgency += 40;
  if (isHeart(card)) urgency += rankOf(card) * 2 + 8;
  if (state.rules.jackDiamonds && card === "D11") urgency -= 50;
  return urgency;
}
function pickPlay({ state, seat, cards, tier, rng }) {
  if (cards.length === 0) return null;
  const trick = state.trick;
  const ledSuit = trick?.ledSuit ?? null;
  if (tier === 1) return rng.pick(cards);
  if (ledSuit === null || trick === null || trick.plays.length === 0) {
    return pickLead(state, seat, cards, tier);
  }
  const winning = readTrick(trick.plays, rankOf, state.rules.jackDiamonds);
  const following = cards.filter((card) => suitOfCard(card) === ledSuit);
  if (following.length === 0) {
    const ordered = dumpOrder(cards, state);
    if (tier >= 3 && state.rules.jackDiamonds && winning.pointsOnTable > 0 && cards.includes("D11") && ordered[0] === "D11") {
      return ordered[1] ?? "D11";
    }
    return ordered[0];
  }
  const under = duckUnder(cards, ledSuit, winning.winningRank);
  if (under !== null) return under;
  const winners = following.filter((card) => rankOf(card) > winning.winningRank);
  const nonQueen = winners.filter((card) => card !== QUEEN_SPADES);
  const pool = nonQueen.length > 0 ? nonQueen : winners;
  return pool.reduce((low, card) => rankOf(card) < rankOf(low) ? card : low);
}
function pickLead(state, seat, cards, tier) {
  const queenOut = queenStillOut(state);
  let pool = cards.filter((card) => {
    if (isHeart(card)) return false;
    if (suitOfCard(card) === "spades" && queenOut && rankOf(card) >= 12) return false;
    return true;
  });
  if (pool.length === 0) pool = cards.filter((card) => !isHeart(card));
  if (pool.length === 0) pool = cards;
  let pool2 = pool;
  if (tier >= 3) {
    const voids = knownVoids(state.plays, state.seats);
    const riskOf = (card) => {
      const suit = suitOfCard(card);
      if (!suit) return 0;
      let risk = 0;
      for (let other = 0; other < state.seats; other++) {
        if (other === seat) continue;
        if (voids.has(`${other}:${suit}`)) risk += 1;
      }
      return risk;
    };
    const safest = [...pool].sort((a, b) => riskOf(a) - riskOf(b));
    const bestRisk = safest.length > 0 ? riskOf(safest[0]) : 0;
    if (bestRisk >= 2) {
      pool2 = pool.filter((card) => riskOf(card) === bestRisk);
    } else {
      pool2 = pool.filter((card) => riskOf(card) <= 1);
      if (pool2.length === 0) pool2 = [...pool];
    }
  }
  const ranked = [...pool2].sort((a, b) => {
    const rankDiff = rankOf(a) - rankOf(b);
    if (rankDiff !== 0) return rankDiff;
    return suitLength(cards, b) - suitLength(cards, a);
  });
  return ranked[0];
}
function suitLength(hand, card) {
  const suit = suitOfCard(card);
  if (!suit) return 0;
  return hand.filter((other) => suitOfCard(other) === suit).length;
}

// ../../vendor/parlour/game-hearts/src/bots/easy.ts
var easyBot = {
  id: "hearts-easy",
  label: "Harmless",
  tier: 1,
  chooseMove(state, seat, legal, rng) {
    if (legal.length === 0) return null;
    const move = legal[0];
    if (move.id === "passCards") {
      return {
        id: "passCards",
        payload: { cards: choosePassCards(state, seat, 3, rng, 1) }
      };
    }
    if (move.id === "playCard") {
      const cards = legalPlayCards(legal);
      const card = pickPlay({ state, seat, cards, tier: 1, rng }) ?? cards[0];
      return card ? { id: "playCard", payload: { card } } : move;
    }
    return move;
  }
};

// ../../vendor/parlour/game-hearts/src/bots/hard.ts
var DEFAULT_HARD_PARAMS = {
  /**
   * Four points is the earliest hoarder trigger that never behaved like a
   * regression: measured head-to-head against the shipped 14 at n=200–400 it
   * lands 73–78% of matches across the th3–th8 sweep; 14 was late enough to
   * be the adversarial finding, and the ship value now matches where the
   * ladder's measured floor actually is.
   */
  moonBlockThreshold: 4
};
function makeHardBot(params) {
  return {
    id: "hearts-hard",
    label: "Sharp",
    tier: 3,
    chooseMove(state, seat, legal, rng) {
      if (legal.length === 0) return null;
      const move = legal[0];
      if (move.id === "passCards") {
        const hand = state.hands[seat] ?? [];
        if (hand.includes(QUEEN_SPADES) && spadeGuards(hand) >= 6) {
          const withoutQueen = hand.filter((card) => card !== QUEEN_SPADES);
          const rest = choosePassCards(
            {
              ...state,
              hands: state.hands.map((cards, index) => index === seat ? withoutQueen : cards)
            },
            seat,
            3,
            rng,
            3
          );
          return {
            id: "passCards",
            payload: { cards: [...rest].slice(0, 2).concat(QUEEN_SPADES) }
          };
        }
        return { id: "passCards", payload: { cards: choosePassCards(state, seat, 3, rng, 3) } };
      }
      if (move.id === "playCard") {
        const cards = legalPlayCards(legal);
        if (cards.length === 0) return move;
        const blocking = shouldBlockMoon(state, seat, params.moonBlockThreshold);
        if (blocking !== null && cards.includes(blocking)) {
          return { id: "playCard", payload: { card: blocking } };
        }
        const card = pickPlay({ state, seat, cards, tier: 3, rng }) ?? cards[0];
        return { id: "playCard", payload: { card } };
      }
      return move;
    }
  };
}
var hardBot = makeHardBot(DEFAULT_HARD_PARAMS);
function spadeGuards(hand) {
  return hand.filter((card) => suitOfCard(card) === "spades" && card !== QUEEN_SPADES).length;
}
function shouldBlockMoon(state, seat, threshold) {
  const trick = state.trick;
  if (!trick || trick.plays.length < 2) return null;
  const ledSuit = suitOfCard(trick.plays[0].card);
  if (!ledSuit) return null;
  const hoarder = moonHoarder(state, seat, threshold);
  if (hoarder === null || !trick.plays.some((play) => play.seat === hoarder)) return null;
  const hand = state.hands[seat] ?? [];
  const followers = hand.filter((card) => suitOfCard(card) === ledSuit);
  if (followers.length === 0) return null;
  const winningRank = Math.max(
    ...trick.plays.filter((play) => suitOfCard(play.card) === ledSuit).map((play) => rankOf(play.card))
  );
  const cheapestWinner = followers.filter((card) => rankOf(card) > winningRank).sort((a, b) => rankOf(a) - rankOf(b))[0];
  if (cheapestWinner === void 0) return null;
  const pointsOnTable = trick.plays.reduce((sum, play) => sum + pointWorth(play.card), 0);
  return pointsOf(state, hoarder) + pointsOnTable >= 26 ? cheapestWinner : null;
}
var MOON_HOARDER_MIN_POINTS = 14;
function moonHoarder(state, self, threshold = MOON_HOARDER_MIN_POINTS) {
  void threshold;
  let hoarder = null;
  let total = 0;
  for (let seat = 0; seat < state.seats; seat++) {
    const points = pointsOf(state, seat);
    total += points;
    if (points > 0) {
      if (hoarder !== null) return null;
      hoarder = seat;
    }
  }
  if (hoarder === null || hoarder === self) return null;
  return total >= threshold ? hoarder : null;
}
function pointsOf(state, seat) {
  if (seat === null) return 0;
  return (state.taken[seat] ?? []).reduce((sum, card) => sum + pointWorth(card), 0);
}
function pointWorth(card) {
  if (card.startsWith("H")) return 1;
  return card === QUEEN_SPADES ? 13 : 0;
}

// ../../vendor/parlour/game-hearts/src/bots/medium.ts
var mediumBot = {
  id: "hearts-medium",
  label: "Careful",
  tier: 2,
  chooseMove(state, seat, legal, rng) {
    if (legal.length === 0) return null;
    const move = legal[0];
    if (move.id === "passCards") {
      return {
        id: "passCards",
        payload: { cards: choosePassCards(state, seat, 3, rng, 2) }
      };
    }
    if (move.id === "playCard") {
      const cards = legalPlayCards(legal);
      const card = pickPlay({ state, seat, cards, tier: 2, rng }) ?? cards[0];
      return card ? { id: "playCard", payload: { card } } : move;
    }
    return move;
  }
};

// ../../vendor/parlour/game-hearts/src/bots/index.ts
var HEARTS_PERSONAS = [
  {
    id: "dove",
    bot: easyBot,
    meta: {
      name: "Dove",
      avatar: "plum",
      blurb: "Plays whatever feels nice. Collects hearts like souvenirs.",
      emotes: ["oops", "hello", "nice"]
    }
  },
  {
    id: "flint",
    bot: mediumBot,
    meta: {
      name: "Flint",
      avatar: "slate",
      blurb: "Ducks under every winner and never volunteers the queen.",
      emotes: ["nice", "hurry"]
    }
  },
  {
    id: "rose",
    bot: hardBot,
    meta: {
      name: "Rose",
      avatar: "marigold",
      blurb: "Tracks the queen, hunts moons, and blocks yours.",
      emotes: ["wow", "nice", "gg"]
    }
  },
  {
    id: "ash",
    bot: hardBot,
    meta: {
      name: "Ash",
      avatar: "cobalt",
      blurb: "Quietly remembers every void at the table.",
      emotes: ["nice", "gg"]
    }
  }
];
var BY_ID = new Map(HEARTS_PERSONAS.map((persona) => [persona.id, persona]));
var HEARTS_BOTS = [easyBot, mediumBot, hardBot];

// ../../vendor/parlour/game-hearts/src/howto.ts
var heartsHowToPlay = {
  summary: "The classic evasion game \u2014 take no hearts, dodge the Black Lady, and let someone else eat the points.",
  objective: "Finish the match with the lowest score. Every heart you capture costs 1 point and the queen of spades costs 13; when one player crosses the game-over threshold (100 by default) the lowest total wins.",
  sections: [
    {
      heading: "The pass",
      body: [
        "Before each hand you pick three cards and slide them to a neighbour \u2014 everyone chooses in secret, then all four passes land together.",
        "The direction rotates every hand: left, right, across, then a hold hand with no pass at all."
      ]
    },
    {
      heading: "Playing tricks",
      body: [
        "The two of clubs leads the first trick. Follow suit if you can; the highest card of the led suit takes the trick and its winner leads next."
      ],
      bullets: [
        { label: "First trick", text: "no penalty cards may be thrown on it (house-rule toggle)" },
        {
          label: "Breaking hearts",
          text: "hearts cannot lead until one has been discarded on an earlier trick \u2014 unless your hand is nothing but hearts"
        },
        {
          label: "Void",
          text: "out of the led suit? Throw anything \u2014 this is where the queen lands on someone"
        }
      ]
    },
    {
      heading: "Scoring a hand",
      body: [
        "When all thirteen tricks are played, each heart you captured is 1 point and the queen of spades is 13."
      ],
      bullets: [
        {
          label: "Jack of diamonds",
          text: "optional house rule \u2014 captures \u221210 for whoever takes her"
        },
        {
          label: "Shooting the moon",
          text: "capture ALL thirteen hearts plus the queen and you score zero while everyone else takes +26 \u2014 or, with the other house rule, your own score drops 26"
        }
      ]
    },
    {
      heading: "The match",
      body: [
        "Hands stack until someone crosses the game-over line (50 / 75 / 100). Lowest total wins the match; ties share the crown."
      ]
    },
    {
      heading: "House rules",
      body: [
        "Room settings tune everything: pass direction, hold hands, first-trick protection, the jack of diamonds, the game-over threshold and the moon shift. Classic tables keep the defaults."
      ]
    }
  ]
};

// ../../vendor/parlour/game-hearts/src/scoring.ts
var MOON_POINTS = 26;
function rawHandPoints(taken, jackDiamonds) {
  return taken.map((cards) => cards.reduce((sum, card) => sum + cardPoints(card, jackDiamonds), 0));
}
function heartsTaken(taken) {
  return taken.map((cards) => cards.filter(isHeart).length);
}
function tookQueenOfSpades(taken) {
  return taken.map((cards) => cards.includes(QUEEN_SPADES));
}
function moonShooterOf(taken) {
  const shooters = taken.map((cards, seat) => ({
    seat,
    all: cards.filter(isHeart).length === 13 && cards.includes(QUEEN_SPADES)
  })).filter((entry) => entry.all).map((entry) => entry.seat);
  return shooters.length > 0 ? shooters[0] : null;
}
function adjustedHandPoints(taken, rules) {
  const points = rawHandPoints(taken, rules.jackDiamonds);
  const shooter = moonShooterOf(taken);
  if (shooter === null) return { points, shooter: null };
  if (rules.moonShift === "self") {
    return { points: points.map((p, seat) => seat === shooter ? p - MOON_POINTS : p), shooter };
  }
  return {
    points: points.map((p, seat) => seat === shooter ? 0 : p + MOON_POINTS),
    shooter
  };
}
var MOON_DETAIL_KEYS = ["points", "hearts", "queen", "moon"];
function handRankings(points, taken, disputed) {
  const hearts = heartsTaken(taken);
  const queens = tookQueenOfSpades(taken);
  const shooter = moonShooterOf(taken);
  const ordered = points.map((value, seat) => ({ seat, value })).sort((a, b) => a.value - b.value || a.seat - b.seat);
  let priorValue = null;
  let priorRank = 0;
  return ordered.map(({ seat, value }, index) => {
    if (value !== priorValue) priorRank = index + 1;
    priorValue = value;
    const detail = {
      points: value,
      hearts: hearts[seat] ?? 0,
      queen: queens[seat] ?? false,
      moon: seat === shooter,
      disputed: disputed.includes(seat)
    };
    void MOON_DETAIL_KEYS;
    return { seat, rank: priorRank, detail };
  });
}
function handResult(points, taken, disputed) {
  const shooter = moonShooterOf(taken);
  const rankings = handRankings(points, taken, disputed);
  const best = rankings[0]?.rank;
  const winners = rankings.filter((r) => r.rank === best && best === 1).map((r) => r.seat);
  return {
    winner: winners.length === 1 ? winners[0] : null,
    rankings,
    reason: shooter !== null ? "moon-shot" : "hand-complete"
  };
}

// ../../vendor/parlour/game-hearts/src/state.ts
var HEARTS_SEATS = 4;
var HAND_SIZE = 13;
var TRICKS_PER_HAND = HAND_SIZE;

// ../../vendor/parlour/game-hearts/src/game.ts
var GAME_ID = "hearts";
var PASS_SIZE = 3;
var DEAL_STAGGER_MS = 70;
var VEIL_HANDLE_PREFIX2 = "v#";
function err(code, message) {
  return { code, message };
}
function handOf(state, seat) {
  return state.hands[seat] ?? [];
}
function isRealCard2(card) {
  return !card.startsWith(VEIL_HANDLE_PREFIX2);
}
function payloadPass(payload) {
  const cards = payload?.cards;
  if (!Array.isArray(cards) || cards.length !== PASS_SIZE || !cards.every((card) => typeof card === "string")) {
    return null;
  }
  if (new Set(cards).size !== PASS_SIZE) return null;
  return { cards };
}
function payloadPlay(payload) {
  const record = payload ?? {};
  if (typeof record.card !== "string") return null;
  if (record.claim !== void 0 && record.claim !== "all-hearts" && record.claim !== "all-penalty") {
    return null;
  }
  return { card: record.card, claim: record.claim };
}
function allHearts(cards) {
  return cards.length > 0 && cards.every(isHeart);
}
function allPenalty(cards) {
  return cards.length > 0 && cards.every((card) => isPenaltyCard(card, false));
}
function firstTrick(state) {
  return state.tricksPlayed === 0;
}
function claimVerified(state, seat, claim) {
  const hand = handOf(state, seat);
  if (!hand.every(isRealCard2)) return false;
  return claim === "all-hearts" ? allHearts(hand) : allPenalty(hand);
}
function canPlayCard(state, seat, card) {
  const hand = handOf(state, seat);
  const ledSuit = state.trick?.ledSuit ?? null;
  if (!state.ledTwoClubs) return card === TWO_CLUBS;
  if (ledSuit === null) {
    if (firstTrick(state)) return card === TWO_CLUBS;
    if (isHeart(card) && !state.heartsBroken && !allHearts(hand)) return false;
    return true;
  }
  if (followError({ ledSuit, hand, card }, heartsTrickRules()) !== null) return false;
  if (firstTrick(state) && state.rules.noPointsFirstTrick && isPenaltyCard(card, false)) {
    return allPenalty(hand);
  }
  return true;
}
var passCards = {
  validate(state, seat, payload) {
    if (!state.passing) return err("no-pass-now", "there is nothing to pass");
    const picked = payloadPass(payload);
    if (!picked) return err("bad-pass", "expected {cards} \u2014 exactly three different cards");
    const hand = handOf(state, seat);
    for (const card of picked.cards) {
      if (!hand.includes(card)) return err("not-in-hand", `${card} is not in your hand`);
    }
    return true;
  },
  apply(state, seat, payload, ctx) {
    const picked = payloadPass(payload);
    if (!picked) throw new Error("passCards apply requires {cards}");
    const seats = state.seats;
    const selections = state.selections.map(
      (pick, index) => index === seat ? picked.cards : pick
    );
    const hands = state.hands.map(
      (cards, index) => index === seat ? cards.filter((card) => !picked.cards.includes(card)) : cards.slice()
    );
    ctx.fx.emit("hearts.pass.pick", { seat });
    if (selections.some((pick) => pick === null)) {
      return { ...state, selections, hands };
    }
    const offset = passOffset(state.rules.passDirection);
    const received = Array.from({ length: seats }, () => []);
    const transfers = [];
    for (let giver = 0; giver < seats; giver++) {
      const receiver = advanceSeat(giver, seats, offset);
      const cards = selections[giver] ?? [];
      received[receiver] = [...cards];
      transfers.push({ from: giver, to: receiver, cards: [...cards] });
    }
    const mergedHands = hands.map((cards, index) => [...cards, ...received[index] ?? []]);
    const holder = Math.max(
      0,
      mergedHands.findIndex((cards) => cards.includes(TWO_CLUBS))
    );
    ctx.fx.emit("hearts.pass.reveal", { direction: state.rules.passDirection, transfers });
    ctx.fx.emit(Fx.TurnRing, { seat: holder }, 640);
    return {
      ...state,
      hands: mergedHands,
      selections: Array.from({ length: seats }, () => null),
      passing: false,
      leader: holder,
      turn: holder
    };
  }
};
var playCard = {
  validate(state, seat, payload) {
    if (state.passing) return err("still-passing", "the pass has not landed yet");
    const veilLeadWindow = !state.ledTwoClubs && state.tricksPlayed === 0 && !state.trick;
    if (!veilLeadWindow && state.turn !== seat) {
      return err("not-your-turn", "it is not your turn");
    }
    const play = payloadPlay(payload);
    if (!play) return err("bad-play", "expected {card}");
    if (!handOf(state, seat).includes(play.card)) {
      return err("not-in-hand", `${play.card} is not in your hand`);
    }
    const ledSuit = state.trick?.ledSuit ?? null;
    if (firstTrick(state) && ledSuit === null && play.card !== TWO_CLUBS) {
      return err("lead-two-clubs", "the two of clubs leads the first trick");
    }
    if (ledSuit === null && !firstTrick(state) && isHeart(play.card) && !state.heartsBroken) {
      if (!state.veiled) {
        if (!allHearts(handOf(state, seat))) {
          return err("hearts-not-broken", "hearts have not been broken yet");
        }
      } else if (play.claim !== "all-hearts" || !claimVerified(state, seat, "all-hearts")) {
        return err(
          "bad-claim",
          "leading an unbroken heart under Veil needs an opened all-hearts claim"
        );
      }
    }
    if (ledSuit !== null && !state.veiled) {
      const fault = followError(
        { ledSuit, hand: handOf(state, seat), card: play.card },
        heartsTrickRules()
      );
      if (fault) return err(fault, "you must follow suit");
    }
    if (ledSuit !== null && firstTrick(state) && state.rules.noPointsFirstTrick && isPenaltyCard(play.card, false)) {
      if (!state.veiled) {
        if (!allPenalty(handOf(state, seat))) {
          return err("no-points-first-trick", "no penalty cards on the first trick");
        }
      } else if (play.claim !== "all-penalty" || !claimVerified(state, seat, "all-penalty")) {
        return err(
          "bad-claim",
          "throwing a penalty card on trick one under Veil needs an opened all-penalty claim"
        );
      }
    }
    return true;
  },
  apply(state, seat, payload, ctx) {
    const play = payloadPlay(payload);
    if (!play) throw new Error("playCard apply requires {card}");
    const wasLeading = state.trick === null;
    const hand = handOf(state, seat).filter((card) => card !== play.card);
    const hands = state.hands.map((cards2, index) => index === seat ? hand : cards2.slice());
    const trick = playToTrick(state.trick ?? openTrick(seat), seat, play.card, heartsTrickRules());
    const plays = [...state.plays, { seat, card: play.card }];
    emitTrickPlay(ctx.fx, seat, play.card, trick.plays.length - 1);
    let heartsBroken = state.heartsBroken;
    if (isHeart(play.card) && !heartsBroken) {
      heartsBroken = true;
      ctx.fx.emit("hearts.broken", { seat });
    }
    const base = {
      ...state,
      hands,
      trick,
      plays,
      heartsBroken,
      ledTwoClubs: state.ledTwoClubs || wasLeading && play.card === TWO_CLUBS,
      leader: wasLeading ? seat : state.leader
    };
    if (!isTrickComplete(trick, state.seats)) {
      return { ...base, turn: advanceSeat(seat, state.seats) };
    }
    const cards = trickCards(trick);
    const winner = resolveTrickWinner(trick, heartsTrickRules()) ?? seat;
    emitTrickCollect(ctx.fx, winner, cards);
    if (cards.includes(QUEEN_SPADES)) ctx.fx.emit("hearts.queen", { seat: winner });
    const heartCount = cards.filter(isHeart).length;
    if (heartCount > 0) ctx.fx.emit("hearts.point", { seat: winner, hearts: heartCount });
    const taken = state.taken.map(
      (pile, index) => index === winner ? [...pile, ...cards] : pile.slice()
    );
    const tricksWon = state.tricksWon.map((count, index) => index === winner ? count + 1 : count);
    const tricksPlayed = state.tricksPlayed + 1;
    const swept = {
      ...base,
      taken,
      tricksWon,
      tricksPlayed,
      trick: null,
      leader: winner,
      turn: winner
    };
    if (tricksPlayed >= TRICKS_PER_HAND) {
      const { points, shooter } = adjustedHandPoints(taken, state.rules);
      if (shooter !== null) ctx.fx.emit("hearts.moon", { seat: shooter });
      ctx.fx.emit("hearts.hand.end", { points, shooter });
      return { ...swept, handOver: true, handPoints: points, moonShooter: shooter };
    }
    ctx.fx.emit(Fx.TurnRing, { seat: winner }, 140);
    return swept;
  }
};
var showdownOpen = {
  validate(state, seat) {
    if (!state.handOver) return err("hand-playing", "the hand is not over yet");
    if (!state.veiled) return err("not-veiled", "this table plays in the open");
    if (state.openedUp[seat]) return err("already-open", "your hand is already face up");
    return true;
  },
  apply(state, seat, _payload, ctx) {
    ctx.fx.emit(Fx.ShowdownReveal, { seat, cards: handOf(state, seat).length });
    const openedUp = state.openedUp.map((opened, index) => index === seat ? true : opened);
    if (openedUp.some((opened) => !opened)) return { ...state, openedUp };
    const disputed = auditFollowSuit(state.hands, state.plays, state.seats, heartsTrickRules());
    return { ...state, openedUp, disputed };
  }
};
function seatsAwaitingPass(state) {
  return state.selections.flatMap((pick, seat) => pick === null ? [seat] : []);
}
function seatsAwaitingOpen(state) {
  return state.openedUp.flatMap((opened, seat) => !opened ? [seat] : []);
}
function allSeatIds(count) {
  return Array.from({ length: count }, (_, seat) => seat);
}
function phaseFor(state) {
  const round = state.tricksPlayed + 1;
  if (state.handOver) {
    if (state.veiled) {
      const pending = seatsAwaitingOpen(state);
      if (pending.length > 0) {
        return { phase: "showdown-reveal", actor: pending[0] ?? null, actors: pending, round };
      }
    }
    return { phase: "hand-over", actor: null, round };
  }
  if (state.passing) {
    const pending = seatsAwaitingPass(state);
    return { phase: "pass", actor: pending[0] ?? null, actors: allSeatIds(state.seats), round };
  }
  if (!state.ledTwoClubs) {
    return { phase: "lead", actor: null, actors: allSeatIds(state.seats), round };
  }
  return { phase: "play", actor: state.turn, round };
}
var flow = {
  start(state) {
    return phaseFor(state);
  },
  legalMoves() {
    return [];
  },
  legalMovesFor(state, phase, seat) {
    switch (phase.phase) {
      case "pass": {
        if (state.selections[seat] !== null) return [];
        const hand = [...handOf(state, seat)].sort().slice(0, PASS_SIZE);
        return [{ id: "passCards", payload: { cards: hand } }];
      }
      case "lead": {
        if (state.veiled) return [{ id: "playCard", hint: "the two of clubs leads" }];
        return handOf(state, seat).filter((card) => card === TWO_CLUBS).map((card) => ({ id: "playCard", payload: { card } }));
      }
      case "play": {
        if (state.turn !== seat) return [];
        if (state.veiled) return [{ id: "playCard" }];
        return handOf(state, seat).filter((card) => canPlayCard(state, seat, card)).map((card) => ({ id: "playCard", payload: { card } }));
      }
      case "showdown-reveal":
        return state.openedUp[seat] ? [] : [{ id: "showdown.open" }];
      default:
        return [];
    }
  },
  advance(state, _event, _seats) {
    const ended = endOfHand(state);
    return ended ? { phase: phaseFor(state), ended } : { phase: phaseFor(state) };
  }
};
function endOfHand(state) {
  if (!state.handOver) return null;
  if (state.veiled && state.openedUp.some((opened) => !opened)) return null;
  const points = state.handPoints ?? adjustedHandPoints(state.taken, state.rules).points;
  return handResult(points, state.taken, state.disputed);
}
var heartsGame = {
  id: GAME_ID,
  configSchema: heartsConfigSchema,
  howToPlay: heartsHowToPlay,
  veil: veilSupport({
    deck: stdDeck(),
    handSize: 13,
    publicSetup: "none"
  }),
  setup(ctx) {
    if (ctx.seats !== HEARTS_SEATS) {
      throw new Error(`hearts needs exactly ${HEARTS_SEATS} seats`);
    }
    const order = dealOrder(ctx, stdDeck());
    const hands = Array.from({ length: ctx.seats }, () => []);
    let cursor = 0;
    for (let row = 0; row < TRICKS_PER_HAND; row++) {
      for (let seat = 0; seat < ctx.seats; seat++) {
        const card = order[cursor++];
        if (!card) throw new Error("hearts deck exhausted during deal");
        hands[seat]?.push(card);
        ctx.fx.emit(
          Fx.DealCard,
          { card, from: "stock", to: `hand:${seat}`, dur: 220 },
          (cursor - 1) * DEAL_STAGGER_MS
        );
      }
    }
    const passing = ctx.config.passDirection !== "hold";
    const holder = ctx.veiled ? 0 : Math.max(
      0,
      hands.findIndex((cards) => cards.includes(TWO_CLUBS))
    );
    return {
      seats: ctx.seats,
      rules: ctx.config,
      veiled: ctx.veiled === true,
      hands,
      selections: Array.from({ length: ctx.seats }, () => null),
      passing,
      trick: null,
      leader: holder,
      turn: holder,
      taken: Array.from({ length: ctx.seats }, () => []),
      tricksWon: Array.from({ length: ctx.seats }, () => 0),
      plays: [],
      heartsBroken: false,
      tricksPlayed: 0,
      ledTwoClubs: !ctx.veiled,
      handOver: false,
      handPoints: null,
      moonShooter: null,
      openedUp: Array.from({ length: ctx.seats }, () => false),
      disputed: []
    };
  },
  moves: {
    passCards,
    playCard,
    "showdown.open": showdownOpen
  },
  flow,
  playerView(state, seat) {
    return {
      ...state,
      hands: state.hands.map(
        (cards, index) => index === seat ? cards.slice() : cards.map(() => "??")
      ),
      selections: state.selections.map((pick, index) => {
        if (index === seat) return pick;
        return pick === null ? null : ["??", "??", "??"];
      })
    };
  },
  end: endOfHand,
  bots: HEARTS_BOTS
};

// ../../vendor/parlour/game-hearts/src/catalog.ts
var heartsCatalog = defineGameCatalog({
  id: "hearts",
  gameId: "hearts",
  name: "Hearts",
  subtitle: "the evasion game",
  tagline: "Take no hearts",
  description: "Dodge every heart, duck the Black Lady, and stick someone else with the points. Rotating passes, secret picks, one very sharp queen.",
  facts: ["4 players", "pass \xB7 trick \xB7 evade", "solo or friends"],
  accent: "#b8434f",
  shade: "#6e1f2c",
  art: [
    { label: "Q\u2660", tint: ["#4a4a55", "#1d1d26"] },
    { label: "\u2665", tint: ["#d95763", "#8f2733"] },
    { label: "J\u2666", tint: ["#e29349", "#a35a1c"] },
    { label: "2\u2663", tint: ["#5fae7b", "#2f6b48"] }
  ],
  href: "/hearts",
  howToPlay: heartsHowToPlay,
  seats: [4],
  configSchema: heartsConfigSchema,
  handOrder: orderHeartsHand,
  modes: [
    {
      id: "classic",
      preset: "classic",
      name: "Classic",
      tagline: "By the book",
      description: "Rotating left-right-across passes, a hold hand every fourth deal, no points on the first trick. Game to 100.",
      facts: ["game to 100", "hold hands on", "~15 min"],
      accent: "#b8434f",
      shade: "#6e1f2c",
      art: [
        { label: "Q\u2660", tint: ["#4a4a55", "#1d1d26"] },
        { label: "\u2665", tint: ["#d95763", "#8f2733"] },
        { label: "\u21C4", tint: ["#e29349", "#a35a1c"] }
      ]
    },
    {
      id: "quickcut",
      preset: "quickcut",
      name: "Quick Cut",
      tagline: "Same hearts, faster",
      description: "Identical rules, lower ceiling \u2014 first player past 50 ends it. A whole match inside a coffee break.",
      facts: ["game to 50", "hold hands on", "~8 min"],
      accent: "#4ba1ba",
      shade: "#25586e",
      art: [
        { label: "50", tint: ["#4ba1ba", "#25586e"] },
        { label: "\u2665", tint: ["#d95763", "#8f2733"] },
        { label: "\u21C4", tint: ["#e29349", "#a35a1c"] }
      ]
    },
    {
      id: "cutthroat",
      preset: "cutthroat",
      name: "Cutthroat",
      tagline: "The jack is loose",
      description: "The jack of diamonds scores \u221210 to whoever catches her, and penalty cards fly on trick one. Nobody is safe.",
      facts: ["J\u2666 \u221210", "trick-one points", "game to 100"],
      accent: "#c8566b",
      shade: "#7c2c3e",
      art: [
        { label: "J\u2666", tint: ["#e29349", "#a35a1c"] },
        { label: "Q\u2660", tint: ["#4a4a55", "#1d1d26"] },
        { label: "\u2665", tint: ["#d95763", "#8f2733"] }
      ]
    }
  ]
});

// service.mjs
var import_node_crypto = require("node:crypto");
var import_node_readline = require("node:readline");
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var file = process.env.AMUNDSEN_HEARTS_DB;
var rooms = {};
if (file) {
  try {
    rooms = JSON.parse((0, import_node_fs.readFileSync)(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
var CREW = { capn: { name: "Cap'n Barnacle", policy: mediumBot }, doc: { name: "Doc", policy: easyBot }, ada: { name: "Ada", policy: mediumBot }, polly: { name: "Polly", policy: easyBot } };
for (const room of Object.values(rooms)) room.aiPending = false;
function roster(room) {
  return room.players.map((p) => p ? { name: p.name, crew: p.crew || null, online: !!p.crew || Date.now() - p.seen < 15e3 } : null);
}
function publicContext(room) {
  return {
    game: "Hearts",
    hand: room.hand,
    scores: room.scores,
    players: roster(room),
    passing: room.session?.state.passing,
    heartsBroken: room.session?.state.heartsBroken,
    playedCards: room.session?.state.plays || [],
    priorHands: room.history || [],
    chat: (room.chat || []).slice(-12)
  };
}
function tableAside(room) {
  const state = room.session?.state;
  if (!state || room.aiPending || room.asideHand === room.hand || state.tricksPlayed < 3) return null;
  const speakers = room.players.filter((p) => p?.crew).map((p) => p.crew);
  if (!speakers.length) return null;
  room.asideHand = room.hand;
  room.aiPending = true;
  room.revision++;
  save();
  return { code: room.code, speakers: [speakers[(0, import_node_crypto.randomInt)(speakers.length)]], context: { ...publicContext(room), aside: true } };
}
function sameMove(left, right) {
  if (!left || !right || left.id !== right.id) return false;
  if (left.id === "playCard") return left.payload.card === right.payload.card;
  if (left.id === "passCards") return [...left.payload.cards].sort().join() === [...right.payload.cards].sort().join();
  return true;
}
function trackDecision(room, seat, move, payload) {
  const legal = heartsGame.flow.legalMovesFor(room.session.state, room.session.phase, seat);
  const reference = mediumBot.chooseMove(heartsGame.playerView(room.session.state, seat), seat, legal, makeRng(1), { thinkMs: () => 100 });
  const actual = { id: move, payload };
  if (!legal.some((candidate) => sameMove(candidate, actual))) return;
  if (!reference || !sameMove(reference, actual)) {
    room.learning ||= {};
    const profile = room.learning[seat] ||= { choices: 0, carefulChoices: 0 };
    profile.choices++;
    return;
  }
  room.learning ||= {};
  const profile = room.learning[seat] ||= { choices: 0, carefulChoices: 0 };
  profile.choices++;
  profile.carefulChoices++;
}
function crewPolicy(room, crew) {
  if (CREW[crew].policy !== easyBot) return CREW[crew].policy;
  const profiles = Object.values(room.learning || {});
  const choices = profiles.reduce((sum, profile) => sum + profile.choices, 0);
  const carefulChoices = profiles.reduce((sum, profile) => sum + profile.carefulChoices, 0);
  if (choices < 12) return easyBot;
  const carefulRate = (carefulChoices + 6) / (choices + 12);
  const carefulChance = Math.max(0.15, Math.min(0.75, (carefulRate - 0.2) / 0.7));
  return (0, import_node_crypto.randomInt)(1e3) < carefulChance * 1e3 ? mediumBot : easyBot;
}
function applyMove(room, seat, move, payload) {
  const outcome = sessionApply(heartsGame, room.session, seat, move, payload);
  if (outcome.rejected) fail(400, outcome.rejected.message);
  room.session = outcome.session;
  if (outcome.session.status === "ended") {
    room.history ||= [];
    room.history.push({ hand: room.hand, tricks: outcome.session.state.tricksPlayed, heartsBroken: outcome.session.state.heartsBroken, points: outcome.session.state.handPoints, moonShooter: outcome.session.state.moonShooter });
    room.history = room.history.slice(-20);
    room.scores = room.scores.map((score, i) => score + outcome.session.state.handPoints[i]);
    room.finished = room.scores.some((score) => score >= 100);
    room.ready = room.players.flatMap((p, i) => p?.crew ? [i] : []);
  }
}
function advanceCrew(room) {
  if (!room.session || room.session.status !== "playing" || Date.now() < (room.nextBotAt || 0)) return;
  const seat = room.players.findIndex((p, i) => p?.crew && heartsGame.flow.legalMovesFor(room.session.state, room.session.phase, i).length);
  if (seat < 0) return;
  const legal = heartsGame.flow.legalMovesFor(room.session.state, room.session.phase, seat);
  const crew = room.players[seat].crew;
  const move = crewPolicy(room, crew).chooseMove(heartsGame.playerView(room.session.state, seat), seat, legal, makeRng((0, import_node_crypto.randomInt)(4294967296)), { thinkMs: () => 100 });
  if (!move) return;
  applyMove(room, seat, move.id, move.payload);
  room.nextBotAt = Date.now() + 900;
  room.revision++;
  save();
}
var fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
function save() {
  if (!file) return;
  (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(file), { recursive: true });
  (0, import_node_fs.writeFileSync)(file + ".tmp", JSON.stringify(rooms), { mode: 384 });
  (0, import_node_fs.renameSync)(file + ".tmp", file);
}
function deal(room) {
  const deck = [...stdDeck().cardIds];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = (0, import_node_crypto.randomInt)(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const session = createSession(heartsGame, {
    seed: (0, import_node_crypto.randomInt)(4294967296),
    seats: 4,
    deckOrder: deck,
    config: { passDirection: passDirectionFor(room.hand - 1, true) }
  });
  room.session = session;
  room.ready = [];
}
function view(room, seat) {
  const session = room.session;
  const state = session ? heartsGame.playerView(session.state, seat) : null;
  return {
    code: room.code,
    seat,
    revision: room.revision,
    hand: room.hand,
    scores: room.scores,
    players: roster(room),
    game: "hearts",
    chat: room.chat || [],
    aiPending: !!room.aiPending,
    history: room.history || [],
    state,
    ready: room.ready,
    finished: room.finished,
    legal: session ? heartsGame.flow.legalMovesFor(session.state, session.phase, seat) : []
  };
}
function handle(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) fail(400, "Expected a table request.");
  const { action } = data;
  let room, seat, token;
  if (action === "list") return { tables: Object.values(rooms).filter((r) => Date.now() - r.touched < 864e5 && r.players.some((p) => p && !p.crew)).map((r) => ({
    id: r.code,
    game: "hearts",
    name: `${r.players.find((p) => p && !p.crew).name}'s table`,
    players: roster(r),
    openSeats: r.session ? 0 : r.players.filter((p) => !p || p.crew).length,
    started: !!r.session,
    hand: r.hand
  })), games: [{ id: "hearts", title: "Hearts" }] };
  if (action === "crewReply") {
    room = rooms[data.code];
    if (!room) return {};
    room.chat ||= [];
    room.chat.push({ name: data.name, text: data.text, crew: data.crew || null });
    room.chat = room.chat.slice(-40);
    room.aiPending = !data.done;
    room.revision++;
    save();
    return {};
  }
  if (action === "create" || action === "join") {
    const name = typeof data.name === "string" ? data.name.trim() : "";
    if (!name || name.length > 40 || /[\x00-\x1f\x7f]/.test(name)) fail(400, "Enter a name of up to 40 characters.");
    for (const [code, r] of Object.entries(rooms)) if (Date.now() - r.touched > 864e5) delete rooms[code];
    if (action === "create") {
      if (data.game && data.game !== "hearts") fail(400, "This game is not aboard yet. Choose Hearts.");
      if (Object.keys(rooms).length >= 64) fail(429, "All tables are occupied. Try again later.");
      let code;
      do {
        code = Array.from({ length: 5 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[(0, import_node_crypto.randomInt)(31)]).join("");
      } while (rooms[code]);
      room = rooms[code] = {
        code,
        players: [null, null, null, null],
        revision: 0,
        hand: 1,
        scores: [0, 0, 0, 0],
        ready: [],
        history: [],
        finished: false,
        touched: Date.now()
      };
    } else {
      room = rooms[String(data.code).toUpperCase()];
      if (!room) fail(404, "That table has closed. Choose another table.");
      if (room.session) fail(409, "This table has started. Rejoin from your original browser.");
    }
    seat = room.players.findIndex((p) => !p || p.crew);
    if (seat < 0) fail(409, "This table is full.");
    token = (0, import_node_crypto.randomBytes)(24).toString("hex");
    room.players[seat] = { name, token, seen: Date.now() };
  } else {
    room = rooms[data.code];
    if (!room) fail(404, "Table not found. Create or join a table.");
    seat = room.players.findIndex((p) => p && !p.crew && typeof data.token === "string" && p.token === data.token);
    if (seat < 0) fail(403, "Your seat could not be found. Join the table again.");
    if (action === "poll") {
      room.players[seat].seen = Date.now();
      room.touched = Date.now();
      advanceCrew(room);
      const aiJob = tableAside(room);
      return { ...view(room, seat), ...(aiJob ? { aiJob } : {}) };
    }
    if (action === "chat") {
      const text = typeof data.text === "string" ? data.text.trim() : "";
      if (!text || text.length > 1e3) fail(400, "Write a message of up to 1000 characters.");
      if (room.aiPending) fail(409, "The crew are answering. Give them a moment.");
      room.chat ||= [];
      room.chat.push({ name: room.players[seat].name, text });
      room.chat = room.chat.slice(-40);
      const mentions = [...text.matchAll(/@(capn|doc|ada|polly|crew)\b/gi)].map((m) => m[1].toLowerCase());
      const speakers = mentions.includes("crew") ? Object.keys(CREW) : mentions.length ? [...new Set(mentions)] : [room.players.find((p) => p?.crew)?.crew || "polly"];
      room.aiPending = true;
      room.revision++;
      save();
      return { ...view(room, seat), aiJob: { code: room.code, speakers, context: publicContext(room) } };
    }
    if (action === "inviteCrew" || action === "setCrew") {
      if (room.session) fail(409, "Choose the crew before the deal.");
      if (action === "inviteCrew") {
        const available = Object.keys(CREW).filter((id) => !room.players.some((p) => p?.crew === id));
        room.players = room.players.map((p) => p || (() => {
          const crew = available.shift();
          return { name: CREW[crew].name, crew };
        })());
      } else {
        const target = data.seatIndex;
        if (!Number.isInteger(target) || target < 0 || target > 3 || room.players[target] && !room.players[target].crew) fail(400, "Choose an empty or crew seat.");
        if (data.crew && (!Object.hasOwn(CREW, data.crew) || room.players.some((p) => p?.crew === data.crew))) fail(400, "Choose a crew member who is not already seated.");
        room.players[target] = data.crew ? { name: CREW[data.crew].name, crew: data.crew } : null;
      }
      room.revision++;
      save();
      return view(room, seat);
    }
    const simultaneous = action === "move" || action === "ready";
    if (simultaneous && data.hand !== void 0 && data.hand !== room.hand) fail(409, "A new hand has started. Choose again.");
    if (data.revision !== room.revision && !simultaneous) fail(409, "The table changed. Try your move again.");
    if (action === "leave") {
      room.players[seat] = null;
      room.revision++;
      room.touched = Date.now();
      if (!room.players.some((p) => p && !p.crew)) delete rooms[room.code];
      else if (room.session) {
        const crew = Object.keys(CREW).find((id) => !room.players.some((p) => p?.crew === id));
        room.players[seat] = { name: CREW[crew].name, crew };
      }
      save();
      return { left: true };
    }
    if (action === "start") {
      if (room.session) fail(409, "This match has already started.");
      if (room.players.some((p) => !p)) fail(409, "Four players are needed to deal.");
      deal(room);
    } else if (action === "move") {
      if (!room.session || room.finished) fail(409, "There is no hand in play.");
      trackDecision(room, seat, data.move, data.payload);
      applyMove(room, seat, data.move, data.payload);
    } else if (action === "ready") {
      if (room.session?.status !== "ended") fail(409, "Finish this hand first.");
      if (!room.ready.includes(seat)) room.ready.push(seat);
      if (room.ready.length === 4) {
        if (room.finished) {
          room.hand = 1;
          room.scores = [0, 0, 0, 0];
          room.finished = false;
        } else room.hand++;
        deal(room);
      }
    } else fail(400, "Unknown table action.");
  }
  room.revision++;
  room.touched = Date.now();
  save();
  return { ...view(room, seat), ...token ? { token } : {} };
}
var input = (0, import_node_readline.createInterface)({ input: process.stdin });
input.on("line", (line) => {
  try {
    const data = JSON.parse(line);
    process.stdout.write(JSON.stringify({ status: 200, body: handle(data) }) + "\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({
      status: error.status || 500,
      body: { error: error.status ? error.message : "The table could not complete that request." }
    }) + "\n");
    if (!error.status) console.error(error);
  }
});
