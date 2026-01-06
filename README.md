# tmux-speedrun

Practice tmux keybindings through timed challenges. 

## Resources

https://paul.af/tmux-101
https://github.com/tmux/tmux/wiki/Getting-Started

![tmux-speedrun screenshot](static/og-image.png)

## What is this?

I built this to help myself learn tmux. This is a browser-based game for practicing tmux muscle memory. Get a prompt ("split the pane horizontally"), and hit the right keys. It's like typing tests, but for tmux. The goal is to practice freely.

## Quick Start

```bash
# Install dependencies
pnpm install

# Start the dev server
pnpm dev
```

Open http://localhost:5173 and type `help` in the terminal to see available commands:

- `tsr ls` — list available challenges
- `tsr start <id>` — start a challenge (0-5)
- `man tmux` — command reference
- `free-play` — practice without a timer

## How Challenges Work

Each challenge consists of a series of prompts. You need to execute the correct tmux command for each one. Steps are encrypted and unlocked sequentially, so you can't skip ahead.

**The flow:**
1. Client and server do an ECDH key exchange
2. Server generates all steps, encrypts them with chained keys (each step's key depends on the previous step's answer)
3. You solve step N, derive the key for step N+1, decrypt it locally
4. No server roundtrips during gameplay—pure client-side decryption
5. At the end, you submit a cryptographic proof that you solved everything

This isn't bulletproof anti-cheat, but it prevents trivial scraping of answers.

## Tech Stack

- **Frontend:** Svelte 5 + TypeScript, Tailwind CSS
- **Backend:** SvelteKit server routes
- **Database:** PostgreSQL via Drizzle ORM (supports local Postgres and Neon serverless)
- **Crypto:** Web Crypto API (ECDH P-256, HKDF-SHA256, AES-GCM)
- **Testing:** Vitest

## Database Setup

For local development:

```bash
# start
docker-compose up -d

# - User: tmux
# - Password: tmux  
# - Database: tmux_speedrun
# - Port: 5432

# stop
docker-compose down

# total fresh reset
docker-compose down -v && docker-compose up -d
```

## Environment Variables

`.env`

```
DATABASE_URL=postgresql://tmux:tmux@localhost:5432/tmux_speedrun
SESSION_SECRET=your-32-char-secret-for-cookies
```

The app auto-detects Neon URLs and switches to the serverless driver.

## Project Structure

```
src/
├── lib/
│   ├── client/          # Challenge session management
│   ├── components/      # Svelte components
│   │   └── tmux/        # Terminal emulator components
│   ├── crypto/          # ECDH, HKDF, AES-GCM helpers
│   ├── data/            # Challenge definitions, keybindings
│   ├── server/          
│   │   ├── challenges/  # Step generation, encryption
│   │   └── db/          # Drizzle schema
│   ├── stores/          # Tmux state management
│   └── utils/           # Pane tree, command execution
├── routes/
│   ├── api/challenge/   # /start and /finish endpoints
│   ├── challenge/[id]/  # Challenge UI
│   └── free-play/       # Practice mode
└── static/              # Favicon, OG image
```

## Challenge Levels

| Level | Instructions | Difficulty |
|-------|-------------|------------|
| 0     | 25          | Beginner   |
| 1     | 40          | Intermediate |
| 2     | 55          | Intermediate |
| 3     | 70          | Advanced   |
| 4     | 85          | Advanced   |
| 5     | 100         | Advanced   |

## Keyboard Notes

Some browser shortcuts can't be overridden (Ctrl+W, Ctrl+T, etc.). The default tmux prefix is backtick (`) to avoid conflicts. Prefix mode works like real tmux—hit the prefix, then the command key within the timeout window.

## Scripts

```bash
pnpm dev          
pnpm build      
pnpm preview 
pnpm test
pnpm check        # ts check
pnpm lint         # eslint/prettier
pnpm db:push      # see drizzle docs for more 
pnpm db:generate  # 
pnpm db:studio
```

## License

MIT
