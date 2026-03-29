# SipScore

A mobile-optimised drink rating app for group holidays. Rate wines and cocktails, build your personal top list, and see what the group loves most.

## Tech Stack

- **Frontend**: Plain HTML, CSS, JavaScript
- **Backend**: Vercel Serverless Functions (Node.js)
- **Database**: Neon PostgreSQL
- **Hosting**: Vercel

## Setup

### 1. Connect to Neon

In your Vercel project settings, add the environment variable:

```
DATABASE_URL=your-neon-connection-string
```

Get this from your Neon console (Settings → Connection string → use the **pooled** connection string).

### 2. Deploy to Vercel

```bash
vercel deploy
```

Or push to GitHub and connect the repo to Vercel for automatic deploys.

### 3. Seed the Database (first deploy only)

After deploying, run this once to create the database tables and load the drinks:

```bash
curl -X POST https://your-app.vercel.app/api/seed
```

This creates the `users`, `drinks`, and `ratings` tables and loads all 37 wines + 20 cocktails.

## Development

To run locally with Vercel's dev server (requires Vercel CLI):

```bash
npm install -g vercel
vercel dev
```

Your `DATABASE_URL` must be set (either in `.env.local` or via `vercel env pull`).

## Pages

| Page | URL | Description |
|------|-----|-------------|
| Login / Register | `/` | Create a profile with name + 4-digit PIN |
| Browse Drinks | `/drinks.html` | Search, filter and browse all drinks |
| Rate a Drink | `/rate.html?id=123` | Give a drink 1–5 stars + tasting notes |
| Rankings | `/leaderboard.html` | Personal top picks & group favourites |
| Add a Drink | `/add-drink.html` | Add a new wine or cocktail |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth` | Register or login (`action: "register"/"login"`) |
| `GET` | `/api/drinks` | List/search drinks (`?search=&category=&type=&user_id=`) |
| `POST` | `/api/drinks` | Add a new drink |
| `GET` | `/api/drink/:id` | Get drink details + all ratings |
| `POST` | `/api/ratings` | Rate a drink (upsert) |
| `DELETE` | `/api/ratings` | Remove a rating |
| `GET` | `/api/leaderboard` | Get leaderboard (`?type=personal/social&user_id=`) |
| `POST` | `/api/seed` | Create schema + seed data (run once) |
