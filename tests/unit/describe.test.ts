import { describe, expect, it } from "vitest";
import { connectionsOf, describeConnections, linkTraits, zonePath } from "../../src/index.ts";
import { EXAMPLES } from "./examples.ts";

const simple = EXAMPLES.find((e) => e.file === "simple-web-app")!.spec;

describe("describeConnections", () => {
  it("says what a component sends and receives, in words", () => {
    const text = describeConnections(simple, "api");
    expect(text).toContain("Outgoing: Invoke to Function");
    expect(text).toContain("Incoming: POST /items from Browser");
    expect(text).toContain("ingress"); // the traffic tag is spoken, not only coloured
  });

  it("says so when a component has no connections", () => {
    expect(describeConnections({ nodes: simple.nodes, links: [] }, "api")).toBe("No connections.");
  });

  for (const { file, spec } of EXAMPLES) {
    it(`${file}: every link is described once from each end`, () => {
      const out = spec.nodes.reduce((n, node) => n + connectionsOf(spec, node.id).outgoing.length, 0);
      const inn = spec.nodes.reduce((n, node) => n + connectionsOf(spec, node.id).incoming.length, 0);
      expect(out).toBe(spec.links.length);
      expect(inn).toBe(spec.links.length);
    });
  }
});

describe("linkTraits", () => {
  it("words the properties that colour and line style show", () => {
    const traits = linkTraits({ from: "a", to: "b", label: "x", protocol: "SQS", pattern: "message", twoWay: true, traffic: "egress", offPath: true });
    expect(traits).toEqual(["SQS", "message", "asynchronous", "the reply returns on the same path", "egress", "off the request path"]);
  });

  it("is silent for a plain synchronous request", () => {
    expect(linkTraits({ from: "a", to: "b", label: "x" })).toEqual([]);
  });

  it("calls a dependency a dependency, not data flow", () => {
    expect(linkTraits({ from: "a", to: "b", label: "x", pattern: "dependency" })).toContain("dependency, no data flows");
  });
});

describe("zonePath", () => {
  it("lists the zones a node sits in, outermost first", () => {
    expect(zonePath(simple, "db")).toEqual(["Cloud", "VPC", "Private subnet"]);
    expect(zonePath(simple, "user")).toEqual([]);
  });
});
