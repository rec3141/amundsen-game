# Amundsen game collaboration

## Product voice and science
- The audience is STEM postgraduate scientists aboard CCGS Amundsen.
- Keep education embedded in observation, mechanics, and discoveries. No preachy explanations.
- Never add disclaimer or warning copy such as "not for navigation", "not an instrument simulator", "only a game", or similar hedging about the game's scientific purpose. Remove such copy when encountered. Ordinary actionable error messages are fine.
- Aim for exploration and chart-making in the spirit of Pirates! Gold.
- Minigames launch anywhere through keyboard shortcuts or buttons. Do not gate them on predetermined stations or markers.
- When the user says "pull data", use the data on the underway server. Local published data is at /data/underway_server/www; project context is /data/dev/underway. Prefer read-only access to these sources. Do not replace real measurements with invented values.
- All game runtime assets and data must work without internet access.

## Crew-idea workflow
- Each crew idea gets a separate Git branch and worktree and its own headless `codex exec` process.
- The coordinating session reviews, tests, and merges completed branches on main. Worker instances must not merge themselves or deploy.
- Work only within the assigned file scope; commit the implementation and report tests and limits.
- Main at /data/dev/amundsen-game is the live deployment; runtime state is excluded from Git.

## Code and coordination
- Comments, docstrings, and headers describe current behavior and constraints, not repository history. Keep issue pointers, and verify statements against current code.
- Read relevant handoffs in /data/dev/agentchat when continuing work, and save concise state, authorization, verification, and next steps. Explicitly identify ongoing processes.
- Avoid changing the underway acquisition services or dashboard. The game owns only its service, timer, database, and identified Caddy route.
