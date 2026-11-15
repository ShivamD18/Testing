# Sunday Planner

A weekly study planner, published as a private claude.ai page:
https://claude.ai/artifact/CNVp89XbcxxCsGYb1TJt3y

You send Claude your week in plain words. Claude saves it to the page's database, and the page builds the schedule.

## Instructions for Claude (any conversation)

When the user sends a weekly or mid-week planner prompt:

1. Read the current data with `ArtifactData` (`list` on `tasks`, `blocks`, and `get` on `config/main`).
2. Write the changes in one `batch`, pinning each existing document with `if_version`.
3. On a new Sunday week: delete `example: true` documents, replace `blocks` with the new fixed schedule, add the new tasks, mark finished tasks `done: true`, and set `config/main.plannedAt` to the current time.
4. Don't republish the page for data changes. Republish `planner/index.html` only when the user asks for a change to how the app looks or works.

Times are local wall-clock strings: `YYYY-MM-DDTHH:MM`. Weekdays are numbered 0 = Sunday … 6 = Saturday.

### `tasks/<id>`
| field | meaning |
|---|---|
| `title`, `course`, `notes` | text |
| `due` | `"2026-11-19T23:59"` |
| `hours` | estimated total hours (number) |
| `priority` | 1–5 (5 = critical) |
| `mode` | `"auto"`, `"spread"` (split it up) or `"single"` (one sitting) |
| `done` | `true` when finished |
| `log` | sessions the user ticked off: `[{s, e}]`. The page writes this field; Claude doesn't edit it. |
| `created` | when the task was added (used to detect rolled-over work) |

### `blocks/<id>` (fixed commitments)
| field | meaning |
|---|---|
| `title`, `location` | text |
| `kind` | `"class"` (work may overlap), `"lab"`, `"work"`, `"study"`, `"personal"`, `"other"` (all locked) |
| `days` | weekly repeat, e.g. `[1,3,5]`, **or** `date: "2026-11-18"` for a one-off |
| `start`, `end` | `"14:30"` |
| `hard` | optional override for whether work may be scheduled over it |

### `config/main`
`weekdayStart/End`, `weekendStart/End` (working window), `bufferDays` (1), `bufferDaysP5` (2), `minBlock` (30), `maxBlock` (120), `gap` (10, in minutes), `plannedAt`.

## How scheduling works
- The page plans in 5-minute slots, from the current time forward. Its working window is 8am–11pm on weekdays and 10am–11pm on weekends.
- Labs, work shifts and other locked blocks are never used. Class time is used only when nothing else fits.
- Higher priority is placed first. Each task aims to finish `bufferDays` before it's due (2 days for priority 5). If it can't, it uses the buffer and gets flagged. Any work that still doesn't fit is shown as a shortfall.
- "Spread" work is divided evenly across the days before the target, in 30–120 minute sessions. "Single" work goes in one block, on the earliest day that stays under the daily load target. "Auto" means single for 2 hours or less, otherwise spread.
- Unticked work isn't counted as done, so it is re-planned from the current time (it rolls over). Tasks behind the Sunday plan show a "Rolled over" tag.
