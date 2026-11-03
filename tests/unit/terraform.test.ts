import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { measure } from "../../src/measure.ts";
import { canonical, checkSpec, generateFromPlan, generateFromPlans, sqlTables, stripPlan } from "../../src/terraform.ts";
import type { Overlay } from "../../src/terraform.ts";

const dir = new URL("../fixtures/terraform/", import.meta.url);
const read = (f: string) => JSON.parse(readFileSync(new URL(f, dir), "utf8"));
const plan = () => read("docs-assistant.plan.json");
const overlay = (): Overlay => read("docs-assistant.overlay.json");
const gen = (p = plan(), o: Overlay = overlay()) => generateFromPlan(p, o);

describe("generateFromPlan", () => {
  it("draws mapped resources and reports what it did not draw", () => {
    const { spec, report } = gen();
    expect(report.errors).toEqual([]);
    expect(report.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(spec.nodes.map((n) => n.id).sort()).toEqual(["api-chat", "bucket-docs", "client", "fn-chat", "fn-ingest", "kb-docs", "model", "queue-ingest", "queue-ingest-dlq", "search-vectors", "table-sessions"]);
    expect(report.unmapped).toEqual({ aws_ssm_parameter: 1 });
    expect(report.skipped).toEqual({ aws_security_group: 1 });
  });

  it("collapses count instances into one card and says how many", () => {
    const n = gen().spec.nodes.find((x) => x.id === "fn-ingest")!;
    expect(n.scale).toEqual({ min: 2, max: 2, unit: "instances" }); // drawn as a stacked card with a badge
  });

  it("derives links from connector resources, IAM permissions and references", () => {
    const pairs = gen().spec.links.map((l) => `${l.from}>${l.to}:${l.label}`);
    expect(pairs).toContain("api-chat>fn-chat:Invokes"); // aws_lambda_permission beats the integration's "Routes to"
    expect(pairs).toContain("queue-ingest>fn-ingest:Triggers"); // event source mapping
    expect(pairs).toContain("fn-chat>table-sessions:Uses (IAM)"); // through the role, the policy and the policy document
    expect(pairs).toContain("fn-chat>kb-docs:Uses (IAM)");
    expect(pairs).toContain("kb-docs>search-vectors:Uses"); // a plain reference, from a nested block
    expect(pairs).toContain("queue-ingest>queue-ingest-dlq:Uses"); // through a module output
  });

  it("puts the function in its subnet, the subnet in its VPC, and tags traffic that crosses the VPC edge", () => {
    const { spec } = gen();
    const subnet = spec.zones!.find((z) => z.kind === "subnet")!;
    expect(subnet.members).toEqual(["fn-chat"]);
    expect(subnet.parent).toBe("vpc-main");
    const by = (a: string, b: string) => spec.links.find((l) => l.from === a && l.to === b)!;
    expect(by("api-chat", "fn-chat").traffic).toBe("ingress");
    expect(by("fn-chat", "table-sessions").traffic).toBe("egress");
    expect(by("queue-ingest", "fn-ingest").traffic).toBeUndefined();
  });

  it("places every card in its own cell, left to right along the links", () => {
    const { spec } = gen();
    expect(new Set(spec.nodes.map((n) => `${n.at.col},${n.at.row}`)).size).toBe(spec.nodes.length);
    const at = (id: string) => spec.nodes.find((n) => n.id === id)!.at;
    expect(at("client").col).toBeLessThan(at("api-chat").col);
    expect(at("api-chat").col).toBeLessThan(at("fn-chat").col);
    expect(measure(spec, false).crossings.length).toBe(0);
  });

  it("is deterministic: resource order in the plan does not matter", () => {
    const p = plan();
    p.planned_values.root_module.resources.reverse();
    p.configuration.root_module.resources.reverse();
    expect(canonical(gen(p).spec)).toBe(canonical(gen().spec));
  });

  it("draws cards from a state file, with a warning that no links can be derived", () => {
    const p = plan();
    const state = { format_version: "1.0", values: p.planned_values };
    const { spec, report } = generateFromPlan(state, { version: 1 });
    expect(spec.nodes.length).toBeGreaterThan(5);
    expect(spec.links).toEqual([]);
    expect(report.warnings[0]).toMatch(/no configuration/);
  });

  it("refuses input that is not a plan or state", () => {
    expect(() => generateFromPlan({ hello: 1 })).toThrow(/not a Terraform plan/);
    expect(() => generateFromPlan("x")).toThrow();
  });
});

describe("overlay", () => {
  it("merges detail instead of replacing it, and pins a cell", () => {
    const o = overlay();
    o.nodes!["fn-chat"] = { detail: { why: "New reason" }, at: { col: 7, row: 3 } };
    const n = gen(plan(), o).spec.nodes.find((x) => x.id === "fn-chat")!;
    expect(n.detail).toMatchObject({ why: "New reason", tag: "aws_lambda_function" });
    expect(n.at).toEqual({ col: 7, row: 3 });
  });

  it("can be keyed by Terraform address", () => {
    const o = overlay();
    o.nodes = { "aws_dynamodb_table.sessions": { label: "Chat history" } };
    expect(gen(plan(), o).spec.nodes.find((x) => x.id === "table-sessions")!.label).toBe("Chat history");
  });

  it("fails on keys that match nothing, so a stale overlay cannot pass CI", () => {
    const o = overlay();
    o.nodes!["fn-gone"] = { label: "x" };
    o.links = { "a>b": { label: "x" } };
    o.hide = ["nothing"];
    o.zones = { nope: { label: "x" } };
    const { report } = gen(plan(), o);
    expect(report.errors).toHaveLength(4);
    expect(report.errors.join("\n")).toMatch(/fn-gone[\s\S]*a>b[\s\S]*nope[\s\S]*nothing/);
  });

  it("fails when an added node clashes with a generated id", () => {
    const o = overlay();
    o.addNodes!.push({ id: "fn-chat", label: "dup", icons: ["compute"] });
    expect(gen(plan(), o).report.errors[0]).toMatch(/fn-chat/);
  });

  it("hides a node together with its links", () => {
    const o = overlay();
    o.hide = ["aws_sqs_queue.ingest"];
    const { spec, report } = gen(plan(), o);
    expect(spec.nodes.some((n) => n.id === "queue-ingest")).toBe(false);
    expect(spec.links.some((l) => l.from === "queue-ingest" || l.to === "queue-ingest")).toBe(false);
    expect(report.errors).toEqual([]);
  });
});

describe("checkSpec (drift)", () => {
  it("the committed spec matches what the plan and overlay generate", () => {
    expect(checkSpec(gen().spec, read("docs-assistant.spec.json")).ok).toBe(true);
  });

  it("notices a resource added to Terraform and says which card is missing", () => {
    const p = plan();
    p.planned_values.root_module.resources.push({ address: "aws_sns_topic.alerts", mode: "managed", type: "aws_sns_topic", name: "alerts", values: {} });
    p.configuration.root_module.resources.push({ address: "aws_sns_topic.alerts", mode: "managed", type: "aws_sns_topic", name: "alerts", expressions: {} });
    const c = checkSpec(gen(p).spec, read("docs-assistant.spec.json"));
    expect(c.ok).toBe(false);
    expect(c.diff!.nodes.added).toEqual(["topic-alerts"]); // the plan has it, the committed spec does not
  });

  it("notices a removed link and a hand edit to the committed spec", () => {
    const p = plan();
    p.configuration.root_module.resources = p.configuration.root_module.resources.filter((r: { address: string }) => r.address !== "aws_lambda_event_source_mapping.ingest");
    expect(checkSpec(gen(p).spec, read("docs-assistant.spec.json")).ok).toBe(false);
    const edited = read("docs-assistant.spec.json");
    edited.nodes[0].label = "Edited by hand";
    expect(checkSpec(gen().spec, edited).ok).toBe(false);
  });
});

describe("tf CLI", () => {
  const f = (n: string) => `tests/fixtures/terraform/${n}`;
  const run = (...a: string[]) => spawnSync(process.execPath, ["scripts/tf.ts", ...a], { encoding: "utf8", timeout: 20000 });
  it("check exits 0 when the committed spec matches and 1 on drift", () => {
    expect(run("check", f("docs-assistant.plan.json"), "--overlay", f("docs-assistant.overlay.json"), "--spec", f("docs-assistant.spec.json")).status).toBe(0);
    const drifted = run("check", f("docs-assistant.plan.json"), "--spec", f("docs-assistant.spec.json")); // no overlay: the hand-written parts are gone
    expect(drifted.status).toBe(1);
    expect(drifted.stderr).toMatch(/drifted/);
  });
  it("pin freezes positions into the overlay and leaves existing pins alone", () => {
    const tmp = join(mkdtempSync(join(tmpdir(), "tf-")), "o.json");
    copyFileSync(f("docs-assistant.overlay.json"), tmp);
    expect(run("pin", f("docs-assistant.plan.json"), "--overlay", tmp).status).toBe(0);
    const pinned = JSON.parse(readFileSync(tmp, "utf8")) as Overlay;
    expect(Object.values(pinned.nodes!).filter((n) => n.at).length).toBe(9); // the nine generated cards (the two added nodes are not pinned)
    // With every card pinned, a plan with one link fewer moves nothing.
    const p = plan();
    p.configuration.root_module.resources = p.configuration.root_module.resources.filter((r: { address: string }) => r.address !== "aws_lambda_event_source_mapping.ingest");
    const before = gen().spec.nodes.map((n) => [n.id, n.at]);
    const after = generateFromPlan(p, pinned).spec.nodes.filter((n) => before.some(([id]) => id === n.id)).map((n) => [n.id, n.at]);
    for (const [id, at] of before) if (pinned.nodes![id as string]) expect(after.find(([i]) => i === id)![1]).toEqual(at);
  });
});

describe("several plans, one card per instance, permissions from values", () => {
  const kd = "kafka/";
  const kread = (f: string) => read(kd + f);
  const inputs = () => [
    { name: "kafka-topics", plan: kread("kafka-topics.state.json") },
    { name: "kafka-rbac", plan: kread("kafka-rbac.state.json") },
    { name: "eks", plan: kread("eks.plan.json") },
    { name: "ecr", plan: kread("ecr.plan.json") },
    { name: "flink", plan: kread("flink.plan.json") },
  ];
  const all = () => generateFromPlans(inputs(), { version: 1 });

  it("draws one card per for_each instance, named from an attribute", () => {
    const { spec } = all();
    const ids = spec.nodes.map((n) => n.id);
    expect(ids.filter((i) => i.startsWith("topic-"))).toHaveLength(17);
    expect(ids.filter((i) => i.startsWith("svc-"))).toHaveLength(9); // `svc-replay-tool`, not `svc-svc-replay-tool`
    expect(ids.filter((i) => i.startsWith("repo-"))).toHaveLength(5);
    expect(spec.nodes.find((n) => n.id === "topic-orders-order-placed")!.label).toBe("orders.order.placed");
    expect(spec.nodes.find((n) => n.id === "eks")!.label).toBe("EKS cluster"); // `this` is not a name
  });

  it("marks matching instances as tooling (dead-letter topics)", () => {
    const { spec } = all();
    const dlt = spec.nodes.filter((n) => n.id.endsWith("-dlt"));
    expect(dlt).toHaveLength(8);
    expect(dlt.every((n) => n.peripheral)).toBe(true);
    expect(spec.nodes.find((n) => n.id === "topic-orders-order-placed")!.peripheral).toBeUndefined();
  });

  it("turns topic ACLs into Reads and Writes arrows, and ignores the rest", () => {
    const { spec, report } = all();
    const has = (a: string, b: string, label: string) => spec.links.some((l) => l.from === a && l.to === b && l.label === label);
    expect(has("topic-orders-order-placed", "svc-order-saga", "Reads")).toBe(true); // data flows topic to reader
    expect(has("svc-order-saga", "topic-orders-order-confirmed", "Writes")).toBe(true); // and writer to topic
    const acl = spec.links.filter((l) => (l.label === "Reads" || l.label === "Writes") && !l.from.startsWith("flink-") && !l.to.startsWith("flink-"));
    expect(acl).toHaveLength(55); // 59 ACLs, less the cluster, group, prefixed-topic and DESCRIBE ones
    expect(report.unresolved).toBe(0);
  });

  it("counts permission arrows it cannot resolve instead of guessing (values unknown before apply)", () => {
    const i = inputs();
    for (const r of i[1]!.plan.values.root_module.resources) if (r.type === "confluent_kafka_acl") delete r.values.principal;
    const { spec, report } = generateFromPlans(i, { version: 1 });
    expect(spec.links.filter((l) => (l.label === "Reads" || l.label === "Writes") && !l.from.startsWith("flink-") && !l.to.startsWith("flink-"))).toHaveLength(0); // the Flink arrows come from SQL, which is still known
    expect(report.unresolved).toBe(56); // every ACL that would be drawn has lost its principal (55 literal and 1 prefixed); the cluster, group and DESCRIBE ones never apply
  });

  it("keeps resources of different plans apart when addresses are equal", () => {
    const one = kread("eks.plan.json");
    const { report } = generateFromPlans([{ name: "a", plan: one }, { name: "b", plan: one }], { version: 1 });
    expect(report.nodes).toBe(4); // cluster and node group, twice
  });

  it("lays out unconnected groups apart, so a zone never swallows another group's cards", () => {
    const { spec } = generateFromPlans(inputs(), { ...read("kafka/kafka.overlay.json") });
    const zone = spec.zones!.find((z) => z.kind === "subnet")!;
    const inZone = spec.nodes.filter((n) => zone.members!.includes(n.id));
    const rows = inZone.map((n) => n.at.row);
    const others = spec.nodes.filter((n) => !zone.members!.includes(n.id) && !(spec.zones ?? []).some((z) => z.members?.includes(n.id) && z.id !== zone.id));
    for (const o of others) expect(o.at.row < Math.min(...rows) || o.at.row > Math.max(...rows)).toBe(true);
  });

  it("the committed Kafka spec matches what the plans and overlay generate", () => {
    const { spec } = generateFromPlans(inputs(), kread("kafka.overlay.json"));
    expect(checkSpec(spec, kread("kafka.spec.json")).ok).toBe(true);
  });
});

describe("stripPlan", () => {
  it("removes values, keys and secrets, and the diagram does not change", () => {
    const raw = read("kafka/kafka-rbac.state.json");
    const text = JSON.stringify(raw);
    expect(text).toContain("SHOULD-NOT-SURVIVE");
    const stripped = stripPlan(raw);
    const out = JSON.stringify(stripped);
    expect(out).not.toMatch(/SHOULD-NOT-SURVIVE|rest_endpoint|host|description/);
    const topics = read("kafka/kafka-topics.state.json");
    const a = generateFromPlans([{ name: "t", plan: topics }, { name: "r", plan: raw }]);
    const b = generateFromPlans([{ name: "t", plan: stripPlan(topics) }, { name: "r", plan: stripped }]);
    expect(canonical(b.spec)).toBe(canonical(a.spec));
  });

  it("keeps references and drops constants", () => {
    const stripped = stripPlan(plan()) as { configuration: { root_module: { resources: { address: string; expressions: Record<string, unknown> }[] } } };
    const fn = stripped.configuration.root_module.resources.find((r) => r.address === "aws_lambda_function.chat")!;
    expect(JSON.stringify(fn.expressions)).toContain("aws_iam_role.chat");
    const vpc = stripped.configuration.root_module.resources.find((r) => r.address === "aws_vpc.main")!;
    expect(vpc.expressions).toEqual({});
    expect(canonical(gen(stripPlan(plan()), overlay()).spec)).toBe(canonical(gen().spec));
  });
});

describe("tf CLI, several plans and strip", () => {
  const run = (...a: string[]) => spawnSync(process.execPath, ["scripts/tf.ts", ...a], { encoding: "utf8", timeout: 20000 });
  const k = (n: string) => `tests/fixtures/terraform/kafka/${n}`;
  it("strip prints a file with no secrets that generates the same diagram", () => {
    const r = run("strip", k("kafka-rbac.state.json"));
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/SHOULD-NOT-SURVIVE/);
    expect(JSON.parse(r.stdout).values.root_module.resources.length).toBeGreaterThan(0);
  });
  it("check works across several plans", () => {
    const r = run("check", k("kafka-topics.state.json"), k("kafka-rbac.state.json"), k("eks.plan.json"), k("ecr.plan.json"), k("flink.plan.json"), "--overlay", k("kafka.overlay.json"), "--spec", k("kafka.spec.json"));
    expect(r.status).toBe(0);
  });
  it("generate reports permission arrows it could not resolve", () => {
    const r = run("generate", k("kafka-topics.state.json"), "--out", join(mkdtempSync(join(tmpdir(), "tf-")), "s.json"));
    expect(r.status).toBe(0); // topics alone: no permissions to resolve, and no complaint
    expect(r.stderr).not.toMatch(/could not be resolved/);
  });
});

describe("prefixed ACLs", () => {
  const res = (type: string, name: string, index: string, values: Record<string, unknown>) => ({ address: `${type}.${name}["${index}"]`, mode: "managed", type, name, index, values });
  const state = (acls: Record<string, unknown>[]) => ({
    values: {
      root_module: {
        resources: [
          res("confluent_service_account", "this", "svc-a", { id: "sa-1", display_name: "svc-a" }),
          ...["a.b.c", "a.b.d", "x.y"].map((t) => res("confluent_kafka_topic", "this", t, { topic_name: t })),
          ...acls.map((a, i) => res("confluent_kafka_acl", "this", `acl${i}`, { principal: "User:sa-1", resource_type: "TOPIC", permission: "ALLOW", operation: "READ", ...a })),
        ],
      },
    },
  });
  const arrows = (acls: Record<string, unknown>[]) => generateFromPlan(state(acls));

  it("a prefix reaches every drawn topic that starts with it", () => {
    const { spec } = arrows([{ resource_name: "a.b.", pattern_type: "PREFIXED" }]);
    expect(spec.links.map((l) => `${l.from}>${l.to}`).sort()).toEqual(["topic-a-b-c>svc-a", "topic-a-b-d>svc-a"]);
  });

  it("a prefix that matches nothing drawn is not an error (the topics may not be managed here)", () => {
    const { spec, report } = arrows([{ resource_name: "zzz", pattern_type: "PREFIXED" }]);
    expect(spec.links).toEqual([]);
    expect(report.unresolved).toBe(0);
  });

  it("a literal name that matches nothing is counted, and other patterns are not drawn", () => {
    const { spec, report } = arrows([{ resource_name: "nope", pattern_type: "LITERAL" }, { resource_name: "x.y", pattern_type: "MATCH" }]);
    expect(spec.links).toEqual([]);
    expect(report.unresolved).toBe(1);
  });
});

describe("sqlTables", () => {
  it("finds the tables a statement reads and writes, through quotes, qualifiers and comments", () => {
    const t = sqlTables("INSERT INTO `out.topic` SELECT * FROM `env`.`cluster`.`in.topic` a JOIN other.topic b ON 1=1 -- FROM ignored.topic\n/* JOIN ignored2 */");
    expect(t.writes).toEqual(["out.topic"]);
    expect(t.reads).toEqual(["env.cluster.in.topic", "other.topic"]);
    expect(sqlTables("INSERT INTO o SELECT * FROM TABLE(TUMBLE(TABLE `w.topic`, DESCRIPTOR(t), INTERVAL '1' MINUTE))").reads).toEqual(["w.topic"]); // windowing functions
    expect(sqlTables("CREATE TABLE made (a INT)").reads).toEqual([]);
  });
});

describe("Flink statements", () => {
  it("draw arrows from the topics they read and to the topics they write, found in the SQL", () => {
    const { spec } = generateFromPlans([
      { name: "kafka-topics", plan: read("kafka/kafka-topics.state.json") },
      { name: "flink", plan: read("kafka/flink.plan.json") },
    ]);
    const has = (a: string, b: string, l: string) => spec.links.some((x) => x.from === a && x.to === b && x.label === l);
    expect(has("topic-orders-order-confirmed", "flink-revenue-aggregation", "Reads")).toBe(true);
    expect(has("flink-revenue-aggregation", "topic-analytics-revenue-realtime", "Writes")).toBe(true);
    expect(has("topic-inventory-stock-reserved", "flink-reservation-ttl", "Reads")).toBe(true); // through a qualified name
    expect(has("topic-orders-order-cancelled", "flink-reservation-ttl", "Reads")).toBe(true); // unquoted name with dots
    expect(has("flink-reservation-ttl", "topic-inventory-stock-release-requested", "Writes")).toBe(true);
    expect(spec.links.some((l) => l.from.startsWith("flink-") && l.to === "pool")).toBe(true); // the statement runs on the pool
  });
});

describe("a real plan (made offline by terraform, then stripped)", () => {
  // tests/fixtures/terraform/platform-sim.plan.json is genuine `terraform show -json` output for a simulated AI platform (7 local modules, a for_each module,
  // module outputs passed through three levels), reduced by `strip`. It is the one fixture not written by hand.
  const real = () => read("platform-sim.plan.json");
  const pov = (): Overlay => read("platform-sim.overlay.json");

  it("is read without error and draws the platform", () => {
    const { spec, report } = generateFromPlan(real(), pov());
    expect(report.errors).toEqual([]);
    expect(report.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(spec.nodes.length).toBe(22);
    expect(report.unmapped).toEqual({});
  });

  it("follows module inputs and outputs across three levels, and for_each over a module", () => {
    const { spec } = generateFromPlan(real());
    const has = (a: string, b: string) => spec.links.some((l) => l.from === a && l.to === b);
    expect(has("fn-router", "kb-docs")).toBe(true); // the knowledge base id travels data module, root, gateway module
    expect(has("fn-gateway", "fn-router")).toBe(true); // an IAM policy that names the router
    expect(has("nodes-workers", "eks-platform")).toBe(true); // subnets passed from the network module
    const teams = spec.nodes.find((n) => n.id === "bucket-tenant-docs")!;
    expect(teams.scale).toEqual({ min: 3, max: 3, unit: "instances" });
    expect(teams.detail?.role).toContain("team-risk, team-search, team-support");
  });

  it("points a log group's arrow from the function that logs, and joins a bucket to its key through the encryption setting", () => {
    const { spec } = generateFromPlan(real());
    expect(spec.links.some((l) => l.from === "fn-router" && l.to === "logs-router" && l.label === "Logs to")).toBe(true);
    expect(spec.links.some((l) => l.from === "bucket-docs" && l.to === "key-platform" && l.label === "Encrypted with")).toBe(true);
    expect(spec.links.some((l) => l.from === "fn-router" && l.to === "topic-alerts" && l.label === "Alerts via")).toBe(true);
  });

  it("draws one arrow where a queue triggers a function that also has permission on the queue", () => {
    const { spec } = generateFromPlan(real());
    const pair = spec.links.filter((l) => [l.from, l.to].sort().join() === ["fn-ingest-worker", "queue-ingest"].sort().join());
    expect(pair.map((l) => `${l.from}>${l.to}:${l.label}`)).toEqual(["queue-ingest>fn-ingest-worker:Triggers"]);
  });

  it("the example in examples/ is exactly what this plan and overlay generate", () => {
    const example = JSON.parse(readFileSync(new URL("../../examples/ai-platform-sim.json", import.meta.url), "utf8"));
    expect(checkSpec(generateFromPlan(real(), read("platform-sim.overlay.json")).spec, example).ok).toBe(true);
  });
});
