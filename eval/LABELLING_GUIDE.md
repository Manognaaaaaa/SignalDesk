# Labelling guide: Judge (stance) eval

You are labelling `eval/judge/labels.csv`. Each row is one **(numbered sentences, asset)** pair, exactly what the Judge sees in production. Fill three columns:

| Column | What to write |
|---|---|
| `gold_stance` | One label from `allowed_stances` for that row, or `skip` |
| `gold_supporting_sentence_ids` | The sentence IDs that justify your label, e.g. `S1, S3`. Required for every label except `unclear` |
| `notes` | Optional. Use the tags below, so we can slice results later |

**Golden rule: judge only the text in the row.** Don't use outside knowledge ("I know gold usually rises when…"), and don't open the article to find extra context. The model only gets these sentences, so the gold label must be answerable from them too. The `url` column is only there so you can check a row that looks garbled.

Label **before** you look at any model output. The CSV never contains predictions, so keep it that way.

---

## 1. The labels

### Markets: currency pairs, commodities, indices, stocks, crypto

| Label | Use when the sentences… | Example |
|---|---|---|
| `bullish` | report or clearly imply **upward** pressure on this asset's price | "Brent climbed 3% after OPEC+ extended cuts." → Crude oil: bullish |
| `bearish` | report or clearly imply **downward** pressure on this asset's price | "Bitcoin slid below $83,000 as yields rose." → Bitcoin: bearish |
| `neutral` | discuss the asset's price and say it is **not moving** or the forces are balanced | "Gold held flat near $4,280 ahead of the Fed decision." → Gold: neutral |
| `unclear` | don't tell you which way **this asset** is pushed | "Nvidia will present at the conference on Tuesday." → NVIDIA: unclear |

### Central banks (Fed, ECB, BoE)

| Label | Use when the bank (or credible reporting about it) signals… | Example |
|---|---|---|
| `hawkish` | tighter policy: a hike, fewer or later cuts, inflation worry | "Traders now price four Fed hikes by mid-2027." → Fed: hawkish |
| `dovish` | looser policy: cuts, easing, worry about growth or jobs | "The ECB cut its deposit rate by 25bp." → ECB: dovish |
| `neutral` | a hold with balanced guidance and no tilt | "The BoE kept rates unchanged and said risks are balanced." → BoE: neutral |
| `unclear` | nothing about the policy direction | "The Federal Reserve Board announced the appointment of a new CIO." → Fed: unclear |

**Market pricing counts.** "Markets price more Fed hikes" is hawkish for the Fed, because it is reporting on expected policy. A central-bank asset is never `bullish`/`bearish`, and a market asset is never `hawkish`/`dovish`. The eval rejects a label that isn't in `allowed_stances`.

---

## 2. Neutral vs unclear (the hard boundary)

Ask these two questions in order:

1. **Do the sentences say anything about this asset's direction or level?** (for a central bank: its policy stance)
   - **No** → `unclear`. This covers event announcements, earnings dates, lawsuits, product launches, personnel news, or the asset only named in a list.
   - **Yes** → go to 2.
2. **Is that direction up, down, or explicitly flat/balanced?**
   - Up or down → `bullish`/`bearish` (or `hawkish`/`dovish`).
   - Explicitly flat, unchanged, range-bound, or pros and cons stated **equally** → `neutral`.
   - Mixed but you can't tell which side wins, or it's conditional ("could rise if…") → `unclear`.

In short:

- **`neutral` is a finding:** the text tells you nothing is moving.
- **`unclear` is an absence:** the text doesn't tell you.

| Sentences | Label | Why |
|---|---|---|
| "EUR/USD traded in a tight range around 1.1650." | neutral | explicitly flat |
| "EUR/USD traders await Friday's jobs report." | unclear | no direction or level movement |
| "Gold rose early but gave up its gains to finish unchanged." | neutral | net flat, stated |
| "Gold could test $4,400 if the dollar weakens further." | unclear | conditional forecast, no current pressure |
| "Analysts are split on oil: supply cuts support prices, weak demand weighs." | neutral | balanced forces, stated as balanced |
| "Oil and gold moved as traders digested the data." | unclear | direction not given |

---

## 3. Common traps

- **Currency pairs are BASE/QUOTE.** Bullish means the **base** strengthens.
  - "The yen weakened past 157 per dollar" → USD/JPY **bullish**.
  - "Sterling fell against the dollar" → GBP/USD **bearish**.
  - "The dollar rallied broadly" → EUR/USD **bearish**, since a stronger quote currency means a lower pair.
  - These count as clear, not inference: a pair move follows directly from either leg.
- **Futures, ETFs and proxies.** "S&P 500 futures rose 0.3%" counts as bullish for the S&P 500. "Gold miners rallied" is **not** a statement about gold, so it's `unclear` unless gold's own price is mentioned.
- **Drivers without a stated effect.** Take "Yields jumped and the dollar firmed" for Gold. If the text doesn't say gold moved or was pressured, it's `unclear`. If it says "…weighing on gold", it's `bearish`. Don't fill the gap with market knowledge.
- **Wrong asset matched (detection false positive).** Examples: "the euro area" matched EUR/USD, or "Fed" in an unrelated name. The text says nothing about the asset, so use `unclear` and tag `false_match` in `notes`. These are real production inputs, and the Judge should say `unclear` on them.
- **Headline vs body disagree.** Go with what the sentences, taken together, most clearly state about **this** asset. If they genuinely conflict, use `unclear` and tag `conflict`.
- **Several assets in one article.** Label only the row's asset. For example, "Oil surged, sending stocks lower" is Crude oil: bullish and S&P 500: bearish, on separate rows.
- **Old or backward-looking facts.** "Bitcoin fell 20% last year" in a story about something else → `unclear` (tag `background`).

## 4. Supporting sentence IDs

- List the **minimum** set of sentences that on their own justify the label: usually 1, at most 3.
- Every non-`unclear` label needs at least one ID. For `unclear`, leave it blank.
- The eval compares these with the IDs the model cites (precision/recall). The model can cite up to 3.

## 5. `skip`

Use `skip` only when a row is unusable: garbled text, a non-English excerpt, or an exact duplicate of another row. Wrong-asset matches are **not** skips (see section 3). Skipped rows are excluded from every metric and counted in the report.

## 6. Note tags

Put these in `notes`, comma-separated: `false_match`, `conflict`, `background`, `forecast`, `pair_quote_leg` (the pair moved through its quote currency), `proxy` (futures, ETF or related instrument), `hard` (you hesitated). Add free text after the tags if useful.

## 7. Process

1. Label every row in one or two sittings, so your standards stay consistent.
2. Re-label a random 20 rows a day later without looking at your first pass. Agreement below ~85% means the guide needs tightening before the numbers mean much.
3. Run `npm run eval:judge -- --spot-check 30`, then review the spot-check file to measure how often you agree with the citation-support judge.
