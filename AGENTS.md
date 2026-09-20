# Amundsen game collaboration

## Product voice and science
- The audience is STEM postgraduate scientists aboard CCGS Amundsen.
- Keep education embedded in observation, mechanics, and discoveries. No preachy explanations.
- Never add disclaimer or warning copy such as "not for navigation", "not an instrument simulator", "only a game", or similar hedging about the game's scientific purpose. Remove such copy when encountered. Ordinary actionable error messages are fine.
- Aim for exploration and chart-making in the spirit of Pirates! Gold.
- Minigames launch anywhere through keyboard shortcuts or buttons. Do not gate them on predetermined stations or markers.
- The world is built from the underway DEMs and ice charts. Land blocks the ship; running aground costs the points of the last operation. All minigames, including ice stations, launch anywhere without location, equipment or active-event gates.
- When the user says "pull data", use the data on the underway server. Local published data is at /data/underway_server/www; project context is /data/dev/underway. Prefer read-only access to these sources. Do not replace real measurements with invented values.
- All game runtime assets and data must work without internet access.

## Crew-idea workflow
- Before dispatch, the coordinator reads the request and feedback, identifies the actual player flow, and records a scope, acceptance outcome and allowed files with `tools/crew_watch.py --route`. Use `--triage` to inspect pending work. Every new comment invalidates the prior routing decision. Main-chart, economy, progression, launcher and cross-device requests must change those flows, not become standalone themed minigames. Workers whose scope cannot deliver the outcome report `SCOPE_BLOCKED` with the needed files.
- Each crew idea gets a separate Git branch and worktree and its own headless worker process: the saved Claude Code/Codex preference (`python3 tools/crew.py switch claude|codex`). Usage limits automatically hand the same worktree to the other tool once; if both are limited the run stops.
- The coordinating session reviews, smoke-checks, and merges completed branches on main. Worker instances must not merge themselves or deploy.
- Work only within the assigned file scope; commit the implementation and report verification and limits.
- Main at /data/dev/amundsen-game is the live deployment; runtime state is excluded from Git.

## NO TESTS
- This is fast, live, exploratory coding. Do not create automated test files or test suites unless the user explicitly asks.
- Testing the game is welcome: play it, inspect behavior, run a quick syntax check or a targeted smoke check when useful.
- Do not add tests for their own sake or spend the meeting building test infrastructure.
- Existing checks may be run when they help verify a change; prioritize playable features and quick feedback.

## Code and coordination
- Comments, docstrings, and headers describe current behavior and constraints, not repository history. Keep issue pointers, and verify statements against current code.
- Read relevant handoffs in /data/dev/agentchat when continuing work, and save concise state, authorization, verification, and next steps. Explicitly identify ongoing processes.
- Avoid changing the underway acquisition services or dashboard. The game owns only its service, timer, database, and identified Caddy route.
