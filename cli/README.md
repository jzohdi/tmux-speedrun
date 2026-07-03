# tmux-speedrun (CLI)

Run [tmux-speedrun](https://github.com/jzohdi/tmux-speedrun) challenges and practice drills against
**your own native tmux** — no browser emulation. Times are recorded to the shared leaderboard under
your verified GitHub username.

## Install

```bash
npm install -g tmux-speedrun
# or run without installing:
npx tmux-speedrun help
```

Requires **Node ≥ 20** and **tmux ≥ 3.0**. On Windows, run inside WSL (tmux is not native to Windows).

## Commands

```
tmux-speedrun help                 List commands
tmux-speedrun login                Sign in with GitHub (opens your browser)
tmux-speedrun logout               Clear the stored session
tmux-speedrun whoami               Show the signed-in GitHub username
tmux-speedrun leaderboard [id]     Show the leaderboard (all, or one challenge)
tmux-speedrun practice [category]  Practice tmux commands offline
tmux-speedrun challenge <id>       Run challenge 0–5 against native tmux
```

Global options: `--server <url>` (or `TMUX_SPEEDRUN_API`) to point at another API origin, `--json`
for machine-readable `leaderboard`/`whoami` output, `--no-color`, `--verbose`.

## Authentication

`tmux-speedrun login` opens your browser to the GitHub OAuth flow. On success the server hands a
verified session token back to the CLI over a **loopback redirect** (`127.0.0.1`), which is stored at
`~/.config/tmux-speedrun/session.json` (mode `0600`). The username attached to leaderboard entries is
always the server-verified GitHub identity — the CLI never supplies a username.

## Isolation guarantee

Every challenge and practice run spins up a **dedicated tmux server on a private socket**
(`tmux -L tmux-speedrun-<random>`) with its own generated config. All prompted commands run against
that isolated server, so a prompted `kill-session`/`kill-server` can **never** touch your real tmux
sessions. The isolated server is torn down on exit, interrupt (Ctrl-C), or crash.

## Practice mode

Practice mode is fully **offline** — the command drills are bundled, so no network or sign-in is
required.
