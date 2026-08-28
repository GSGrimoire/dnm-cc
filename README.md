# Dreams & Machines — Character Creator

The character creator for Dreams & Machines. Build a character, play from the sheet, and
share it as a code. Published by GitHub Pages from `main` at
<https://gsgrimoire.github.io/dnm-cc/>.

The whole creator is **one file**, `index.html`. That is deliberate: it can be downloaded
and opened from disk with no server and no network. A `<script type="module">` at the end
runs only inside Owlbear Rodeo and bridges the sheet to the extension; in a normal browser
tab it never executes and the creator behaves as it always has.

## The other half

The Owlbear Rodeo extension lives in [`GSGrimoire/dnm-obr`](https://github.com/GSGrimoire/dnm-obr):
the dice roller, the shared Rolls and Actions log, the GM table controls and the party
panel. **Deploy the extension first.** A creator sending events an old extension ignores is
harmless; a creator expecting something the extension never writes sits broken.

## Documents

| | |
|---|---|
| `CHANGELOG.html` | Player-facing. What changed at the table, in play terms. |
| `UPGRADE_NOTES.md` | Developer-facing. Why, including what was deliberately left out. |
| `.claude/skills/gsgrimoire-dnm-vtt/` | The conventions for working on either repo. |

That last one is the important one if you are picking this up cold. It carries the
**versioning rule**, the **deploy order** and the **trust boundary** — all three have been
got wrong at least once and each cost a session. `references/architecture.md` beside it
documents the character-code format, the token metadata, the epoch mechanism and the event
reducer, with the failure each design avoids.

Claude Code loads it automatically when working in this repo.

## Tests

`tests/` holds three suites. They read both repos from `out/`, which is gitignored
scaffolding rather than source, so stage it before every run:

```sh
npm install jsdom playwright --no-save
mkdir -p out/dnm-cc && cp index.html out/dnm-cc/
rm -rf out/dnm-obr && cp -r ../dnm-obr out/dnm-obr
for t in creator party security; do node tests/$t.test.mjs; done
```

The jsdom suites cannot run the module block or anything needing a live room. Whatever they
cannot reach is listed as live checks at the bottom of each `UPGRADE_NOTES.md` section
rather than implied to be covered.
