# Fixo Web — Frontend

Next.js frontend for Fixo, an educational Indian-market research and paper-trading app.

## Deploy on Vercel
Import this repository, with **Root Directory `./`**.

- Framework: Next.js
- Build: `npm run build`
- Install: `npm install`
- Output: Next.js default (leave override disabled)

Set Vercel environment variables:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_FIXO_API_BASE_URL=https://fixo-9uf2.onrender.com`
- `AI_BASE_URL` (server-only)
- `AI_API_KEY` (server-only)

The FastAPI backend remains separately hosted at Render. This repo contains only the Next.js frontend and its server-side AI route; it does not contain the backend or database migrations.

Never prefix secrets with `NEXT_PUBLIC_`.
