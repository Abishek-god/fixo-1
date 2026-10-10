# Fixo — AI Finance & Paper Trading

Fixo is an educational Indian-market research and paper-trading platform. It simulates orders only and never connects to a brokerage account.

## Architecture

- Web: Next.js 15, React, TypeScript, Supabase Auth.
- Database: Supabase PostgreSQL with row-level security, user portfolios, positions, market quotes, order history, and watchlists.
- Backend: FastAPI, yfinance, and Supabase REST/RPC. The backend validates Supabase access tokens, fetches quotes server-side, and delegates atomic order execution to PostgreSQL.
- AI: Supabase Edge Function fixo-ai calls an OpenAI-compatible provider server-side (Alibaba Cloud Model Studio by default) with model fallback.
- Frontend hosting: Vercel. Run FastAPI on a Python container host such as Railway or Render.

## Implemented core

- Email/password sign-in and account creation.
- A per-user paper portfolio initialized with ₹1,00,000 virtual cash.
- Indian market quote and historical-data endpoints using Yahoo Finance symbols.
- Buy/sell simulation with fresh quote checks, cash/position validation, row locking, average-cost accounting, and order ledger.
- Per-user watchlist stored in Supabase with RLS.
- Portfolio positions, virtual cash, indicative unrealized P&L, and recent orders.
- AI chat with selectable configured model IDs and server-side API key handling.

## Local setup

### 1. Supabase

Create a dedicated Supabase project for Fixo. Do not apply the migration to an unrelated project. In the Fixo project's SQL editor, run the file at supabase/migrations/202610100001_fixo_core.sql or apply it through your migration workflow. Confirm email/password authentication is enabled. The migration creates the portfolio automatically when a new auth user is created.

Copy the project URL and publishable key from Supabase settings.

### 2. Web app

Install Node dependencies, copy .env.example to .env.local, then run npm run dev. Open http://localhost:3000.

Set these values in .env.local:

    NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
    NEXT_PUBLIC_FIXO_API_BASE_URL=http://localhost:8000
    AI_BASE_URL=https://YOUR_MODEL_STUDIO_ENDPOINT/compatible-mode/v1
    AI_API_KEY=your_alibaba_model_studio_api_key

The AI provider credentials should be stored as Supabase Edge Function secrets (not browser/Vercel public variables) once using the Edge Function path below. Never prefix secret keys with NEXT_PUBLIC_.

### 3. FastAPI

    cd backend
    python -m venv .venv
    # Windows PowerShell: .venv\\Scripts\\Activate.ps1
    # macOS/Linux: source .venv/bin/activate
    pip install -r requirements.txt
    cp .env.example .env
    uvicorn app.main:app --reload --port 8000

Set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in backend/.env. The service-role key must remain server-only and must never be placed in Vercel public variables or committed to Git. Set CORS_ORIGINS to the exact local and deployed web origins.

Test GET http://localhost:8000/health, GET /api/market/symbols, and GET /api/market/quotes?symbols=RELIANCE,TCS.

Yahoo Finance data is unofficial and may be delayed, rate-limited, incomplete, or unavailable. It is not a guaranteed real-time exchange feed. Do not use it for real-money execution.

## Deployment

1. Deploy backend/ as a Python service with the included Dockerfile. Configure the backend's three Supabase variables and CORS origins.
2. Apply the SQL migration to the dedicated Fixo Supabase project and verify the RLS policies.
3. Link Abishek-god/fixo to a Vercel project. Configure NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_FIXO_API_BASE_URL, AI_BASE_URL, and AI_API_KEY for Production and Preview as needed.
4. Redeploy after adding environment variables.
5. Verify signup, email confirmation, login, quotes, buy/sell, insufficient cash/quantity rejection, order history, watchlist persistence, and AI response.


### 4. Supabase AI Edge Function

The frontend invokes supabase.functions.invoke("fixo-ai", ...). The function keeps the AI provider key server-side and checks the signed-in user's Supabase session.

1. Deploy supabase/functions/fixo-ai/index.ts to your Fixo Supabase project.
2. In Supabase Dashboard → Edge Functions → Secrets, set AI_BASE_URL (your provider's OpenAI-compatible base URL ending in /v1, using the correct workspace and region) and AI_API_KEY (the provider API key).
3. Ensure JWT verification is enabled. supabase/config.toml sets verify_jwt = true.
4. A GET request to the function URL returns model/task metadata; POST requires a valid Supabase user bearer token.

Function URL format:

    https://YOUR_PROJECT_REF.supabase.co/functions/v1/fixo-ai

Replace YOUR_PROJECT_REF with the project ref for the dedicated Fixo Supabase project. Do not use the clouddrive project unless that is intentionally the project you want Fixo to use.

CLI deployment from the repository root:

    supabase login
    supabase link --project-ref YOUR_PROJECT_REF
    supabase secrets set AI_BASE_URL=https://YOUR_MODEL_STUDIO_ENDPOINT/compatible-mode/v1 AI_API_KEY=YOUR_PROVIDER_KEY
    supabase functions deploy fixo-ai

Do not commit provider keys or paste them into client-side code.

## API endpoints

- GET /health
- GET /api/market/symbols
- GET /api/market/quotes?symbols=RELIANCE,TCS
- GET /api/market/history/RELIANCE?period=1mo
- GET /api/portfolio (Supabase bearer token required)
- POST /api/orders with JSON {"symbol":"RELIANCE","side":"buy","quantity":1} (bearer token required)
- GET /api/watchlist (bearer token required)

## Security and product limits

- All user-owned tables use RLS. User-specific portfolio reads are scoped to the authenticated user.
- Trade execution is a PostgreSQL transaction and obtains the current quote from the database, not a client-supplied price.
- The FastAPI service-role key is server-only. Browser requests use the user's Supabase access token.
- Protect the AI route with authentication and rate limiting before exposing it publicly to prevent abuse and unexpected model costs.
- The UI is for education only. Unrealized P&L is indicative and excludes fees, taxes, slippage, and corporate actions.
