# Movie Memory

Sign in with Google, tell the app your favorite movie, and it shows you a fun fact about it from OpenAI. This is my take-home for the full-stack exercise.

Stack: TypeScript, Next.js 16 (App Router), React, Tailwind, Postgres, Prisma 7, Auth.js with Google, and the OpenAI API. I used Zod for validation and Vitest for tests.

## Which variant I chose and why

Variant A, the backend one. The parts of this app that can actually go wrong are the backend ones: two tabs asking for a fact at the same time, OpenAI being slow or down, and one user seeing another user's data. I'd rather spend my three hours getting those right than on client state. It also keeps the interesting logic in one place, `src/lib/facts/getFact.ts`, which is easy to test and easy to talk through.

## Setup instructions

None of my credentials are in the repo, so you'll need your own.

**Google OAuth client** (about 10 minutes):

1. In Google Cloud Console, open Google Auth Platform and set up the consent screen. Choose External, any app name, and your email as the support contact.
2. Under Audience, add your own Google account as a test user. If you skip this, sign-in fails with "Access blocked".
3. Under Clients, create a Web application client with this redirect URI: `http://localhost:3000/api/auth/callback/google`
4. Keep the client ID and secret handy for the `.env` file.

**Also needed:** an OpenAI API key with a little credit on it (a fact costs a fraction of a cent), Node 22 or newer, and Docker. Keep port 3000 free, because the redirect URI uses it. If you have to use another port, add that port's redirect URI in Google too, or you'll get `redirect_uri_mismatch`.

Then:

```bash
git clone https://github.com/Samarth-VP/movie-memory.git
cd movie-memory
cp .env.example .env        # fill in the values, see below
npm install
docker compose up -d        # Postgres on port 5432
npx prisma migrate deploy   # creates the tables
npm run dev                 # http://localhost:3000
```

Create `.env` before `npm install`, since the install runs `prisma generate`. If something else is already using port 5432, change the port in `docker-compose.yml` and in `DATABASE_URL`.

## Required environment variables

- `DATABASE_URL`: Postgres connection string. The default in `.env.example` matches `docker-compose.yml`.
- `AUTH_SECRET`: signs the Auth.js cookies. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`: from your Google OAuth client.
- `OPENAI_API_KEY`: your OpenAI key. It's only used on the server.
- `OPENAI_MODEL` (optional): defaults to `gpt-5.4-mini`.
- `TEST_DATABASE_URL` (optional): overrides the test database. Its name has to end in `_test`.

Nothing here uses the `NEXT_PUBLIC_` prefix, so none of it reaches the browser. `.env` is gitignored and `.env.example` only has names.

## Database migration steps

Migrations are in `prisma/migrations/`. To set up a fresh database, run `npx prisma migrate deploy`. If you change `prisma/schema.prisma`, run `npx prisma migrate dev --name <what changed>` and then `npx prisma generate`. The generated client lives in `src/generated/` and isn't committed; `npm install` regenerates it.

## Tests

The tests run against a real Postgres database, separate from the dev one, because the thing I most wanted to test is a database lock and a mocked database can't tell me anything about that.

```bash
docker compose exec db psql -U postgres -c "CREATE DATABASE movie_memory_test;"
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/movie_memory_test" npx prisma migrate deploy
npm test
```

The test setup refuses to run unless the database name ends in `_test`, since the tests delete rows. There are 23 tests. They cover the 60 second cache (59 seconds hits, 60 seconds misses), five simultaneous requests producing one OpenAI call, the fallback when OpenAI fails, users not being able to see each other's facts, the rate limit, movie validation, and friendly errors when a database write fails.

To check the concurrency test wasn't passing by accident, I commented out the lock and ran it again. It failed with five OpenAI calls instead of one. With the lock back, it passes.

## Architecture overview

### How a request flows

Login goes landing page, Google, Auth.js callback, then `/dashboard`. The dashboard checks whether the user has a favorite movie yet. If not, it sends them to `/onboarding`. That one check is the whole first-time versus returning logic. If you visit `/dashboard` signed out, you're sent back to `/`, which is the landing page with the sign-in button.

Onboarding and the Change button on the dashboard both call a server action. It checks the session again, validates the title with Zod (trimmed, 1 to 100 characters), and updates the signed-in user's row.

For facts, the dashboard's `FactCard` calls `GET /api/fact`. The route checks the session (401 if there isn't one), reads the user's movie from the database, and hands off to `getFact`.

### Code layout

Pages and routes in `src/app` stay thin: they check who's signed in and call something. The real logic is in `src/lib/facts/getFact.ts`. It takes the OpenAI call and a clock as arguments and knows nothing about HTTP, so the tests can pass in a fake generator and move time forward by hand instead of waiting 60 seconds. The rest of `src/lib` is small wrappers: `auth.ts`, `db.ts`, `openai.ts`, `session.ts` (who is the current user) and `validation.ts`.

### Data model

`User` has the Google profile fields plus a nullable `favoriteMovie`. Null means onboarding hasn't happened, so I don't need a separate flag that could get out of sync.

`Fact` is an append-only history: `userId`, `movieTitle`, `content`, `createdAt`. The cache only ever asks for the newest fact for one user and movie, so there's an index on `(userId, movieTitle, createdAt desc)` to match. Deleting a user deletes their facts.

`Account`, `Session` and `VerificationToken` are the standard tables the Auth.js Prisma adapter expects. I used database sessions, so each login is a row.

### Generating a fact

`getFact` runs in one database transaction:

1. It takes a Postgres advisory lock keyed on the user and the movie. Anyone else asking for the same pair waits here. The lock goes away when the transaction ends.
2. Only after getting the lock, it looks for the newest fact for that user and movie. If it's under 60 seconds old, that's the answer.
3. Next is the rate limit: if the user already generated 10 new facts in the last 10 minutes (across all movies), it stops here. Cache hits don't create rows, so they don't count.
4. Otherwise it calls OpenAI (10 second timeout, no automatic retries), saves the fact and returns it.
5. If anything in steps 1 to 4 fails, it returns the newest fact it has for that movie, marked as stale, so the page can say it's an earlier one. If there isn't one, the route returns a friendly error (502, or 429 for the rate limit).

The cache check has to come after the lock. If two requests both checked first and locked second, both would see an empty cache and both would call OpenAI. With the lock first, the second request waits, then finds the first request's fact when it checks.

```mermaid
sequenceDiagram
    participant A as Tab A
    participant B as Tab B
    participant DB as Postgres
    participant O as OpenAI
    A->>DB: begin transaction, take advisory lock
    B->>DB: begin transaction, take advisory lock
    Note over B,DB: B waits while A holds the lock
    A->>DB: newest fact for this user and movie?
    DB-->>A: none, or older than 60 seconds
    A->>O: generate a fact
    O-->>A: fact text
    A->>DB: insert fact, commit, lock released
    DB-->>B: lock acquired
    B->>DB: newest fact for this user and movie?
    DB-->>B: A's fact, a few seconds old
    Note over B: fresh enough, return it without calling OpenAI
```

### Security

The user always comes from the session. `/api/fact` takes no parameters (the movie comes from the database), and the edit action doesn't take a user id, so there's nothing in a request to change to reach someone else's data. Every query is scoped to the session's user.

Movie input is validated on the server only. The forms have no browser-side rules on purpose, so there's one place that decides what's valid.

The movie title goes into an LLM prompt, so I treat it as data: whitespace is collapsed, it goes in its own field, and the instructions tell the model it's just a title. The 100 character limit also caps what anyone can put in there.

Secrets only exist as server-side environment variables. OpenAI errors are logged on the server and the browser gets a generic message. A missing Google photo shows an initial in a circle, and a missing name falls back to the part of the email before the `@`.

## Key tradeoffs

Advisory lock versus the alternatives: a unique constraint per minute doesn't match "newest fact is under 60 seconds old", since that's a rolling window, and an in-memory lock only works inside one server process. A database lock works across tabs and across servers.

The cost of that choice is that the transaction holds a database connection while it waits on OpenAI. That's fine at this size. With real traffic I'd use a short in-progress marker instead of holding the connection.

If the first request fails, each waiting request tries OpenAI on its own, so a long outage could push waiters into the 15 second transaction timeout. The stale fallback still catches that.

The rate limit is soft. The lock is per user and movie, so simultaneous requests for different movies can overshoot it slightly. A strict limit would need a second per-user lock. I wanted cost protection, not exact accounting, so I kept it simple.

`createdAt` is written from the app's clock, the same clock used for the freshness check, so they always agree and tests can fake time. With several servers I'd use the database clock.

I used database sessions rather than JWT. It costs one extra query per request, but sessions can be revoked and it's simpler to reason about. I also didn't use a middleware or proxy file. Each page checks the session itself, so there's no separate gate that could drift out of sync.

Facts are append-only, which keeps history and keeps the concurrency logic simple (requests only insert), but the table grows forever without a cleanup job.

Editing the movie is plain save-then-refresh. Optimistic updates belong to Variant B, so I left them out.

## Known limits

- The model can state false facts. The prompt tells it to say so when it isn't sure, but that only helps so much.
- The cache is per user and movie, so switching movies repeatedly goes around it. The rate limit caps the cost.
- Titles aren't normalized, so "inception" and "Inception" cache separately.
- I didn't write browser tests for the UI or the Google login. I tested those by hand.

## What I would improve with 2 more hours

- Use the database clock for the freshness checks.
- Replace the held transaction with an in-progress marker, and add a test that runs out the connection pool.
- Make the rate limit strict with a per-user lock.
- Ground the facts in a movie database like TMDB to cut down on made-up ones.
- Add a component test for `FactCard` and a Playwright test for the login flow.
- Normalize titles and clean up old facts.
- Run migrations and tests in GitHub Actions on every push.

## References

Documentation and articles behind the main decisions:

**Postgres**
- [Advisory locks, in the explicit locking chapter](https://www.postgresql.org/docs/current/explicit-locking.html): how `pg_advisory_xact_lock` works and when it is released
- [Transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html): why a waiting request sees the first request's committed fact (READ COMMITTED is the default)

**Prisma**
- [Transactions and batch queries](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions): interactive transactions, the `timeout` and `maxWait` options, and the default isolation level
- [Using Prisma with Next.js](https://www.prisma.io/docs/guides/frameworks/nextjs): Prisma 7 setup, the generator output path and the driver adapter

**Auth.js**
- [Prisma adapter](https://authjs.dev/getting-started/adapters/prisma): the standard tables I used
- [Adapters reference](https://authjs.dev/reference/core/adapters): session strategies (database versus JWT)

**OpenAI**
- [Models](https://developers.openai.com/docs/models): picking a smaller, cheaper model for a short fact

**Google**
- [OAuth app publishing status and verification](https://support.google.com/cloud/answer/10311615): why reviewers need to be test users on their own client

**Articles**
- [Advisory locks guide (Netguru)](https://www.netguru.com/codestories/advisory-locks): why to prefer the transaction-level variant
- [Advisory locks to stop double processing (AppMaster)](https://appmaster.io/blog/postgresql-advisory-locks-double-processing): the duplicate-request problem the lock solves

## AI usage

- **Planning:** I used Claude to break the project into small steps and to work out the approach. It proposed the design (the backend variant, the schema, and an advisory lock for the concurrent-request problem). I went through the options and tradeoffs, asked it to explain the parts I wasn't sure about, and then chose to go with it.
- **Boilerplate and code:** Claude drafted the boilerplate (scaffold, Prisma schema, auth setup) and most of the code. I applied it one step at a time through Claude Code, with a fixed spec for each step, and ran the build and tests in between.
- **Review:** Claude checked the result against the exercise's requirements and pointed out weak spots as we went. That's where the rate limit and the better error handling came from.
- **Tests:** Claude wrote the test cases and I ran them. To check that the concurrency test actually protects the lock, I commented the lock out myself, confirmed the test failed with five OpenAI calls instead of one, then put the lock back.
- **Debugging:** when things broke, Claude helped me work out why. Examples: a Vitest dependency conflict with `@types/node`, a Next.js build error caused by Cache Components, and a stuck git commit.
- **What to test:** after each feature, Claude gave me a checklist of what to try, and I ran those checks by hand (the login flow, validation, the missing Google photo, and the cache).
- **My own decisions:** building it step by step so I understood each piece, choosing Variant A, adding the option to change the favorite movie, and leaving out extra features.
- No secrets are in the repo. They live in `.env`, which is gitignored.
