# Craft Ledger

A personal Albion Online market tool: two focused pages driven by live market
data from the [Albion Online Data Project](https://www.albion-online-data.com).

- **Best Sellers** — scans the craftable catalog (weapons, armor, off-hands,
  tools, mounts, food, potions, bags & capes, and raw/refined materials,
  T2–T8) and ranks items by craft-to-sell profit in your selected city.
  Filters by tier, enchantment, and category; flags when another city or the
  Black Market pays meaningfully more; click any row for a full cost breakdown
  and price-history chart.
- **My Materials** — enter the materials you're holding and get the most
  profitable crafts achievable from them, plus a shopping list (with current
  prices) when you're a few ingredients short.
- **Tracker** — press "+ Track this craft" on any item to plan a run: pick a
  quantity and get a raw-materials list (for gathering), a refined-materials
  list (for buying), and the total cost/profit of the run.

Item images come from Albion's official render service. Best Sellers hides
suspicious prices by default — on quiet markets a single overpriced listing
can masquerade as a huge profit; the cross-city sanity check catches those
(toggle "Hide suspicious prices" to see them anyway).

## Running it

No build step, no server, no accounts. Just open `index.html` in a browser.

If your browser is unusually strict about `file://` pages, the one-command
fallback is:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Your server/city selection, Premium/Focus toggles, and saved materials persist
in `localStorage`.

## Economic model

- Materials are bought instantly at the lowest sell order; finished goods are
  sold via sell order (2.5% setup fee + 8% sales tax, 4% with Premium).
  Black Market sales fill existing buy orders, so no setup fee there.
- Resource return: 18% base in every royal city, +40% when refining the
  city's specialty resource, +15% when crafting the city's specialty items,
  +59% flat with Focus (additive, capped at 75% to keep costs meaningful).
- Enchanted gear is costed both ways — crafting directly from enchanted
  materials vs. crafting the base item and upgrading with runes/souls/relics
  (.4 is direct-only) — and the cheaper route wins, labelled in the UI.
- Refined materials used as inputs are priced at the cheaper of buying them
  or refining them from raws.
- Quality is always Normal (quality is an RNG outcome, not a planning input).
- Station usage fees are out of scope for v1, but the cost functions already
  take a `stationFeePct` parameter so it can become a user input later.

## Data

- **Live & historical prices:** Albion Online Data Project, called directly
  from the browser. Requests are batched (comma-separated ids, under the URL
  length limit), throttled well below AODP's rate limits, and cached for
  5 minutes client-side.
- **Item catalog & recipes:** generated from
  [ao-data/ao-bin-dumps](https://github.com/ao-data/ao-bin-dumps) into
  `data/catalog.js` (a plain script so the site works from `file://`).
  Artifact-based gear lines (Undead, Keeper, Hellion, Royal, Avalonian, …)
  are excluded. To regenerate:

```sh
cd tools
curl -sLO https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/items.json
curl -sL -o items_fmt.json https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/formatted/items.json
python3 gen_catalog.py ../data/catalog.js
```

Not affiliated with Sandbox Interactive. Fan-made tool; data courtesy of the
community projects above.
