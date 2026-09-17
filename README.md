# Amundsen Expedition

An offline browser game and shared minigame suggestion board for collaborative
coding aboard the CCGS Amundsen. Python 3.10+; no packages, build step, external
fonts, map tiles, or internet connection required.

## Live ship deployment

Open **http://underway.local/game/**. IP fallbacks are
http://192.168.3.216/game/ (Wi-Fi) and http://10.0.0.58/game/ (wired).
The deployed server listens on loopback port 8050 behind Caddy. Relative asset
and API URLs support the `/game/` prefix; `/game` redirects to `/game/`.

User systemd units in `deploy/` are installed and enabled for `cryomics`.
User lingering is enabled on this workstation, so the server starts at boot.
The route timer checks every 30 seconds and restores only the identified game
route after Caddy reloads. It preserves the dashboard and live-sampling routes.
Caddy's root-owned file is not modified. A saved pre-game route snapshot is in
`runtime/caddy-before-game.json`; do not restore it wholesale over later changes.

```sh
XDG_RUNTIME_DIR=/run/user/1000 systemctl --user status amundsen-game.service
XDG_RUNTIME_DIR=/run/user/1000 systemctl --user restart amundsen-game.service
XDG_RUNTIME_DIR=/run/user/1000 journalctl --user -u amundsen-game.service -n 30
```

To stop and remove this deployment:

```sh
XDG_RUNTIME_DIR=/run/user/1000 systemctl --user disable --now amundsen-game-route.timer
XDG_RUNTIME_DIR=/run/user/1000 systemctl --user stop amundsen-game-route.service
python3 deploy/route.py --remove
XDG_RUNTIME_DIR=/run/user/1000 systemctl --user disable --now amundsen-game.service
```

## Run manually on another machine

```sh
cd /data/dev/amundsen-game
python3 server.py --port 8050
```

Keep that terminal running. The server binds to all interfaces by default.
Use `--host 127.0.0.1` to restrict it to the workstation. On the ship's current
network configuration:

- Workstation: http://127.0.0.1:8050/
- Ship Wi-Fi: http://192.168.3.216:8050/
- Wired LAN: http://10.0.0.58:8050/

Addresses can change; check `hostname -I`. Clients must be able to reach TCP
port 8050. These links serve the game independently of the underway dashboard.
A browser on another ship-network device must verify reachability before the meeting.

For a detached session:

```sh
mkdir -p runtime
nohup python3 server.py --port 8050 > runtime/server.log 2>&1 &
echo $! > runtime/server.pid
```

Run only one server on the port. This process does not auto-start after reboot.
The Python server is intended for a trusted ship intranet, not public hosting.

## Play and collaborate

- Click water to sail there; click a numbered station or its checklist card to
  sail to it and start its mission automatically.
- Steer with WASD or arrows. Press E close to a station to begin a mission.
- Lower the CTD, then fire a bottle between 290 and 380 m for 100 science points.
- Each of the three stations currently uses the CTD minigame. Complete all three
  to finish the expedition. Close a mission to abort; completed stations award once.
- Progress is per browser and saved locally. Restart clears only that expedition.
- Crew ideas opens the shared web form. It works on phones and refreshes every
  five seconds. Names are optional; all ideas are visible to the crew.
- This is single-player sailing with a shared suggestion board, not multiplayer.

Suggestions are stored in `runtime/suggestions.sqlite`, independent of the
browser. Set `AMUNDSEN_GAME_DB` to choose another database path. Back up this file
with the server stopped or use SQLite's backup API. Source edits and browser
refreshes preserve the board. The API exposes the newest 200 ideas; older ideas
remain in SQLite.

## Add a minigame live

Create `static/minigames/my-game.js`:

```js
export const myGame = {
  title: 'Plankton hunt',
  mount(root, { complete }) {
    // Render controls into root, then call complete(points) after success.
    // Return a function that removes timers and global event listeners.
    return () => {};
  },
};
```

Import it in `static/minigames/registry.js`, add it to `minigames`, and change
one station's `game` to the matching registry key. Station coordinates are
normalized from 0 to 1. Keep station IDs stable to preserve saved progress.
Use `root.querySelector` for local controls, and return cleanup for animation
frames, timers, or listeners. The shell handles awarding points, saving progress,
and closing the dialog. Do not fetch runtime assets from the internet.

Reload the browser after an edit; static assets are served with `no-store`.
Adding or editing frontend minigames does not require a server restart.

Read suggestions directly during the meeting:

```sh
curl -s http://127.0.0.1:8050/api/suggestions | python3 -m json.tool
```

## Verify

```sh
python3 -m unittest discover -s tests -v
node --input-type=module --check < static/game.js
node --input-type=module --check < static/minigames/ctd.js
node --input-type=module --check < static/minigames/registry.js
```

The API tests use a temporary database and do not submit ideas to the live board.
Before the meeting, check sailing, CTD completion, restart, phone layout, and
submission from a second device in a real browser.

## Live crew development

Every idea gets its own `crew/...` branch, sibling worktree under
`/data/dev/amundsen-game-worktrees`, and independent headless `codex exec`
process. The coordinating session reviews and tests branches before merging
on `main`, which serves the live game.

```sh
python3 tools/crew.py status
python3 tools/crew.py start my-idea /path/to/brief.md
python3 tools/crew_watch.py          # Queue current board once
```

`amundsen-game-crew.service` currently watches the suggestion board every 15
seconds, launching at most three workers concurrently. It runs for the meeting;
it is not enabled at boot. The watcher continues after a chat turn ends. Workers
commit their branch and stop; they do not deploy or merge. Merges require the
coordinating session to be active. Logs, exact task briefs, process IDs, and final
reports are in `runtime/crew/<slug>/`. Failed runs stay visible for review and are
not retried automatically.

```sh
XDG_RUNTIME_DIR=/run/user/1000 systemctl --user stop amundsen-game-crew.service
```

Stopping the watcher prevents new runs; existing Codex workers continue their
assigned tasks. `AGENTS.md` carries the product voice, data-source rules, and
worker workflow. All requested data pulls use the underway server.
