# Amundsen Expedition

An offline browser game and shared minigame suggestion board for collaborative
coding aboard the CCGS Amundsen. Python 3.10+ and Node.js 18+ for the shared
Hearts table; no runtime package install, build step, external fonts, map tiles,
or internet connection required.

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

- Click the chart to sail, or steer with WASD/arrows. Sailing uncovers the
  captain's chart and draws the voyage track. The sector uses 2 km cells from
  local GEBCO and shoreline data, rendered in tiles at the current screen scale.
  Older voyage saves migrate automatically, including mapped swaths.
- The bridge keeps the chart readings, ship status and craft controls in the first screen. Nearby, Fleet, Stores and Log tabs organize the right panel; detailed lists scroll within it. The welcome text hides after four seconds, and the header links back to `http://underway.local/`.
- Launch every operation anywhere using the three hands of activity cards under the map or keyboard shortcuts. Ice, aircraft ownership and active Maydays never gate a minigame.
  **C** opens the CTD notebook; **I** opens the ice-thickness transect; **3** opens
  Inuktitut, including the interactive syllabics guide (**L** inside the game).
- On the intranet, other players sail on the same main chart. **4** opens the
  icebreaker picker and **5** cycles the twelve vessels. Fleet positions update
  about once a second; the sharing checkbox hides your ship, and inactive ships
  expire after 15 seconds. Voyages, fuel and scores stay local. The public mirror
  runs without the presence relay.
- CTD: a random archived cast is drawn each launch. Lower the rosette to reveal
  temperature, salinity, oxygen, fluorescence and density curves, then begin the
  non-stop ascent and press Space or Fire bottle to catch as many of the listed
  layers as the bottles allow (fewer bottles than layers). Each layer keeps its
  best bottle, 100 at the layer falling to 0 at the reach distance; up to 400 a
  cast. Layer pressures appear only in the review. Retries are practice.
- Ice: drill with a 1 m Kovacs corer (D or tap). Ice thicker than the barrel
  needs pull (P), empty (E) and extend (X) runs. Each breakthrough adds to the
  transect chart; finish the transect to bank the points.
- Mapping earns 1 science point per 900 km² of newly mapped seabed, shared across ship and AUV surveys.
- Completed operations leave discovery marks at the ship's position and entries
  in the expedition log. There are no predetermined mission locations.
- Sailing maps the seabed in a depth-dependent multibeam swath and scores newly
  mapped cells. **G** launches the helicopter (hired from stores) to explore
  inland; **Y** launches the zodiac; **1** arms the AUV for a straight mapping run.
- Every logged operation leaves its own glyph on the chart (**2** toggles the
  legend). The 16 archive shipwrecks are marked: **V** picks one to steam to, and
  the survey starts once the ship is on the datum. Mayday calls appear at
  intervals and **X** answers from anywhere. Flooding and contamination alarms
  fire on their own now and then as well as on demand. The bridge reports charted
  ice near the ship or helicopter without restricting game launches.
- The ship burns diesel per km, more in ice. **U** bunkers at a community berth
  within 6 km or from the tanker M/T Nanny at her announced anchorage, for science
  points. Dry tanks mean a drift and a tow south to the start. **Q** opens the
  ship's stores: hull, tank, swath, winch upgrades and craft hire.
- Running aground costs the points of the last operation and returns the ship to
  safe water; the chart and log survive.
- The Leaderboard tab ranks career points and each operation's best run for
  players who sign the log in the ship card.
- Score, chart, track and discoveries are saved per browser. Restart clears that
  voyage; the crew's shared ideas stay on the server.
- Crew ideas opens a shared phone-friendly form and board, refreshed every five
  seconds. Names are optional; all ideas are visible to the crew. Each idea has a
  comment thread: teams iterate on an idea there, and a badge shows whether it is
  being built, in review, or in the game.

## Underway CTD profiles

`static/data/ctd/` holds original published cast JSON from
`/data/underway_server/www/data/casts/`. The manifest records source paths and
SHA-256 checksums. Refresh from the underway server with:

```sh
python3 tools/pull_ctd.py --leg 2026_LEG_03
```

Units and measurement arrays are preserved. Layer detection applies a ±2 dbar
median filter within finite, contiguous segments. Maxima/minima can occur at
segment edges, and tied extrema are all accepted. Pycnocline targeting finds
the largest positive Sigma-t change over 6–8 dbar. Missing values and pressure
gaps break the curves and the gradient calculation. Scoring decreases from 100
at the target to zero at a 20 dbar error. Source profiles, methods and results
are testable in `tests/test_ctd.mjs`.

Suggestions and comments are stored in `runtime/suggestions.sqlite`, independent of the
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

Import it in `static/minigames/registry.js`, add it to `minigames`, and add an
`activities` entry with `id`, `title`, `description`, and a unique keyboard `key`.
The activity ID must match its `minigames` key. The shell creates its launch
button and shortcut automatically.
Use `root.querySelector` for local controls, and return cleanup for animation
frames, timers, or listeners. Call `complete(points, detail)` once; `detail.title` names the discovery log entry.
The shell handles awarding points, recording discoveries, saving progress,
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
node --test tests/*.mjs
```

The API tests use a temporary database and do not submit ideas to the live board.
Before the meeting, check sailing, CTD completion, restart, phone layout, and
submission from a second device in a real browser.

## Live crew development

Every idea gets its own `crew/...` branch, sibling worktree under
`/data/dev/amundsen-game-worktrees`, and independent headless worker process.
The saved worker preference selects Claude Code or Codex. `--worker` overrides
it for an individual start or resume. Usage/session limits automatically switch
tools in the same worktree, preserving partial changes and commits. The alternate
tool becomes the preference for subsequent jobs. Each tool is tried at most once
per launch; if both are limited, the run stops with status `limited`. Other errors
keep the Claude model fallback but do not trigger a cross-tool retry. The coordinating session reviews and
smoke-checks branches before merging on `main`, which serves the live game.

```sh
python3 tools/crew.py status
python3 tools/crew.py switch codex    # Prefer Codex, or use claude
python3 tools/crew.py switch --fallback off  # on enables automatic switching
python3 tools/crew.py resume my-idea --worker codex
python3 tools/crew.py start my-idea /path/to/brief.md
python3 tools/crew.py start my-idea /path/to/brief.md --worker codex
python3 tools/crew_watch.py --triage # Read requests and pending scope decisions
python3 tools/crew_watch.py --route 25 --scope world \
  --outcome 'Mapping earns fewer points and ship upgrades cost thousands in the existing stores' \
  --files static/exploration.js static/game.js
python3 tools/crew_watch.py          # Queue scoped, eligible requests once
```

`amundsen-game-crew.service` currently watches the suggestion board every 15
seconds, launching scoped requests with no concurrency cap. The coordinator first
reads the submission and feedback, traces the affected player flow, and records
`minigame`, `world`, or `integration` scope with an acceptance outcome and allowed
files. There is no default minigame route. Routing records in
`runtime/crew-routing/` are tied to the exact request and comments; new feedback
requires another scope decision. `--route` makes an eligible request available to
the running watcher immediately; it does not replace or restart existing work.
Comments after a merged run can then start a scoped revision. Unmerged or failed
runs remain for coordinator review. Workers report `SCOPE_BLOCKED` when their
allowed files cannot deliver the requested outcome. The coordinator checks that
outcome before accepting a branch. The watcher runs for the meeting;
it is not enabled at boot. The watcher continues after a chat turn ends. Workers
commit their branch and stop; they do not deploy or merge. Merges require the
coordinating session to be active. Logs, exact task briefs, process IDs, and final
reports are in `runtime/crew/<slug>/`. Failed runs stay visible for review and are
not retried automatically once the bounded fallback is exhausted. Settings live
in `runtime/crew/worker.json`; per-attempt event logs and reports stay in each
run directory. Switching affects new/resumed jobs, not an already-running process.

```sh
XDG_RUNTIME_DIR=/run/user/1000 systemctl --user stop amundsen-game-crew.service
```

Stopping the watcher prevents new runs; existing workers continue their
assigned tasks. `AGENTS.md` carries the product voice, data-source rules, and
worker workflow. All requested data pulls use the underway server.

## Public game mirror

https://cryomics.org/underway/game/ serves the committed game, including world
terrain and minigame data. Progress stays in each browser. The public edition
hides the ship's crew board and shared leaderboard and makes no API requests.
Crew names, submissions, comments, scores, databases and worker logs stay aboard.

```sh
python3 tools/publish_game.py                # Ship → grid → DreamHost
python3 tools/publish_game.py --stage-only   # Prepare the local public copy
```

The export includes only `HEAD:static`. Its `site.js` enables public mode and
`release.json` records the revision. The staged copy at
`/data/underway_server/www/game/` also travels with the existing underway mirror.
The game's user publish timer runs every five minutes and shares grid's existing
publish lock. It deploys only the game subtree. Mutable assets revalidate; the
compressed world data retains its gzip bytes for browser decompression.

## Card games and crew tables

The fourth activity hand (♦) lists Hearts, Cribbage, Euchre, Gin Rummy, Spades,
Poker and Solitaire individually. Hearts is playable; the other cards open the
shared lobby with that game selected and marked coming soon. Shortcut **9**
opens Hearts. The lobby lists tables with player names, game and available seats;
players join directly, without entering a code. A saved seat has a Return button.

Create a Hearts table and wait for shipmates, or use **Invite @crew** to fill
empty seats. Seat menus choose Cap’n Barnacle, Doc, Ada or Polly; a human can
replace a crew seat before dealing. Crew use Parlour's local policies: Doc and
Polly easy, Cap’n medium, Ada hard. They see only their own hand and public play.
All players share standard Hearts scoring, lowest score wins when someone
reaches 100. Crew confirm the next hand automatically; humans confirm themselves.

Table conversation uses the ship's resident AI model and the underway crew
personas (snapshot from AMUNDSEN/dashboard/chatbot.py). Address `@crew` for all
four, or `@capn`, `@doc`, `@ada`, `@polly`. Replies use only the public score,
played cards and table conversation. The Python worker reads
`~/.config/underway/chat-model.json`, checks the model is resident, and makes
local completion requests. It does not load models or change the underway chat.
Generation runs separately from moves, one table-conversation job at a time.

The game server validates moves with the vendored Parlour engine and returns
only the requesting player's hand. Tables survive server restarts in
`runtime/hearts.json`; set `AMUNDSEN_HEARTS_DB` for an isolated store. Set
`AMUNDSEN_HEARTS_NODE` if Node is outside the server PATH. The Python service owns
the bundled Node child. Closing the operation or reloading the same browser tab
preserves the seat. No public relay or CDN is needed for gameplay.

Upstream versions, licenses and rebuild instructions:
[vendor/parlour/README.md](vendor/parlour/README.md).
