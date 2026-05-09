# Nutrition Calculator

A personal daily nutrition tracking PWA. The app runs entirely in the browser; the only network calls are to Anthropic (AI estimation, opt-in) and Supabase (cloud sync, opt-in).

The project lives under `v2/`. CI deploys `v2/` to GitHub Pages.

## Features

- **Preset meal templates** — Morning Shake, Standard Lunch, Standard Dinner, and more, each with verified nutrient totals
- **Ingredient swapping** — swap proteins, fruits, grains, and seeds within a meal while totals update live
- **16-nutrient gap tracking** — tracks protein, carbs, fat, fiber, sat fat, EPA+DHA, calcium, iron, zinc, vitamins D/E/B12/C, folate, potassium, and magnesium against personal daily targets
- **AI nutrition estimation** — describe any food in plain text and get instant nutrient estimates via the Claude API
- **Manual entry** — enter nutrient values directly if preferred
- **Fat-soluble carryover** — weekly B12 and Vitamin E supplements carry their dose forward across 7 days automatically
- **Day history** — archive each day with energy and digestion ratings, dinner type, and notes
- **Cloud Sync (opt-in)** — sign in to back up state and sync across devices via Supabase
- **Dark mode** — toggle in the header
- **PWA** — installable on mobile and desktop

## Getting Started

```
cd v2
npm install
npm run build:css
npm run build
npx serve -p 8765
```

Then open `http://localhost:8765/`. To install as a PWA, open in Chrome or Safari and use "Add to Home Screen."

After any edit to `v2/src/app.jsx`, re-run both `npm run build:css` and `npm run build`. See `CLAUDE.md` for the full build invariants.

## AI Estimation

Custom food items can be estimated automatically using the Claude API.

1. Open Settings → Claude API Key.
2. Paste your Anthropic API key and save.
3. Use "📝 Custom Item" → type a food description → "🤖 Estimate with AI."

The key is stored in `localStorage` and never leaves your device (calls go directly to `api.anthropic.com` from the browser).

## Cloud Sync

Cloud Sync is opt-in. Open Settings → Cloud Sync → toggle on. A sign-in modal will appear; sign in with the Supabase credentials configured in `v2/src/store/supabase-config.js`. Once signed in, state writes are mirrored to Supabase via a write-behind queue.

When Cloud Sync is off, data stays on the device and no network calls go to Supabase.

## Daily Workflow

1. Select a meal template from the **Meals** section.
2. Adjust ingredient quantities or swap variants as needed.
3. Click **+ Add to Day**.
4. Repeat for supplements and any custom items.
5. Watch the **Running Totals** panel — each nutrient shows current value, target, and a green/amber/red status badge.
6. At end of day, click **🌅 New Day** to log energy/digestion ratings and archive the day.

## Nutrient Targets

Targets are personal daily values hardcoded in `OBJECTIVES` — they are not generic RDAs. Adjust them directly in `v2/data.js` if needed.

| Type | Behavior |
|------|----------|
| `range` | Must be between min and max |
| `minimum` | Must meet or exceed min |
| `maximum` | Must stay below max |

## Data & Privacy

- All local data is stored in `localStorage` under `nutrition_calc_v2` (state) and `nutrition_calc_v2_api_key` (key). Older `nutrition_calc_v1` entries from the legacy V1 app are not read or migrated; clear them manually if you no longer want them.
- Outbound traffic only happens for: AI estimation requests to Anthropic (opt-in, your key) and Cloud Sync writes to Supabase (opt-in, your account).
- Designed for personal use with one set of targets — not a multi-user tool.

## Caveats

- Nutrient values are USDA-based estimates, not lab-verified.
- AI estimation accuracy depends on how specifically you describe the food.
