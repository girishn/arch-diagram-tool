# Stress test: seven large enterprise diagrams (2026-11-01)

Seven diagrams of 37 to 163 components were built to see how the tool behaves at enterprise size and what to improve. They are in `examples/stress/` and appear in the demo's Example picker (the demo glob was widened to include that folder; the test suite and the PR check do not read it).

Open the demo (`npm run dev`) and pick one, for example `?example=hybrid-landing-zone`.

| Diagram | Cards | Arrows | Layers | Zones | What it exercises |
|---|---|---|---|---|---|
| `retail-omnichannel` | 48 | 59 | 6 | 2 (nested) | Many short and long arrows, microservices, partners, delivery pipeline |
| `bank-payments-core` | 38 | 47 | 5 | 4 | Two data centres, a payments VPC, security and resilience, strict controls |
| `enterprise-data-ml` | 40 | 46 | 6 | 2 | Lakehouse stages, streaming, ML lifecycle, governance across every layer |
| `hybrid-landing-zone` | 39 | 40 | 5 | 12 (up to 3 deep) | Accounts, networks and subnets nested, hub and spoke |
| `iot-connected-fleet` | 37 | 43 | 5 | 2 | Edge to cloud, fan-in, staged updates |
| `k8s-internal-platform` | 46 | 50 | 5 | 7 (nested) | Namespaces as tenants, two clusters, platform services |
| `enterprise-estate` | 163 | 204 | 22 | 10 | The first four merged with cross-platform links: a scale test |

All pass lint with 0 errors. Warnings: 14 on the bank (see 10 below), 20 on the estate, 0 elsewhere.

How they were made: a small builder (declare layers, zones, nodes, links) and a layout search that moves each card inside its own layer's rows and its zone's columns. Both live outside the repo, in the session scratchpad (`...\scratchpad\stress\`: `lib.py`, `anneal.ts`, the diagram scripts, and the `behave.mjs`, `shots.mjs`, `probe2.mjs` browser checks). They hard-code this machine's paths, so move them into the repo only after tidying.

## What was measured

Layout after the search (landscape; the portrait column is the phone layout):

| Diagram | Crossings | Arrows through a card | Arrows sharing a line | Portrait crossings |
|---|---|---|---|---|
| retail-omnichannel | 25 | 13 | 6 | 35 |
| bank-payments-core | 16 | 6 | 3 | 17 |
| enterprise-data-ml | 11 | 8 | 1 | 10 |
| hybrid-landing-zone | 8 | 3 | 0 | 10 |
| iot-connected-fleet | 10 | 2 | 0 | 10 |
| k8s-internal-platform | 14 | 5 | 2 | 19 |
| enterprise-estate | 179 | 63 | 17 | 170 |

These are after a second round of the layout search that also pulls a card with four or more arrows towards the middle of the cards it connects to (see "Hub placement" below). Before that round they were 34, 11, 17, 11, 14, 9 and 201 crossings, and 13, 7, 4, 3, 1, 10 and 58 arrows through cards.

Browser behaviour (Chromium, 1800 x 1100, local dev server):

| Check | Result |
|---|---|
| Console or page errors | None on any diagram |
| Mount time | 360 to 860 ms for 37 to 163 cards |
| Hover response | about 120 ms |
| Switch to isometric | 160 to 340 ms |
| Select a container | about 0.2 s, correct on nested zones (12 containers on the landing zone) |
| Tab order | 14 distinct stops in 14 presses |
| Phone width (375 px) | no sideways scroll on any |
| Bench (`node scripts/bench.mjs 100,200,300`) | mount 193, 289, 368 ms; trace 60, 36, 19 fps; view switch 224, 558, 938 ms; one 379 ms long task at 300 |
| SVG export | 0.7 to 1.3 s; 83 KB (retail) and 284 KB (estate) |
| `describe` (verifier tool) | 18 KB for retail; 65 KB for the estate (about 16,000 tokens) |
| `diff` | correct on an edited copy of retail |

## Findings, most important first

**Layout and routing**

1. **The layout limit is the model, not the search.** The first search on retail gave 34 crossings after 8,000 tries and the same 34 after 25,000. What limits it is the grid with layer rows, and arrows drawn as straight segments, so a long link is a diagonal across the diagram. Fixes: the orthogonal router with channels (backlog L1), or an automatic layout (L2) tried on these seven diagrams rather than the small examples the S7 spike used. The spike found ELK did not beat hand layouts on the small examples; these are 37 to 163 cards.
2. **No automatic placement.** A diagram of this size cannot be placed by hand, and the search I wrote is not part of the tool. A `layout` command that fills `at` for a spec with layers and zones would make large diagrams practical. The builder here is a start.
3. **Arrows still pass through cards** (1 to 13 per diagram after the search; 58 on the estate), and a few share a line.

**Legibility**

4. **Text is unreadable at the default fit.** On a 1800 px window the smallest card name is 4.7 to 5.8 px and the smallest arrow label 3.4 to 4.1 px; at 375 px the card names are 2.1 to 2.6 px. A person has to zoom before reading anything. Ideas: a minimum text size with the diagram scrolling or panning instead of shrinking; hide arrow labels below a zoom level and show them on hover; "focus a layer" (fit one layer to the stage).
5. **Arrow labels cover cards.** A label's button stays 24 px on screen (WCAG 2.5.8) however far the diagram is scaled down, so at 1280 px wide the centre of 17 of 48 retail cards (35%) and 19 of 39 landing-zone cards (49%) lies under a label, and on the estate 125 of 163. A click there goes to the arrow, not the card. Ideas: below a scale, labels become hover-only; put labels under the cards in stacking order; nudge labels off cards.

**Zones and bands**

6. **Zone labels collide.** 0 to 2 per diagram land on a layer's band label or another zone's label (retail, data-ml and landing zone). A zone's box reaches 112 px above and 60 px below its cards, so a zone near the edge of a layer spills into the next band (landing zone: "Production account" sits in the hub band).
7. **A parent zone with no cards of its own** puts its label on top of its child's (retail: "Region A" and "Kubernetes cluster A").

**Isometric floors**

8. **The ground plane is still drawn** in the floors view as a large dark parallelogram offset from the floors. It adds clutter in every isometric screenshot. Hide it, or fit it to the floors.
9. **Many layers do not fit well.** With 22 floors the stack fills about a quarter of the stage width and the cards are tiny. Six floors is fine. Ideas: collapse floors, or select one floor to bring forward.

**Authoring and checks**

10. **Lint is noisy at this size.** `traffic-untagged` fires once per link that crosses a zone edge (14 on the bank), and `trace-unvisited-node` needs a `lintIgnore` entry for every supporting card (18 to 38 per diagram). A per-zone default traffic direction, and ignoring a whole layer or plane, would remove most of it.
11. **Arrows are only coloured under the Planes lens** unless an author writes a fact on every arrow. Security, Cost and Risks colour cards but not arrows, so these diagrams read as one colour of line.
12. **Heading order.** Axe reports `heading-order` on every diagram: the info strip uses an `h3` under the demo page's `h1`. The heading level should be a prop.
13. **The PR check does not recurse** into subfolders, so `examples/stress/` is not linted by `scripts/ci.ts` (11 diagrams). Fine here; worth an option for a real repo with nested spec folders.
14. **`describe` has no filter.** At 163 cards its output is 65 KB. A layer, zone or neighbourhood filter would keep it usable for an agent.

## Hub placement (tried after the first review)

The owner noted that a card with many arrows (the retail event backbone has 12) sat off to one side with the arrows fanning across the floor, and asked for the renderer to place such a card like an inverted tree: under the cards that feed it and over the cards it feeds.

- **As a renderer step: tried, not kept.** A deterministic pass that moves each card along its row to the mean column of its neighbours (a standard crossing-reduction heuristic, with cards of one container kept together) did shorten arrows by 10 to 25%, but it increased crossings and arrows through cards on all four diagrams tried (retail 34 to 43 crossings and 13 to 26 through-card; bank 11 to 18 and 7 to 27). Arrows are straight lines that ignore cards, and a tree layout lines cards up in columns, so a vertical arrow runs straight through the cards between its ends. A step that is only kept when it scores no worse changed none of the seven diagrams, so it was not added.
- **As a layout-search term: kept.** Adding "distance of a many-arrow card from the middle of its neighbours" to the search that places the cards (outside the tool) gives the look wanted without more through-card arrows: the retail event backbone now sits under the domain services that feed it, and total crossings across the six diagrams fell from 96 to 84 with arrows through cards 38 to 37. It is not uniform: bank crossings rose from 11 to 16 and the Kubernetes diagram from 9 to 14 (through-card arrows there fell from 7 to 6 and from 10 to 5).
- **What would make the renderer step work:** an arrow router that goes around cards (backlog L1). Then a tree layout costs nothing, and the placement can be done by the tool for any spec.

## Routing around cards (built after the research)

The owner asked what other diagramming tools do about arrows (libavoid and the Wybrow papers, React Flow's smart edges, D2's TALA, yFiles bundling and folding, draw.io line jumps, Structurizr dynamic views) and chose three things: ports spread along a card's edge, line hops at crossings, and a router that goes around cards. After a first look the hops were removed (they read wrongly in the isometric views), and the router became the default.

Measured on the six 37 to 48 card diagrams, straight against routed:

| | Straight | Routed |
|---|---|---|
| Arrows through a card | 37 (the layout test's measure) | 1 in total (against the real card outline) |
| Arrows sharing a line | 12 in total | 0 to 2 |
| Crossings | 84 | about 110 to 120 |
| Cable length | 147,000 px | 187,000 px |
| Slanted arrows | most of them | none, on every example in both views |

Crossings rise because right-angle routes cross where straight lines happen not to, and the cable is longer for the same reason. On the 163-card estate routing takes about 1.5 s. The layouts were placed by a search that scored straight lines; a search that scores routed arrows should bring the crossings down, and is the obvious next step.

## What worked

- Nested zones render cleanly, including three levels (account, network, subnet) and namespaces inside clusters.
- Selecting a container (new this week) works at every depth and lit the right neighbours.
- No errors, no sideways scroll at 375 px, a usable tab order, and the performance numbers above up to about 200 cards.
- Lint, `diff`, SVG export and the trace handled every diagram, including the 37-step trace on the estate.

## Suggested next steps

In order of value for the effort: 5 (arrow labels covering cards), 4 (text size at fit), 8 (ground plane), 10 (lint noise), 6 and 7 (zone labels), then 1 and 2 as the larger piece.
