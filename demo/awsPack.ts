import { packFromSvgMap } from "../src/core.ts";
import type { IconPack } from "../src/icons.tsx";

// Local-only adapter for the official AWS Architecture Icons. The files are gitignored (assets/aws-icons-local-only/) and their
// redistribution terms are unverified, so they are never committed or packaged. Where the folder is absent, as in CI, the glob is
// empty and `awsPack` is null: the demo then simply keeps the generic pack. Opened with ?icons=aws, and only on a machine that has the files.
const files = import.meta.glob("../assets/aws-icons-local-only/*.svg", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const notice = import.meta.glob("../assets/aws-icons-local-only/NOTICE.txt", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;

const stems = Object.fromEntries(Object.entries(files).map(([p, svg]) => [p.split("/").pop()!.replace(/\.svg$/, ""), svg]));

export const awsPack: IconPack | null = Object.keys(stems).length
  ? packFromSvgMap(stems, {
      unmodified: true,
      attribution:
        Object.values(notice)[0]?.replace(/\s+/g, " ").trim() ??
        "AWS and the AWS icons are trademarks of Amazon.com, Inc. or its affiliates. Not affiliated with or endorsed by AWS.",
      aliases: {
        apigw: "api-gateway", api: "api-gateway",
        bucket: "s3", storage: "s3",
        function: "lambda", fn: "lambda",
        auth: "cognito", identity: "cognito",
        llm: "bedrock", model: "bedrock",
        audit: "cloudtrail",
        settings: "systems-manager", ssm: "systems-manager", config: "systems-manager",
        cdn: "cloudfront", edge: "cloudfront",
        table: "dynamodb",
        vector: "s3-vectors",
        guardrails: "security",
      },
    })
  : null;
