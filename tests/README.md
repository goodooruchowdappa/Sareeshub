# Tests

## Database tests (`tests/db`)
Need any local Postgres 15+. The tests create a throw-away database, add a small stub of Supabase's `auth`/`storage` schemas and roles (`tests/db/supabase-stub.sql`), apply every migration, then call the API functions as anonymous, signed-in, admin and service-role users.

```sh
# default: postgresql://postgres:postgres@localhost:54329/postgres
TEST_PG_ADMIN_URL=postgresql://postgres:postgres@localhost:5432/postgres npm run test:db
```

No Postgres installed? `npx embedded-postgres` style setups work too; CI uses the `postgres:17` service container.

## End-to-end tests (`tests/e2e`)
Real Chrome against the real app. Supabase, Photon and Razorpay are replaced by `tests/mock/server.mjs`, which runs the **real SQL functions** on local Postgres with PostgREST-style role switching.

```sh
pip install playwright                 # uses your installed Chrome
tests/e2e/reset.sh                     # fresh db + demo shops + mock services on :54321
# .env needs: PUBLIC_SUPABASE_URL=http://localhost:54321  PUBLIC_SUPABASE_ANON_KEY=local-anon-key
#             PUBLIC_GEOCODER_URL=http://localhost:54321/photon  PUBLIC_MAP_STYLE=http://localhost:54321/style.json
#             SUPABASE_SERVICE_ROLE_KEY=local-service-key  RAZORPAY_KEY_ID=rzp_test_local
#             RAZORPAY_KEY_SECRET=local_rzp_secret  RAZORPAY_WEBHOOK_SECRET=local_webhook_secret
#             RAZORPAY_API_BASE=http://localhost:54321/razorpay
npm run dev                            # or: npm run build && npx wrangler dev (production build)
python3 tests/e2e/run.py               # APP_URL=http://localhost:8787 for the wrangler build
```

Screenshots land in `tests/.tmp/shots/`.
