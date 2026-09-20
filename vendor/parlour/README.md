# Parlour Hearts source

Source: https://github.com/braedonsaunders/parlour
Pinned commit: a5f64d92dcfb87790b9707e563e6e7ffa5076d8a
License: MIT (see LICENSE).

The engine, tricks and game-hearts TypeScript sources are vendored here without
upstream test and simulation files. Upstream source comments are preserved.
The ship's adapter is tools/hearts/service.mjs. It uses Parlour's game setup,
move validation, turn flow, scoring, legal moves and per-player views. Deals use
Node's cryptographic shuffle; seeds and private logs never leave the server.
Crew opponents use the upstream easy, medium and hard policies with per-seat
private views. Conversation is handled separately by the local ship model.

Rebuild from the repository root with:

    npm ci --prefix tools/hearts --ignore-scripts
    npm run build --prefix tools/hearts

pure-rand 7.0.1 is vendored separately in ../pure-rand with its MIT license.

hearts-service.cjs includes the runtime dependencies; Node.js 18+ is the only
additional server runtime. No npm install or internet connection is needed to
run the checked-in bundle. Tables persist in runtime/hearts.json (override with
AMUNDSEN_HEARTS_DB). The Python game server starts and owns the child process.
