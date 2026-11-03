# Review, 2 November 2026

Covers the working tree on 2 Nov 2026, including the then-uncommitted drag and stage-height changes. Measured where possible; the scores are judgement, and the author of most of the code did the grading.

## Measurements

- **CI on `main`:** the last three pushes are red. Last run: 452/452 unit tests, all Chromium tests pass, 6 WebKit failures (238 passed). Four are the view-switch icon tests (they failed before the router work too); one is "a card reached by keyboard while zoomed is brought into view"; one is "confluent arrow labels at least 24 px".
- **Authoring:** `node.at {col,row}` is required. A 3-card, 2-arrow spec fails with 3 `node-position-required` errors. Auto-placement exists only inside the Terraform generator. The annealer used on the stress diagrams lives outside the repo, and the estate and landing-zone examples needed hand tuning.
- **Weight:** about 71 KB gzipped for all library JS chunks (the main entry is about 26 KB). Peer dependencies are React and React DOM only. The "no heavy dependencies" claim holds.
- **Phone (iPhone 13 emulation):** an ordinary example is clean in the top view, with no sideways scroll. Not checked: the isometric view, and the estate (the check used a wrong example name and fell back to a default).
- **AI path:** Terraform to diagram works. `platform-sim` generates 19 cards (22 with the overlay), all positioned, and lints at 0 errors and 0 warnings. A verify MCP server and drift checks exist. Text to spec does not exist (backlog L5).
- **Maintainability:** `ArchDiagram.tsx` is 1,310 of 6,000 lines in `src/`. The stress-test builders, annealer and browser probes are not in the repo, so those results cannot be reproduced.

## Scores (out of 5)

| Dimension | Score | Evidence |
|---|---|---|
| Visual quality | 4 | Clean routing, floors view, distinctive isometric look |
| Readability at scale | 3 | Fine at 40 to 50 cards; the 163-card estate is only explorable; routed crossings about 30% higher than straight lines |
| Authoring effort | 2 | Coordinates required; layout help not in the repo |
| AI and generation | 3.5 | Terraform loop and verify tools work; no text to spec; no one-command demo |
| Performance | 4 | 20 to 45 ms per step in a production build; the estate takes about 1.5 s to route |
| Accessibility | 4.5 | WCAG-driven tests for contrast, targets, focus and reflow; some of those fail on WebKit CI |
| Packaging and adoption | 1.5 | Not on npm; the portfolio still has its own copy; CI red |
| Code health and tests | 3.5 | 452 unit and 248 browser tests; one giant component; non-reproducible tooling |

## The five moves to exceptional

1. **Ship it (M).** Green CI first (S): fix the 6 WebKit failures or skip them on Linux with a written reason. Then a public demo built from git (no AWS icons), npm publish (the package checks already run), and a written portfolio swap-in for Girish to apply from a portfolio session.
2. **Authoring without coordinates (M to L).** Make `at` optional with auto-placement by layer, zone and links; bring the annealer into the repo and score it on routed arrows. Fixes the adoption barrier and the crossing regression together.
3. **Collapse and drill down on zones (L).** A zone shown as one card that expands is what makes 160 cards usable.
4. **One-command AI demo (M).** Terraform (later text) in; spec, verify results and live diagram out.
5. **Reproducible and maintainable (M).** Move the stress builders and probes into `tools/`, split `ArchDiagram.tsx` (view, interaction, trace), run the stress diagrams as a CI regression check.

## Already strong

Spec-driven with schema, lint and drift checks; real accessibility work and a large test suite; a distinctive isometric floors view and request trace; no dependencies beyond React; the Terraform path and verify server already exist.
