import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { esc, MARKER, run } from "../../scripts/ci.ts";

const repoRoot = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...a], { cwd, stdio: "ignore" });

/** A throwaway repository with one committed diagram and the Terraform fixtures. */
function fixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "ci-"));
  mkdirSync(join(dir, "examples"));
  cpSync(join(repoRoot, "examples/simple-web-app.json"), join(dir, "examples/simple-web-app.json"));
  cpSync(join(repoRoot, "tests/fixtures/terraform"), join(dir, "tf"), { recursive: true });
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  return dir;
}
const edit = (file: string, f: (s: any) => void) => {
  const s = JSON.parse(readFileSync(file, "utf8"));
  f(s);
  writeFileSync(file, JSON.stringify(s, null, 2));
};
const tfConfig = {
  specs: ["examples"],
  terraform: [{ name: "Docs", plans: ["tf/docs-assistant.plan.json"], overlay: "tf/docs-assistant.overlay.json", spec: "tf/docs-assistant.spec.json" }],
};

describe("esc", () => {
  it("makes text from a pull request inert in Markdown", () => {
    const hostile = "<img src=x onerror=1> [click](http://evil.example) @someone `code` | table";
    const out = esc(hostile);
    expect(out).not.toMatch(/(?<!\\)[<>[\]()@`|]/);
  });
  it("keeps one short line", () => {
    expect(esc("a\n\n b")).toBe("a b");
    expect(esc("x".repeat(500), 20)).toHaveLength(20);
  });
});

describe("run", () => {
  it("passes on a clean repo and reports no changes", () => {
    const dir = fixtureRepo();
    const r = run(dir, tfConfig, "HEAD");
    expect(r.failed).toBe(false);
    expect(r.markdown).toContain(MARKER);
    expect(r.markdown).toContain("No diagram changed.");
    expect(r.markdown).toMatch(/Docs.*in sync/);
  });

  it("lists what a pull request changed in a diagram, by id", () => {
    const dir = fixtureRepo();
    edit(join(dir, "examples/simple-web-app.json"), (s) => {
      s.nodes[0].label = "Renamed";
      s.links.pop();
    });
    const r = run(dir, tfConfig, "HEAD");
    expect(r.markdown).toContain("nodes changed");
    expect(r.markdown).toContain("links removed");
  });

  it("fails on a lint error and says where", () => {
    const dir = fixtureRepo();
    edit(join(dir, "examples/simple-web-app.json"), (s) => (s.links[0].to = "nope"));
    const r = run(dir, tfConfig, "HEAD");
    expect(r.failed).toBe(true);
    expect(r.markdown).toMatch(/lint error/);
    expect(r.markdown).toContain("link-unknown-node");
  });

  it("fails when a Terraform diagram has drifted, and names the card", () => {
    const dir = fixtureRepo();
    edit(join(dir, "tf/docs-assistant.plan.json"), (p) =>
      p.planned_values.root_module.resources.push({ address: "aws_sns_topic.alerts", mode: "managed", type: "aws_sns_topic", name: "alerts", values: {} }),
    );
    const r = run(dir, tfConfig, "HEAD");
    expect(r.failed).toBe(true);
    expect(r.markdown).toContain("drifted");
    expect(r.markdown).toContain("topic-alerts");
  });

  it("fails when warnings pass the limit", () => {
    const dir = fixtureRepo();
    expect(run(dir, { ...tfConfig, maxWarnings: 1 }, "HEAD").failed).toBe(false); // the sample diagram has one warning
    const r = run(dir, { ...tfConfig, maxWarnings: 0 }, "HEAD");
    expect(r.failed).toBe(true);
    expect(r.markdown).toContain("1 lint warnings");
  });

  it("treats a new file as new", () => {
    const dir = fixtureRepo();
    cpSync(join(dir, "examples/simple-web-app.json"), join(dir, "examples/second.json"));
    expect(run(dir, tfConfig, "HEAD").markdown).toContain("new diagram");
  });
});

describe("a pull request controls the config, so it is not trusted", () => {
  it("refuses paths that leave the repository", () => {
    const dir = fixtureRepo();
    expect(() => run(dir, { specs: ["../elsewhere"] }, undefined)).toThrow(/leaves the repository|no such/);
    const r = run(dir, { specs: ["examples"], terraform: [{ plans: ["../../etc/passwd"], spec: "tf/docs-assistant.spec.json" }] }, undefined);
    expect(r.failed).toBe(true);
    expect(r.markdown).toMatch(/could not run/);
    expect(r.markdown).not.toContain("root:");
  });

  it("refuses a symlink that points outside", () => {
    const dir = fixtureRepo();
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    writeFileSync(join(outside, "secret.json"), '{"secret":"SHOULD-NOT-APPEAR"}');
    try {
      symlinkSync(outside, join(dir, "link"), "junction");
    } catch {
      return; // cannot make a link here
    }
    expect(() => run(dir, { specs: ["link"] }, undefined)).toThrow(/leaves the repository/);
  });

  it("refuses a base ref that looks like an option or a command", () => {
    const dir = fixtureRepo();
    for (const bad of ["--output=x", "main; rm -rf /", "$(id)", "-p", "a b"]) expect(() => run(dir, tfConfig, bad)).toThrow(/not a usable base ref/);
  });

  it("does not let a label inject Markdown into the report", () => {
    const dir = fixtureRepo();
    edit(join(dir, "examples/simple-web-app.json"), (s) => (s.nodes[0].id = "x](http://evil.example)<script>"));
    const r = run(dir, tfConfig, "HEAD");
    expect(r.markdown).not.toContain("<script>");
    expect(r.markdown).not.toMatch(/\]\(http/);
  });
});

describe("the CLI", () => {
  it("exits 0, 1 and 2", () => {
    const dir = fixtureRepo();
    writeFileSync(join(dir, "arch-diagram.config.json"), JSON.stringify(tfConfig));
    const script = join(repoRoot, "scripts/ci.ts");
    const go = (...a: string[]) => spawnSync(process.execPath, [script, ...a], { cwd: dir, encoding: "utf8", timeout: 20000 });
    const ok = go("--base", "HEAD", "--summary", join(dir, "out.md"));
    expect(ok.status).toBe(0);
    expect(readFileSync(join(dir, "out.md"), "utf8")).toContain(MARKER);
    edit(join(dir, "examples/simple-web-app.json"), (s) => (s.links[0].to = "nope"));
    expect(go("--base", "HEAD").status).toBe(1);
    expect(go("--base", "--evil").status).toBe(2);
  });
});
