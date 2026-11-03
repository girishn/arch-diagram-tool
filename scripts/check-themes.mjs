// WCAG contrast check for every built-in theme. Exits 1 if a pair falls short. The maths lives in contrast.ts, which the unit tests share.
import { THEMES } from "../src/themes.ts";
import { themeContrastFailures, zoneContrastFailures } from "./contrast.ts";

let failed = 0;
for (const t of THEMES) {
  const bad = [...themeContrastFailures(t), ...zoneContrastFailures(t)];
  console.log(`${t.id.padEnd(10)} ${bad.length ? "FAIL" : "ok"}`);
  for (const p of bad) console.log(`   ${p.fg} on ${p.bg}: ${p.ratio.toFixed(2)} < ${p.min}  (${p.use})`);
  failed += bad.length;
}
if (failed) process.exitCode = 1;
