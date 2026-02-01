# Brand Marketplace (demo homepage)

Homepage that:
- Loads creators **only** from a Google Sheet
- Uses an AI (ChatGPT/OpenAI) classifier to map a brand website into one of these categories:
  - Games, Social, Entertainment, Productivity, Lifestyle, Health & Fitness, Education, Business, Finance, Utilities

Flow:
- `index.html`: enter website + CTA
- `match.html`: shows a 4s loading sequence, then reveals the creator match

## Run

### Required: run the local server (for AI classification)

PowerShell:

```bash
cd c:\Users\niko4\Downloads\brand-marketplace
# Option A (recommended): use a .env file
copy .env.example .env
# edit .env and set OPENAI_API_KEY

# Option B: set env var for this terminal session
# $env:OPENAI_API_KEY="sk-..."
npm run start
```

Then open `http://localhost:5173`.

## Google Sheets data source

This project is configured to load creators from:

- `https://docs.google.com/spreadsheets/d/1QRQ_P3bi5ClIH_aD5ztTbFgxTH8XnypIWnPjsaqJ87Q/edit?gid=0#gid=0`

Required columns (header row):
- `Creator`
- `Category`
- Optional: `Photo`
- Optional: `Price`

The `Category` values should match (or be close to) the canonical set:
- Games, Social, Entertainment, Productivity, Lifestyle, Health & Fitness, Education, Business, Finance, Utilities

### If the sheet doesn’t load (matching will be disabled)

Browsers may block cross-origin requests if the sheet isn’t publicly accessible / published.

Try:
- Make sure the sheet sharing is set to “Anyone with the link can view”, or
- Publish it to the web in Google Sheets

If it still fails, the page will disable the match flow until the sheet is accessible.

## What to try

- Enter a URL containing a keyword like:
  - `twitch`, `steam`, `game` → Games
  - `bank`, `wallet`, `invest` → Finance
  - `crm`, `invoicing`, `b2b` → Business

If confidence is low (or no creators exist for that category), the page shows a category picker so you can refine the match.
