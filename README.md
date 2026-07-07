# 🌿 Gratteri Ambassadors

A little community site for the foreign households of **Gratteri, Sicily**.

Families sign up, share a few details about who they are, and add the dates
they'll be in the village. Everyone gets a shared, Gantt-style year calendar
showing who's in town and when — plus a "who's here right now" panel.

## How it works

- **Frontend** — a single static page (`index.html`, `style.css`, `app.js`,
  plus a vendored copy of the Supabase client in `vendor/`). No build tools,
  no framework. Host it anywhere that serves static files
  (GitHub Pages works great and is free).
- **Backend** — [Supabase](https://supabase.com) (project
  `gratteri-ambassadors`) handles accounts, family profiles, and visits.
  - `families` — one profile per household (name, members, home town, bio, photo, calendar colour)
  - `visits` — date ranges when a family is in Gratteri
  - `events` — one-off events on a date, with an `event_interest` table for
    who's interested
  - `messages` — the noticeboard
  - a `family-photos` storage bucket for profile photos
  - Row-level security: any signed-in ambassador can *see* everything;
    each family can only *edit* their own profile, visits, events, and notes.

The Supabase URL and publishable key at the top of `app.js` are safe to be
public — all real protection is enforced by row-level security in the database.

## Features

- ✍️ Sign up / log in with email + password — open signup: anyone with the
  link can join, no approval needed
- 👨‍👩‍👧‍👦 Family profile: name, members, where you're from, a short bio, and your colour
- 📅 Add / remove visit date ranges with an optional note
- 📊 Year calendar (Gantt chart): one row per family, bars for each visit,
  month gridlines, a today marker, and year navigation
- 📌 Events: anyone can pin a one-off event (festa, dinner, beach day) to a
  date — it appears on the calendar, and other families can tap
  "I'm interested" so the host knows who's coming
- 📝 Noticeboard for short notes to the whole group
- 📷 Family profile photos (stored in Supabase Storage)
- 🏡 "In Gratteri right now" + "arriving in the next two weeks" panel
- 🗂 Ambassadors directory with each family's next visit
- 📱 Works on phones (the calendar scrolls sideways)

## Deployment

The site deploys itself: every push to `main` runs the GitHub Actions
workflow in `.github/workflows/pages.yml`, which publishes the site to
GitHub Pages at
`https://martinstuartgray84-ship-it.github.io/Gratteri/`.
Share that link with the other ambassadors 🎉

## One-time Supabase setting (recommended)

By default Supabase requires new users to confirm their email address, and
the free built-in email service only sends a couple of emails per hour —
fine for a village-sized group, but confirmation emails can be slow to
arrive. To make signing up instant:

1. Open the [Supabase dashboard](https://supabase.com/dashboard) →
   project **gratteri-ambassadors**
2. Go to **Authentication → Sign In / Providers → Email**
3. Turn **off** "Confirm email" and save

The app handles both modes either way — with confirmation on, new members
just see a "check your email" message after signing up.

## Local development

Any static file server works, e.g.:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Ideas for later

- Email nudges: "3 families are in town this week" (needs an email-sending
  service such as Resend — sign up for an API key, then a Supabase Edge
  Function on a cron schedule can send them)
- Italian translation toggle
- Optional hardening: in the Supabase dashboard under Authentication →
  Sign In / Providers, enable "Leaked password protection"
