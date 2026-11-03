# Context handoff — from the portfolio session

Written 2026-10-29 by Claude from the girishn-portfolio session (branched as "diagramming-tool").

## 1. Origin

The portfolio site (girishn.cloud) has an `/architecture/` page that explains the "digital twin" chat backend: Browser → CloudFront/S3 → API Gateway → Lambda → (Cognito, DynamoDB rate limits, S3 sessions, S3 Vectors RAG) → Guardrails → Bedrock model, plus a CloudTrail + Budgets governance group.

It went through three iterations driven by Girish's feedback:

1. **List explorer** — "not much helpful".
2. **three.js 3D scene** — liked the 3D plane, interactivity and flow arrows; disliked the non-standard shapes ("not like AWS icons"), "not professional", misaligned shapes, and no top view. Research (including iCraft, which is proprietary and ruled out) recommended a flat diagram with an isometric toggle.
3. **Flat ↔ isometric CSS-3D diagram with official AWS icons** — "this looks awesome". Then refined: bigger icons and labels, theme-matched framing (brass borders, serif name plates), hover focus, clickable arrows with explanations, Flow/Security/Cost lenses, an info strip. Girish then said he wants to build a tool to generate diagrams like this.

Live on stage: https://stage.girishn.cloud/architecture/ (not yet merged to prod).

## 2. How the original renderer works (the portfolio's `ArchitectureDiagram.tsx`)

- **Plane + billboards.** A plane (`transform-style: preserve-3d`) is transformed with `translateY() scale() rotateX() rotateZ()`. A flat child layer (`transform-style: flat`) holds the grid, zones, SVG cables and pads. Each component card is an upright "billboard" placed in an anchor with the inverse transform `rotateZ(-rz) rotateX(-rx)`, origin at the ground contact point. Cards always sit above their anchor so they never sink under the plane.
- **Defaults.** Isometric angles `rx 40, rz -24`; drag-to-rotate clamps rx to 30–75; zoom 0.6–1.8; top view is `rx = rz = 0`.
- **Layout.** Grid coordinates (col, row) map to plane pixels. Landscape flows left to right, and portrait (<720px) flows top to bottom. The plane is auto-fitted to the stage by projecting its rotated bounding box.
- **Cables.** SVG orthogonal polylines with rounded corners, arrow markers, a marching-dash flow animation, a wide invisible hit path for hover and click, and waypoints via `via`.
- **Trace pulse.** BFS over the link graph gives a hop route. The pulse follows the real cable geometry with `getPointAtLength`.
- **Interaction.** Hover focus dims unrelated nodes and edges. Edge chips (labels) are shown always in landscape top view, otherwise only on hover, select or route. The info strip below the stage shows the detail for the hovered or selected node or edge. Lenses show a short fact badge on each card.
- **Spec shape** (`architecture-data.ts`): `DIAGRAM_NODES` (id, col, row, icons[], tile, label, sub, sec, cost), `DIAGRAM_LINKS` (from, to, via?, dashed?, labelAt?, label, detail), `DIAGRAM_ZONES` (label, c0, r0, c1, r1, kind), and `NODES` (rich per-node detail: role, why, tradeoff, security, cost) and `TRACE` (ordered request steps). This is the natural seed for the public schema.

## 3. Open issues on the portfolio version (reported by Girish, not yet fixed)

These are against the portfolio copy and should be fixed there. They also tell you what the generic renderer must get right.

1. **Isometric base plane looks disfigured, not a clean rectangle.** Likely causes: `box-shadow: 0 30px 50px` on the flat layer reads as a skewed offset once rotated; the AWS Cloud zone sits almost flush with the plane's right, top and bottom edges, producing doubled lines. Fix idea: symmetric margins, no offset shadow (or a uniform glow), a visible slab thickness.
2. **Arrow labels get hidden behind icons.** Edge chips render before cards in the DOM, so cards cover them, and some cable midpoints land inside a card's footprint (for example "Verify token", "Rate check", "History" in top view). Fix idea: render chips after cards with a higher z-index, and route label placement away from node footprints (collision-aware `labelAt`).
3. **Grouped icons have no individual labels.** The Governance node shows CloudTrail and Budgets icons under one name. Fix idea: per-icon captions.
4. **Information lost in diagramming.** For example Titan Embeddings v2 is not a component (RAG shows only S3 Vectors); the model is labelled "Converse API model" without saying Nova Lite; the SSM Parameter Store system prompt is absent; Cloudflare DNS is only in the text. Fix idea: add Titan v2 as its own node (Lambda → embed → S3 Vectors), add an SSM node, name the model, and audit every node against `NODES`. An Systems Manager icon (`systems-manager.svg`) has already been copied into the portfolio's `public/aws-icons/` (uncommitted) for this.

A design lesson for the tool: the data spec should make "every real component and every detail in the long-form descriptions has a place on the diagram" checkable, for example by linting that each described component appears as a node.

## 4. Product thinking so far

- **Gap.** draw.io, Lucidchart, Cloudcraft and iCraft are drawing editors. Mermaid, D2 and Structurizr are diagrams-as-code but give static output. Few tools offer a diagram defined as data with flat↔isometric views, lenses, a request trace and per-component explanations. That combination is the niche: an architecture explainer, not a drawing tool.
- **Differentiators to build toward:** (a) generate the spec from Terraform (`terraform show -json`) or from a plain-English description via an LLM; (b) lenses and trace as first-class spec features; (c) lint for missing or undescribed components.
- **Risks.**
  - AWS icon licensing is unverified, so ship with generic shapes or user-supplied packs.
  - Safari support for CSS 3D is untested.
  - Real-device touch (rotate and pinch) is untested.
  - Scope creep versus the job search.
- **Suggested staging.** (1) schema with validation, (2) standalone renderer package plus demo, (3) generator CLI, (4) only then consider a hosted editor.

## 5. Integration with the portfolio

Girish asked whether the two projects should integrate. Yes, in one direction:

- The portfolio becomes a **consumer**: it depends on the published renderer package and holds only its own spec file (the digital twin) plus its icon assets.
- This repo owns the schema, renderer, validator and generators.
- A generator can run in the portfolio's CI against `backend/terraform` to emit or check the spec, so the page cannot drift from the real infrastructure. That is also the strongest demo of the tool.
- Until the package exists, the portfolio keeps its own copy. Do not change the portfolio from here.
- Migration is simple: replace the portfolio's `ArchitectureDiagram.tsx` with an import, keep `architecture-data.ts` as a spec file.

## 6. Environment notes

- Windows 11, Git Bash and PowerShell. Node and npm are installed. The portfolio uses Next.js 16, React 19 and Tailwind 4.
- Local AWS credentials were expired at last check, so anything touching AWS or Bedrock may need `aws sso login` first. Terraform state for the portfolio lives in S3 bucket `girishn-portfolio`; a generator should read plan or state JSON rather than hit AWS directly.
- Next to this repo is `../arch-tool` (archwright, an ADR/trade-off explorer). Girish's decision: this tool is a good future extension or integration for archwright (a chosen decision becomes a diagram), but it stays a **separate project for now**, and the integration comes later. Until then, do not modify archwright, and keep the spec and renderer free of archwright-specific coupling so the integration stays easy.
