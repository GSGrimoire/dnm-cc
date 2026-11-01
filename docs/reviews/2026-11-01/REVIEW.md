# Full repository review: Dreams & Machines

Review date: 1 November 2026.

**Verdict: changes required. The current release does not receive an all-clear.**

The existing 1,099 assertions pass, but new probes reproduce 13 failure scenarios across eight runtime findings. A ninth finding concerns incorrect privacy documentation. Four findings have high priority because they affect saved characters, paid rolls, shared currency or recovery. Production application code was not changed during this review.

This is a full self-review. The reviewing assistant also implemented the recent direct reroll and extra-dice releases; this report is not represented as an independent review.

## Exact scope

| Repository | Reviewed main commit | Release |
|---|---|---|
| GSGrimoire/dnm-obr | `70cb3cbe32a137923bc6e089d14afdadeb556672` | 1.8 |
| GSGrimoire/dnm-cc | `10c8c38b39633f8bc45565e720c49ce9f1ee9e0e` | 2.6 |

Both remote heads were fetched and matched the local review sources. Hosted manifest, roller, shared helpers, background, gamemaster panel and creator files matched the reviewed bytes; see [deployment.json](deployment.json).

Scope included resource and roll flows, the room reducer and background authorization gate, character imports and serialization, token saving, recovery, concealed-roll handling, gamemaster and adversary controls, shared helper copies, staging tooling and test coverage. The game data and book quotations were not independently checked against the printed books. The vendored Owlbear interface was inspected where relevant; this is not a complete audit of the third-party library.

## Findings

### F01. High: overlapping saves can restore older character state while reporting saved

Source: [creator commit()](https://github.com/GSGrimoire/dnm-cc/blob/10c8c38b39633f8bc45565e720c49ce9f1ee9e0e/index.html#L11221).

`commit()` starts an independent token write on every invocation. It neither serializes writes nor associates the saved indicator with a character revision. A debounced edit can start another save while the preceding write is still pending. The vendored interface independently reads items and sends each update; the application does not enforce write order.

The probe captures two real commit calls, allows the newer one to complete first, then completes the older one. Local Spirit is 1, durable Spirit is 2, and the indicator says `saved`. The same whole-character overwrite applies to inventory, injuries, notes and other edits.

Required correction: serialize or coalesce writes by character revision, ensure the newest revision ultimately wins, and show saved only for the confirmed current revision. Preserve dirty state across failures and changes during an outstanding write.

Evidence: `save-completion-order` in [observed.json](observed.json). Completion order is controlled by a simulated Owlbear interface; actual service timing was not measured.

### F02. High: paid primary rolls have no durable recovery across save and send failures

Sources: [doRoll()](https://github.com/GSGrimoire/dnm-cc/blob/10c8c38b39633f8bc45565e720c49ce9f1ee9e0e/index.html#L10464), [broadcast bridge](https://github.com/GSGrimoire/dnm-cc/blob/10c8c38b39633f8bc45565e720c49ce9f1ee9e0e/index.html#L11013), [automatic request completion](https://github.com/GSGrimoire/dnm-cc/blob/10c8c38b39633f8bc45565e720c49ce9f1ee9e0e/index.html#L12420).

The new primary-roll flow changes local Spirit, records the request as completed, and broadcasts the result before its token save is confirmed. `commit()` catches failure without returning a failure disposition. The send bridge also catches failure without keeping a pending publication.

Two cases reproduce:

- Failed token write: a four-die roll is published while durable Spirit remains 3 instead of 1. Reopening from the unchanged token accepts the same request again and produces different dice under the same roll identifier. The room reducer deduplicates that identifier, so the second sheet result can disagree with the first public result.
- Failed broadcast: durable Spirit becomes 1 and the processed request is saved, but there is no public roll. Reopening and retrying is suppressed as already completed, with no resend path.

Required correction: durably retain the payment, original result and publication state together. A retry must recover and publish that same result, not generate fresh dice or silently discard an undelivered paid result. Reconcile uncertain outcomes using the request identifier. Apply this to direct sheet purchases as well as roller requests.

Evidence: `paid-roll-save-failure` and `paid-roll-send-failure`. These are defects in the recently added purchase flow and were not covered by its earlier success-path tests.

### F03. High: Momentum claims are inconsistent across interfaces and can pay more than once

Sources: [sheet claimRollMomentum()](https://github.com/GSGrimoire/dnm-cc/blob/10c8c38b39633f8bc45565e720c49ce9f1ee9e0e/index.html#L10405), [roller claimMomentum()](https://github.com/GSGrimoire/dnm-obr/blob/70cb3cbe32a137923bc6e089d14afdadeb556672/roller.js#L449), [room claim reducer](https://github.com/GSGrimoire/dnm-obr/blob/70cb3cbe32a137923bc6e089d14afdadeb556672/dnm.js#L1374).

The sheet marks only its local result and recent entry as claimed. It sends pool and action messages, but no shared `claim` message. A sequential claim on the roller therefore remains available after a successful sheet claim; the room also fails to lock that entry against rerolls.

The roller sends claim and pool changes as separate events. Two clients looking at an unclaimed entry, or two clicks before metadata returns, can each add its gain even though the claim marker itself is idempotent. A roll worth 3 Momentum pays 6 in the probe. The roller also lacks the sheet's six-point cap: a pool of 5 plus a gain of 3 becomes 8.

Required correction: make the claim, actual capped payout and dice lock one idempotent room operation, used by both interfaces. Do not send a separate unconditional pool delta for the same claim. Display the amount actually accepted by the room.

Evidence: `sheet-claim-not-shared`, `duplicate-momentum-claim`, `momentum-cap-disagreement`.

### F04. Medium: paid reroll debts can be skipped or disappear with display history

Sources: [roller reroll payment route](https://github.com/GSGrimoire/dnm-obr/blob/70cb3cbe32a137923bc6e089d14afdadeb556672/roller.js#L1108), [sheet reconcileRerolls()](https://github.com/GSGrimoire/dnm-cc/blob/10c8c38b39633f8bc45565e720c49ce9f1ee9e0e/index.html#L11697), [bounded room log](https://github.com/GSGrimoire/dnm-obr/blob/70cb3cbe32a137923bc6e089d14afdadeb556672/dnm.js#L1328).

The roller's Spirit charge is deferred to the sheet and represented only in the ordinary roll log. On first contact, a character with no applied-reroll ledger marks existing debts as adopted without subtracting Spirit. Separately, a later log entry can evict a paid reroll before its sheet opens, permanently removing the only charge record.

The probe shows a paid reroll leaving Spirit at 3 while marking its receipt applied. Another run adds 40 later actions before reopening; the reroll is gone and Spirit is still 3.

Required correction: use a payment/receipt path that does not depend on first-contact adoption or retention of display history. Prefer completing paid rerolls on the owning sheet, or retain explicit pending payments until acknowledged. Reserve funds before accepting paid results, rather than allowing stale displayed balances to finance several debts.

Evidence: `first-open-reroll-debt`, `trimmed-reroll-debt`. Deferred collection was an existing design, but these payment losses conflict with the required one-Spirit cost.

### F05. High: recovery can restore a stale character after a normal edit

Source: [background recovery watcher](https://github.com/GSGrimoire/dnm-obr/blob/70cb3cbe32a137923bc6e089d14afdadeb556672/background.js#L215).

The recovery watcher's signature combines token identifier and character-code length. It skips the update entirely when the code changes without changing length, leaving the old code in its deletion baseline. Equal-length codes are normal with the compressed format.

The probe builds two genuine, different character codes of the same length, observes the original, observes the edited code, then deletes the token. Recovery offers the original code rather than the edited one. This defeats the safety net precisely when it is needed.

Required correction: detect code-content changes while continuing to suppress drag-only updates. Always retain the latest code for each live token before testing for disappearance.

Evidence: `same-length-recovery`; both synthetic codes were 3,183 characters long.

### F06. Medium: multiple gamemaster backgrounds violate the single-writer assumption

Sources: [role-based relay registration](https://github.com/GSGrimoire/dnm-obr/blob/70cb3cbe32a137923bc6e089d14afdadeb556672/background.js#L185), [local write chain](https://github.com/GSGrimoire/dnm-obr/blob/70cb3cbe32a137923bc6e089d14afdadeb556672/background.js#L98).

Every background with the gamemaster role subscribes and writes. The promise chain is local to one background, not shared by the room. There is no writer election or operation identifier for pool deltas. If a second background handles an event after the first background's write, a single +1 becomes +2. Other arrival orders can lose concurrent changes instead.

Required correction: enforce a single active writer with explicit failover, and make retried operations idempotent. Cover two distinct gamemaster connections and multiple tabs of a gamemaster account.

Evidence: `two-background-writers`, using two isolated instances of the actual background persistence code and controlled delivery to shared simulated metadata. This is not a measurement of a live room's delivery schedule.

### F07. Medium: compressed imports have no expansion budget and character lists have no render cap

Sources: [shared inflater](https://github.com/GSGrimoire/dnm-obr/blob/70cb3cbe32a137923bc6e089d14afdadeb556672/dnm.js#L1661), [creator inflater](https://github.com/GSGrimoire/dnm-cc/blob/10c8c38b39633f8bc45565e720c49ce9f1ee9e0e/index.html#L6061), [list normalization](https://github.com/GSGrimoire/dnm-cc/blob/10c8c38b39633f8bc45565e720c49ce9f1ee9e0e/index.html#L4318), [bond rendering](https://github.com/GSGrimoire/dnm-cc/blob/10c8c38b39633f8bc45565e720c49ce9f1ee9e0e/index.html#L7479).

Both inflater copies append output without a decompressed-size limit. The special clamps on recent rolls do not apply to other character arrays. A 2,049-byte compressed payload expands to 2,097,152 bytes without rejection. A valid 3,307-character code carrying 1,000 bonds is accepted and produces 648,032 characters of bond markup.

This permits excessive synchronous work from imported codes or token data. The probe deliberately stayed small; no live room was stressed and no actual browser crash is claimed.

Required correction: bound encoded size, decompressed size, nesting and all rendered collection sizes. Apply the limits before loops and document a reasonable supported character size. Preserve normal codes and both historical formats.

Evidence: `unbounded-decompression`, `unbounded-character-list`.

### F08. Medium: a corrupt modern character payload silently drops saved state

Source: [character payload fallback](https://github.com/GSGrimoire/dnm-cc/blob/10c8c38b39633f8bc45565e720c49ce9f1ee9e0e/index.html#L6326).

When a present character payload cannot be decoded, the parser swallows the error and accepts the incomplete legacy segments. Those segments do not carry the whole playable character. In the probe, corrupting only that segment changes a one-item inventory to empty and Spirit 1 to an unset value, with no parse error. Opening such a token through the normal sheet path can then normalize and save the reduced character.

Required correction: distinguish an old code without a full payload from a damaged code with one. Reject the latter with a recoverable error and preserve the original token/code. Do not silently autosave a lossy fallback.

Evidence: `corrupt-character-fallback`. Backward compatibility for genuine older codes must remain covered.

### F09. Medium: privacy documentation promises secrecy that Hidden mode does not provide

Sources: [extension README](https://github.com/GSGrimoire/dnm-obr/blob/70cb3cbe32a137923bc6e089d14afdadeb556672/README.md#L99), [architecture guide](https://github.com/GSGrimoire/dnm-cc/blob/10c8c38b39633f8bc45565e720c49ce9f1ee9e0e/.claude/skills/gsgrimoire-dnm-vtt/references/architecture.md#L148), [actual disclosure model](https://github.com/GSGrimoire/dnm-obr/blob/70cb3cbe32a137923bc6e089d14afdadeb556672/dnm.js#L785).

The README says Hidden results never enter room metadata and cannot be inspected by players. The architecture guide describes a local result plus a placeholder and a helper no longer present. Actual Hidden results are sent in full to the room and hidden only in the interface. Secret mode is the local-only mode.

This is a documentation defect, not a newly discovered authorization bypass: the code explicitly documents the intentional distinction. A user following the README could nevertheless expose information they intended to keep secret.

Required correction: align the README, architecture guide and release guidance with the actual Hidden/Secret distinction. Do not change the chosen sharing model as an incidental documentation fix.

## Validation and evidence

| Existing suite | Passed | Failed |
|---|---:|---:|
| codec | 15 | 0 |
| creator | 338 | 0 |
| embedded | 120 | 0 |
| party | 328 | 0 |
| dock | 130 | 0 |
| security | 141 | 0 |
| rollerclick | 27 | 0 |
| Total | 1,099 | 0 |

Layout, rollerui and gamemaster-tools browser suites could not run because the browser runtime was unavailable. Previously observed socket restrictions also prevent treating this environment as a real Owlbear room. There is no live-room clearance or measured panel-layout result in this report.

The additional probes load the actual application functions with controlled interface and storage substitutes. They do not edit the reviewed source. Their assertions intentionally reproduce defects in the current release; a successful probe run does not mean the release is correct. After fixes, convert the scenarios into acceptance regressions that require the corrected behavior.

Artifacts:

- [probes.mjs](probes.mjs): runnable reproductions and positive controls.
- [observed.json](observed.json): 13 reproduced scenarios and observed values.
- [test-results.json](test-results.json): existing test outcomes and reviewed revisions.
- [deployment.json](deployment.json): deployed-file equality and hashes.

Positive authorization controls also exercised the actual background relay: non-gamemaster clear, epoch and downward Threat messages were refused, as was an unknown sender's reroll. The legitimate roller's reroll and the gamemaster's clear were accepted. Existing escaping and prototype-handling tests passed. No new script-injection finding is asserted.

To reproduce, stage the exact two source trees under the creator's ignored out directory as described in the repository skill, install its documented test dependencies, then run:

```sh
node --experimental-vm-modules docs/reviews/2026-11-01/probes.mjs
```

## Correction order

1. Fix save ordering and establish a recoverable paid-result publication path: F01 and F02.
2. Make claims a single shared operation and propagate the lock from both interfaces: F03.
3. Fix recovery baseline freshness and durable reroll charging: F05 and F04.
4. Resolve multi-writer behavior, import budgets and corrupt-payload handling: F06 through F08.
5. Correct the misleading privacy documentation: F09.

Each corrected path needs a regression derived from these probes. The saving and shared-writer changes also need separate review and an isolated live-room check before broad distribution.
