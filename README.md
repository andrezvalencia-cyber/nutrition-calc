# Nutrition Calculator

A personal daily nutrition tracking PWA. No build step, no backend, no account — runs entirely in the browser from a single HTML file.

## Features

- **Preset meal templates** — Morning Shake, Standard Lunch, Standard Dinner, and more, each with verified nutrient totals
- **Ingredient swapping** — swap proteins, fruits, grains, and seeds within a meal while totals update live
- **16-nutrient gap tracking** — tracks protein, carbs, fat, fiber, sat fat, EPA+DHA, calcium, iron, zinc, vitamins D/E/B12/C, folate, potassium, and magnesium against personal daily targets
- **AI nutrition estimation** — describe any food in plain text and get instant nutrient estimates via the Claude API
- **Manual entry** — enter nutrient values directly if preferred
- **Fat-soluble carryover** — weekly B12 and Vitamin E supplements carry their dose forward across 7 days automatically
- **Day history** — archive each day with energy and digestion ratings, dinner type, and notes
- **Dark mode** — toggle in the header
- **PWA** — installable on mobile and desktop

## Getting Started

No installation or build step required.

1. Open `index.html` directly in a browser, or serve the directory with any static file server:
   ```
   npx serve .
   ```
2. To install as a PWA, open in Chrome or Safari and use "Add to Home Screen."

## AI Estimation

Custom food items can be estimated automatically using the Claude API (claude-haiku-4-5).

1. Click the lock icon (🔒) in the header.
2. Paste your Anthropic API key and save.
3. Use "📝 Custom Item" → type a food description → "🤖 Estimate with AI."

The key is stored in `localStorage` and never leaves your device (calls go directly to `api.anthropic.com` from the browser).

## Daily Workflow

1. Select a meal template from the **Meals** section.
2. Adjust ingredient quantities or swap variants as needed.
3. Click **+ Add to Day**.
4. Repeat for supplements and any custom items.
5. Watch the **Running Totals** panel on the right — each nutrient shows current value, target, and a green/amber/red status badge.
6. At end of day, click **🌅 New Day** to log energy/digestion ratings and archive the day.

## Nutrient Targets

Targets are personal daily values hardcoded in `OBJECTIVES` — they are not generic RDAs. Adjust them directly in `index.html` if needed.

| Type | Behavior |
|------|----------|
| `range` | Must be between min and max |
| `minimum` | Must meet or exceed min |
| `maximum` | Must stay below max |

## Data & Privacy

- All data (day log, history, settings) is stored in `localStorage` under the key `nutrition_calc_v1`.
- Nothing is sent to any server except AI estimation requests to Anthropic (opt-in, requires your own API key).
- Single-device only — no sync or backup.

## Caveats

- Nutrient values are USDA-based estimates, not lab-verified.
- AI estimation accuracy depends on how specifically you describe the food.
- Designed for personal use with one set of targets — not a multi-user tool.
