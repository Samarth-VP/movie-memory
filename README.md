# Movie Memory

A small full-stack app: sign in with Google, tell it your favorite movie, and get a fun fact about it from OpenAI. Built for the full-stack take-home exercise.

**Stack:** TypeScript, Next.js 16 (App Router), React, Tailwind, Postgres, Prisma 7, Auth.js (Google OAuth), OpenAI API, Zod, Vitest.

## Variant chosen: A (backend-focused)

I picked Variant A because the interesting problem here is correctness: two tabs shouldn't generate two facts, an OpenAI outage shouldn't break the page, and one user must never see another user's data. That is a backend and data-modeling problem I can reason about end to end, and the core of it fits in one small, testable module (`src/lib/facts/getFact.ts`) instead of being spread across client state, an API layer and UI tests.

## Setup instructions

### Before you start

No credentials are included in the repo, so you'll need your own:

- **Google OAuth client** (about 10 minutes). In Google Cloud Console, open Google Auth Platform:
  1. Configure the consent screen: user type **External**, any app name, your email as the support contact.
  2. Under **Audience**, add **your own Google account as a test user**. Without this, sign-in fails with "Access blocked".
  3. Under **Clients**, create a client of type **Web application** with the authorized redirect URI `http://localhost:3000/api/auth/callback/google`.
  4. Copy the client ID and secret for the `.env` file below.
- **OpenAI API key** with a small balance (a fact costs a fraction of a cent).
- **Node 22 or newer**, and **Docker** running.
- **Port 3000 free.** The redirect URI above uses it. If you must use another port, add that port's redirect URI in Google as well, otherwise login fails with `redirect_uri_mismatch`.

### Install and run

```bash
git clone https://github.com/Samarth-VP/movie-memory.git
cd movie-memory
cp .env.example .env        # then fill in the values (see the table below)
npm install
docker compose up -d        # local Postgres on port 5432
npx prisma migrate deploy   # create the tables
npm run dev                 # http://localhost:3000
```

Create `.env` before `npm install`: the install step runs `prisma generate`, which loads the Prisma config. If port 5432 is already taken, change the port mapping in `docker-compose.yml` and in `DATABASE_URL`.

## Required environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string (the default in `.env.example` matches `docker-compose.yml`) |
| `AUTH_SECRET` | yes | Signs Auth.js cookies. Generate one: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `AUTH_GOOGLE_ID` | yes | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | yes | Google OAuth client secret |
| `OPENAI_API_KEY` | yes | OpenAI API key (server-side only) |
| `OPENAI_MODEL` | no | Defaults to `gpt-5.4-mini` |
| `TEST_DATABASE_URL` | no | Overrides the test database; its name must end in `_test` |

None of these use the `NEXT_PUBLIC_` prefix, so nothing secret reaches the browser. `.env` is gitignored, and `.env.example` lists names only.

## Database migration steps

Migrations live in `prisma/migrations/`.

- Apply them to a fresh database: `npx prisma migrate deploy`
- After changing `prisma/schema.prisma`: `npx prisma migrate dev --name <change>`, then `npx prisma generate`

The Prisma client is generated into `src/generated/` (gitignored), and `npm install` regenerates it.

## Tests

The tests run against a separate, real Postgres database, because the concurrency guarantee depends on a real database lock.

```bash
docker compose exec db psql -U postgres -c "CREATE DATABASE movie_memory_test;"
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/movie_memory_test" npx prisma migrate deploy
npm test
```

The test setup refuses to run unless the database name ends in `_test`, because the tests delete rows. The 23 tests cover:

- the 60-second cache window (59s hit, 60s miss, a separate cache per movie)
- five simultaneous requests producing exactly one OpenAI call
- the OpenAI-failure fallback (stale fact, or an error when nothing is cached)
- authorization: one user never receives another user's facts (as a cache hit or as a fallback), and the route returns 401 when signed out
- the per-user rate limit (blocked, window expiry, per-user isolation, stale fallback, and the 429 response)
- movie validation and update authorization (trimming, 100 vs 101 characters, signed-out and cross-user updates)
- friendly errors when the database fails inside the onboarding and edit actions

I also checked that the concurrency test is meaningful: with the lock line removed it fails (five OpenAI calls instead of one), and with the lock restored it passes.

## Architecture overview

### Request flows

- **Login:** landing page, then Google, then the Auth.js callback creates or finds the user and writes a session, then a redirect to `/dashboard`. The dashboard sends users with no favorite movie to `/onboarding`, so first-time versus returning is a single check in one place. A signed-out visit to `/dashboard` redirects to `/`, which is the landing page with the sign-in button.
- **Onboarding and editing:** a server action re-checks the session, validates the title with Zod (trimmed, 1 to 100 characters), and updates the signed-in user's row. Onboarding is first-time only: anyone who already has a movie is sent to the dashboard. The dashboard also has a simple Change/Save/Cancel flow that uses the same schema.
- **Fact:** the dashboard's `FactCard` calls `GET /api/fact`. The route checks the session (401 if none), reads the user's movie from the database, and calls `getFact`.

### Layers

```
src/app/**                    thin pages, server actions and one API route
src/lib/facts/getFact.ts      all fact logic: cache, lock, rate limit, fallback
src/auth.ts                   Auth.js: Google + Prisma adapter + database sessions
src/lib/db.ts                 Prisma client (one shared instance)
src/lib/session.ts            requireUser(): who is signed in, or redirect
src/lib/validation.ts         movie rules (Zod)
src/lib/openai.ts             the OpenAI call (10s timeout, no silent retries)
tests/                        23 tests against a real Postgres
```

`getFact` takes the generator function and a clock as arguments and knows nothing about HTTP, which is what makes it testable without calling OpenAI or waiting 60 real seconds.

### Data model

- `User`: Auth.js profile fields plus a nullable `favoriteMovie`. Null means onboarding isn't done, so there is no separate flag that could drift out of sync.
- `Fact`: append-only history (`userId`, `movieTitle`, `content`, `createdAt`) with an index on `(userId, movieTitle, createdAt desc)`, which is exactly the "newest fact for this user and movie" lookup the cache needs. Deleting a user cascades to their facts.
- `Account`, `Session`, `VerificationToken`: the standard Auth.js adapter tables. I use database sessions, so each login is a row and sessions can be revoked.

### Fact generation (the core of Variant A)

`getFact(userId, movieTitle, generate, now)` runs inside one database transaction:

1. **Lock.** `pg_advisory_xact_lock`, keyed on user and movie. Other requests for the same pair wait here. The lock is released automatically when the transaction ends.
2. **Cache check, after taking the lock.** If the newest fact for this user and movie is under 60 seconds old, return it. The check must happen after locking: a request that waited then sees the fact the previous request just committed (Postgres' default READ COMMITTED isolation reads fresh data on each statement).
3. **Rate limit.** Count the user's new facts in the last 10 minutes across all movies, and stop at 10. Cache hits create no rows, so they never count.
4. **Generate and store.** Call OpenAI (10 second timeout, no automatic retries), insert the fact, and return it.
5. **Failure.** If anything above throws, return the newest fact of any age for that user and movie, flagged `stale: true`. If there is none, throw an error. The route turns it into a friendly 502, or a 429 for the rate limit, with no internal details.

```mermaid
sequenceDiagram
    participant A as Tab A
    participant B as Tab B
    participant DB as Postgres
    participant O as OpenAI
    A->>DB: begin transaction, take advisory lock
    B->>DB: begin transaction, take advisory lock
    Note over B,DB: B waits, A holds the lock
    A->>DB: newest fact for this user and movie?
    DB-->>A: none, or older than 60 seconds
    A->>O: generate a fact
    O-->>A: fact text
    A->>DB: insert fact, commit, lock released
    DB-->>B: lock acquired
    B->>DB: newest fact for this user and movie?
    DB-->>B: A's fact, a few seconds old
    Note over B: fresh, so return it with no OpenAI call
```

### Security and authorization

- User identity only ever comes from the session. The fact route accepts no parameters (the movie is read from the database), and the edit action takes no user id, so there is nothing in a request to tamper with. Every query is scoped to the session's user id.
- Movie input is validated on the server. The forms deliberately have no browser-side rules, so the server is the single authority.
- The movie title ends up in an LLM prompt, so it is treated as data: whitespace is collapsed, it is passed in its own field, and the instructions tell the model it is only a title. The 100-character limit also bounds it.
- Secrets live only in server-side environment variables. OpenAI errors are logged on the server and never sent to the client.
- A missing Google photo falls back to an initial in a circle, and a missing name falls back to the part of the email before the `@`.

### Error handling

- OpenAI timeout or failure: the newest stored fact is shown with a "this is an earlier one" note, or a friendly error with a retry button if none exists.
- Rate limit: a plain "too quickly" message (HTTP 429), or the older fact if one exists.
- Expired session while on the dashboard: the fact card shows a "sign in again" link instead of a raw error.
- Database failure while saving a movie: a friendly message with the typed text kept. Anything unexpected during rendering shows an error page.

## Key tradeoffs

- **Advisory lock in a transaction versus the alternatives.** A fixed per-minute unique constraint doesn't match the "most recent fact is under 60 seconds old" rule (a rolling window), and an in-memory lock only works inside one process. The advisory lock lives in the database, so it works across tabs and server instances.
- **The transaction holds a database connection during the OpenAI call.** Fine at this scale. At high traffic I would switch to an "in progress" marker so connections aren't tied up waiting on a network call.
- **Waiters retry on failure.** If the first request fails, each waiting request makes its own OpenAI attempt, so a long outage can push waiters into the 15 second transaction timeout. The stale-fact fallback still catches that.
- **The rate limit is soft.** The lock is per user and movie, so simultaneous requests for different movies can overshoot slightly. Making it strict would need a second per-user lock. I kept the simpler version because the goal is cost protection, not exact accounting.
- **`createdAt` is written from the app's clock**, the same clock used for the freshness check, so they always agree and tests can fake time. With several app servers I would use the database clock instead.
- **Database sessions instead of JWT.** One extra query per request, in exchange for revocable sessions and a simpler mental model. I don't use middleware, so the edge-runtime limits around Prisma don't matter.
- **No middleware or proxy file.** Each page checks the session itself and is authoritative on its own, so there is no separate gate that could drift out of sync.
- **Append-only facts.** Keeps history and makes the concurrency logic simple (requests only insert), at the cost of the table growing without a cleanup job.
- **Edit movie is a plain save-then-refresh**, not optimistic UI, because optimistic updates with revert belong to Variant B and I chose A.
- **A plain `<img>` for the Google avatar** instead of `next/image`, to avoid allow-listing Google's image host for one picture.

## Known limits

- The model can state false "facts". The prompt tells it to admit uncertainty, but that is a mitigation, not a fix.
- The cache is per user and movie, so switching movies repeatedly bypasses it. The per-user rate limit bounds the cost.
- Titles aren't normalized, so "inception" and "Inception" cache separately.
- No browser-level tests of the UI or the Google login flow.

## What I would improve with 2 more hours

- Use the database clock for freshness checks instead of the app's.
- Replace "hold a transaction during the OpenAI call" with a short in-progress marker, plus a test that simulates the connection pool running out.
- Make the rate limit strict with a per-user lock.
- Ground facts in a movie database (for example TMDB) to reduce false facts.
- A component test for `FactCard` (loading, error, stale and expired states) and an end-to-end Playwright test of the login flow.
- Normalize movie titles, and add a cleanup job for old facts.
- A GitHub Actions workflow that runs migrations and the tests on every push.

## AI usage

- I used Claude (chat) to plan the project: scope, schema, file structure, and the choice of Variant A with the advisory-lock design. It also drafted the code, which I reviewed file by file before it went in.
- I used Claude Code to apply that code step by step in small chunks. Each step had a fixed spec (exactly these files, don't touch `.env`, stop and wait), and I checked the result before moving on.
- I tested the login flow, onboarding validation and the dashboard by hand, including a missing Google photo.
- I checked that the concurrency test is meaningful by removing the lock and confirming the test fails, then restoring it.
- Config changes I reviewed and can explain: turning off Next.js Cache Components (the dashboard reads per-user session data on every request) and aligning `@types/node` with Vitest's requirements.
- No secrets are in the repository. They live in `.env`, which is gitignored.
