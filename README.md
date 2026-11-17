# Planner (My Supp App), standalone version

Supplements, meals, workouts, cycle, progress and skincare planner with email logins.
Hosting is a plain static site on Vercel. Supabase handles accounts and saving, and one small server function handles the photo and PDF reading.

## Files

| File | What it is |
|---|---|
| `index.html`, `app.js` | The planner. Built from `source/planner.html` by `build.py`, so edit that file and run `python3 build.py`. |
| `config.js` | The Supabase **Project URL** and **publishable key**. Both are public. Never put the secret / service_role key here. |
| `auth.js`, `auth.css` | Log in, sign up, forgot password, new password, the profile sheet, and the saving layer (`window.claude.use(...)`) backed by Supabase. |
| `vendor/supabase.js` | supabase-js v2.58.0 (UMD build), kept in the repo so the app doesn't depend on a CDN. |
| `api/claude.js` | Vercel server function. Checks the Supabase login, applies an hourly limit per account, and calls Claude with the Anthropic key from the server's environment. |
| `supabase/setup.sql` | Run once in Supabase → SQL Editor. Safe to run again. |

## How saving works

* Every saved item is one row in `user_docs` (`path`, `doc_id`, `data`). Row-level security means each person only reads and writes their own rows.
* Each change is copied to the phone straight away (`localStorage["mysupp.cloud.<user id>"]`) and saved to Supabase 500 ms later. With no signal the change waits on the phone. It's saved when the connection comes back, when the app is reopened, or when it comes back into view.
* If the server refuses a change, the change is dropped and the account's real data is reloaded.
* Photos of labels, blood tests and products go to the private `uploads` bucket at `<user id>/…`. They're shown through links that expire after a day. Profile photos go to the public `avatars` bucket.
* Logging out saves anything pending, clears this account's copy on the phone, then signs out.

## Vercel environment variables

| Name | Value |
|---|---|
| `SUPABASE_URL` | Same Project URL as in `config.js` |
| `SUPABASE_PUBLISHABLE_KEY` | Same publishable key as in `config.js` |
| `ANTHROPIC_API_KEY` | From console.anthropic.com. Optional: without it the app works, but the photo and PDF reading buttons are hidden. |
| `AI_HOURLY_LIMIT` | Optional, default 30 photo/PDF reads per account per hour |

## Supabase settings once the app is online

1. Authentication → URL Configuration: set **Site URL** to the live address and add it under **Redirect URLs**.
2. Email confirmation is on by default and the app handles it. Before launch, set up SMTP under Authentication → Emails → SMTP Settings. The built-in sender only sends a few emails an hour.
