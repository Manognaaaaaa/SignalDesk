# Label provenance: `eval/judge/labels.csv`

| Rows | Labelled by | How |
|---|---|---|
| 91 (sampled 2026-09-27, seed 42) | `claude-opus-5.5` | Labelled from the numbered sentences only, following `eval/LABELLING_GUIDE.md`, without seeing the production Judge's predictions. The reason for each label is in `notes`. |

**Independence.** The Judge under test is `openai/gpt-oss-120b`. The labels come from a different model family (Anthropic Claude), so the eval doesn't measure a model grading itself. The labels are still machine-made, and the results must be reported as "AI-labelled", not "hand-labelled", unless the author reviews them.

**Known leak.** Before labelling, the labeller had seen the live Gold asset page, which shows the production stance (bearish) for 4 rows: `gold-0630e25d`, `gold-5bbaf1af`, `gold-e20949e6`, `gold-aa4fdb81`. Those 4 are not fully blind and are marked in `notes`.

**Author review.** When the author checks a row, set `labelled_by` to `claude-opus-5.5+author-reviewed`, or to `author` if they changed the label. The report counts each value.

## Source text

`labels.csv` (and the `*_spotcheck.md` files) contain headlines and short excerpt sentences from the listed publishers. This is the same text the live site already shows, each row with its source name and a link to the original article. It is included only so that the evaluation can be reproduced. The text belongs to its publishers. Full articles are never stored. To have a row removed, open an issue.
