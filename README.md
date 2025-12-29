# tmux-speedrun

Practice tmux keybindings through timed challenges. Race against the clock, learn commands, and see how fast you can go.

![tmux-speedrun screenshot](static/og-image.png)

## What is this?

A browser-based game for drilling tmux muscle memory. You get a prompt ("split the pane horizontally"), you hit the right keys, and the clock is ticking. It's like typing tests, but for tmux.

The terminal you see isn't real—it's a DOM-based simulation that handles pane splits, window management, and tmux's prefix-mode behavior. The goal is to get you practicing without needing to SSH anywhere or worry about messing up your actual sessions.

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

Each challenge consists of a series of prompts. You need to execute the correct tmux command for each one. The twist: steps are encrypted and unlocked sequentially, so you can't skip ahead.

**The flow:**
1. Client and server do an ECDH key exchange
2. Server generates all steps, encrypts them with chained keys (each step's key depends on the previous step's answer)
3. You solve step N, derive the key for step N+1, decrypt it locally
4. No server roundtrips during gameplay—pure client-side decryption
5. At the end, you submit a cryptographic proof that you solved everything

This isn't bulletproof anti-cheat (it's a casual game), but it prevents trivial scraping of answers.

## Tech Stack

- **Frontend:** Svelte 5 + TypeScript, Tailwind CSS
- **Backend:** SvelteKit server routes
- **Database:** PostgreSQL via Drizzle ORM (supports local Postgres and Neon serverless)
- **Crypto:** Web Crypto API (ECDH P-256, HKDF-SHA256, AES-GCM)
- **Testing:** Vitest

## Database Setup

For local development:

```bash
# Start PostgreSQL in Docker
docker-compose up -d

# The database is auto-initialized with:
# - User: tmux
# - Password: tmux  
# - Database: tmux_speedrun
# - Port: 5432

# Stop
docker-compose down

# Reset (removes data)
docker-compose down -v && docker-compose up -d
```

## Environment Variables

Create a `.env` file:

```
DATABASE_URL=postgresql://tmux:tmux@localhost:5432/tmux_speedrun
SESSION_SECRET=your-32-char-secret-for-cookies
```

For Neon: use your connection string from the dashboard. The app auto-detects Neon URLs and switches to the serverless driver.

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
pnpm dev          # Development server
pnpm build        # Production build
pnpm preview      # Preview production build
pnpm test         # Run tests
pnpm check        # TypeScript check
pnpm lint         # ESLint + Prettier
pnpm db:push      # Push schema to database
pnpm db:generate  # Generate migrations
pnpm db:studio    # Open Drizzle Studio
```

## Contributing

PRs welcome. The main areas that could use work:
- More challenge variety
- Leaderboard UI
- GitHub OAuth for profiles
- Additional tmux commands

## License

MIT
