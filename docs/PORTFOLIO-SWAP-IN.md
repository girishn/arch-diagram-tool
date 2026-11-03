# Portfolio swap-in (for a portfolio session to apply)

This repo does not edit the portfolio (`girishn-portfolio`). This note says what to change there, written from an earlier copy of the portfolio's diagram code and not checked against the live portfolio repo, so confirm each step there.

## Before starting

- The package is on npm (or install from git: `npm i github:girishn/arch-diagram-tool` once the repo is public).
- The portfolio uses Next.js 16 and React 19; the package needs React 19 as a peer and its main entry starts with `"use client"`, so a server file may import it.

## Steps

1. **Install** `arch-diagram-tool` in the portfolio.
2. **Turn the data into a spec.** `src/lib/architecture-data.ts` (`NODES`, `TRACE`, links) becomes one JSON spec (see `examples/*.json` and `docs/SCHEMA.md`). Each node needs `at {col,row}`, `icons`, and a `detail` (role, why, trade-off). Run `node scripts/lint.ts <spec>` from this repo until it reports 0 errors and 0 warnings.
3. **Replace the renderer.** Delete `components/ArchitectureDiagram.tsx` and make `components/ArchitectureExplorer.tsx` a thin wrapper:
   `import { ArchExplorer } from "arch-diagram-tool"` and render `<ArchExplorer spec={spec} theme=... iconPack={...} />`. The page file (`app/architecture/page.tsx`) does not change.
4. **Theme.** The portfolio's `ACTIVE_THEME` maps onto the package's `--adg-*` theme values (`themeStyle`, `src/themes.ts`); pass a theme object or pick a built-in one.
5. **Icons.** The portfolio already serves AWS icons from `public/aws-icons/`. The package never bundles them. Build an icon pack from those files (`packFromSvgMap` in `arch-diagram-tool/core`) in the portfolio, so the portfolio, not this package, carries the AWS icon files and their terms.
6. **Drift check.** Add `node scripts/tf.ts check <plan.json> --spec <spec>` (or the `ci` script) to the portfolio's CI against `backend/terraform`, so the page cannot drift from the infrastructure. Share only stripped plan files (`tf.ts strip`); raw `terraform show -json` output contains secrets.
7. **Open issues** listed in `docs/CONTEXT.md` section 3 (lost information such as Titan Embeddings v2, the SSM system prompt and the model name) are fixed by editing the spec, not the renderer.

## After

Check the page at 375 px, in both views, with the keyboard, and with reduced motion on. The package's own tests cover those, but the portfolio's theme and icons are new inputs.
