// What each Terraform resource type becomes in a diagram. Plain data: add a type here, not in the generator.
// Written from the AWS provider's resource names; nothing is copied from another tool.
import type { Pattern, ZoneKind } from "./schema.ts";

/** A resource drawn as a card. `icon` is a generic-pack key (the vendor icon pack may alias it). */
export type NodeRule = {
  kind: "node";
  icon: string;
  /** Prefix of the generated id: `fn` gives `fn-chat`. */
  short: string;
  sub: string;
  role: string;
  peripheral?: boolean;
  /** One card per `for_each` or `count` instance instead of one card with a count. `labelAttr` is the attribute that names each card; `peripheralWhen` marks matching instances as tooling. */
  perInstance?: { labelAttr: string; peripheralWhen?: { attr: string; endsWith: string } };
  /** The card is a job whose SQL names the resources it reads (`FROM`, `JOIN`) and writes (`INTO`): table names in `attr` that equal a drawn `type`'s `on` attribute become arrows. */
  sqlRefs?: { attr: string; type: string; on: string };
  /** Wording for arrows drawn from plain references to this card. `flip` points them the other way, for resources that only watch or record (a log group references the function it logs for, but data flows from the function). */
  refs?: { label: string; flip?: boolean };
};
/**
 * An arrow that is spelled in attribute values, not references (a Kafka ACL names a principal and a topic as strings). Each end finds the drawn resource of
 * `type` whose attribute `on` equals the value (after removing `strip`). `byAttr` picks the direction and label per value, and values with no entry are ignored.
 * Needs known values: a plan made after the first apply, or the state JSON. Unknown values are counted in the report, not guessed.
 */
export type JoinEnd = {
  attr: string;
  strip?: string;
  type: string;
  on: string;
  /** The value names a prefix, not one resource, when `attr` equals `prefixed` (Kafka `PREFIXED` ACLs), and one resource when it equals `literal`. Any other value is not drawn. */
  prefixWhen?: { attr: string; prefixed: string; literal: string };
};
export type JoinRule = { kind: "join"; where: Record<string, string>; a: JoinEnd; b: JoinEnd; byAttr: string; direction: Record<string, "a>b" | "b>a">; label: Record<string, string>; pattern: Pattern; priority: number };
/** A resource drawn as a zone (a VPC or a subnet). `parentAttr` names the attribute that points at the enclosing zone. */
export type ZoneRule = { kind: "zone"; zoneKind: ZoneKind; parentAttr?: string };
/** A resource that is an arrow, not a box: its `from` and `to` attributes point at the two ends. Higher `priority` wins the label when two resources describe the same pair. */
export type EdgeRule = { kind: "edge"; from: string; to: string; label: string; pattern: Pattern; priority: number };
/** Not drawn, but read: IAM roles and policies, and policy documents, which carry the permission edges. */
export type AttachRule = { kind: "attach" };
/** Deliberately not drawn (networking plumbing, tags, encryption settings), counted in the report. */
export type SkipRule = { kind: "skip" };

export type Rule = NodeRule | ZoneRule | EdgeRule | JoinRule | AttachRule | SkipRule;

const node = (icon: string, short: string, sub: string, role: string, peripheral?: boolean, perInstance?: NodeRule["perInstance"], sqlRefs?: NodeRule["sqlRefs"], refs?: NodeRule["refs"]): NodeRule => ({ kind: "node", icon, short, sub, role, ...(peripheral ? { peripheral } : {}), ...(perInstance ? { perInstance } : {}), ...(sqlRefs ? { sqlRefs } : {}), ...(refs ? { refs } : {}) });

export const TF_MAPPING: Record<string, Rule> = {
  // Compute and API
  aws_lambda_function: node("function", "fn", "Lambda function", "Runs code on demand."),
  aws_api_gateway_rest_api: node("api-gateway", "api", "API Gateway", "Public front door for HTTP requests."),
  aws_apigatewayv2_api: node("api-gateway", "api", "API Gateway", "Public front door for HTTP requests."),
  // Data and messaging
  aws_s3_bucket: node("s3", "bucket", "S3 bucket", "Stores objects."),
  aws_dynamodb_table: node("dynamodb", "table", "DynamoDB table", "Key-value and document storage."),
  aws_sqs_queue: node("sqs", "queue", "SQS queue", "Holds work items for one consumer."),
  aws_sns_topic: node("sns", "topic", "SNS topic", "Announces events to subscribers."),
  aws_kms_key: node("kms", "key", "KMS key", "Encryption key."),
  aws_secretsmanager_secret: node("secret", "secret", "Secrets Manager", "Holds a secret."),
  // AI platform
  aws_bedrockagent_agent: node("bedrock", "agent", "Bedrock agent", "Plans steps and calls tools to answer a request."),
  aws_bedrockagent_knowledge_base: node("bedrock", "kb", "Bedrock knowledge base", "Retrieves passages from indexed documents."),
  aws_bedrock_guardrail: node("guardrails", "guardrail", "Bedrock guardrail", "Filters unsafe input and output."),
  aws_opensearchserverless_collection: node("search", "search", "OpenSearch Serverless", "Vector and keyword index."),
  // Observability
  aws_cloudwatch_log_group: node("logging", "logs", "CloudWatch logs", "Collects logs.", true, undefined, undefined, { label: "Logs to", flip: true }),
  // Containers and clusters
  aws_eks_cluster: node("k8s", "eks", "EKS cluster", "Runs the containers."),
  aws_eks_node_group: node("server", "nodes", "EKS node group", "The machines the pods run on."),
  aws_ecr_repository: node("registry", "repo", "ECR repository", "Stores container images.", false, { labelAttr: "name" }),
  kubernetes_namespace: node("k8s", "ns", "Kubernetes namespace", "A named area of the cluster."),
  // Confluent Cloud (Kafka)
  confluent_environment: { kind: "zone", zoneKind: "group" },
  confluent_kafka_cluster: node("stream", "kafka", "Kafka cluster", "Holds the topics."),
  confluent_kafka_topic: node("topic", "topic", "Kafka topic", "A named stream of events.", false, { labelAttr: "topic_name", peripheralWhen: { attr: "topic_name", endsWith: ".dlt" } }),
  confluent_service_account: node("auth", "svc", "Service account", "The identity a service uses to reach Kafka.", false, { labelAttr: "display_name" }),
  confluent_schema: node("registry", "schema", "Schema", "The agreed shape of a topic's messages.", false, { labelAttr: "subject_name" }),
  confluent_flink_compute_pool: node("compute", "pool", "Flink compute pool", "Capacity for stream-processing jobs."),
  confluent_flink_statement: node("function", "flink", "Flink statement", "A continuously running stream-processing job.", false, { labelAttr: "statement_name" }, { attr: "statement", type: "confluent_kafka_topic", on: "topic_name" }),
  // Containment
  aws_vpc: { kind: "zone", zoneKind: "vpc" },
  aws_subnet: { kind: "zone", zoneKind: "subnet", parentAttr: "vpc_id" },
  // Arrows that Terraform spells as separate resources
  aws_lambda_permission: { kind: "edge", from: "source_arn", to: "function_name", label: "Invokes", pattern: "request-response", priority: 3 },
  aws_apigatewayv2_integration: { kind: "edge", from: "api_id", to: "integration_uri", label: "Routes to", pattern: "request-response", priority: 2 },
  aws_lambda_event_source_mapping: { kind: "edge", from: "event_source_arn", to: "function_name", label: "Triggers", pattern: "message", priority: 3 },
  aws_sns_topic_subscription: { kind: "edge", from: "topic_arn", to: "endpoint", label: "Delivers to", pattern: "event", priority: 3 },
  aws_s3_bucket_notification: { kind: "edge", from: "bucket", to: "lambda_function", label: "Notifies", pattern: "event", priority: 3 },
  // Who may read or write which topic, spelled in ACL values
  confluent_kafka_acl: {
    kind: "join",
    where: { resource_type: "TOPIC", permission: "ALLOW" },
    a: { attr: "principal", strip: "User:", type: "confluent_service_account", on: "id" },
    b: { attr: "resource_name", type: "confluent_kafka_topic", on: "topic_name", prefixWhen: { attr: "pattern_type", prefixed: "PREFIXED", literal: "LITERAL" } },
    byAttr: "operation",
    direction: { READ: "b>a", WRITE: "a>b" },
    label: { READ: "Reads", WRITE: "Writes" },
    pattern: "stream",
    priority: 4,
  },
  // Read for permissions, not drawn
  aws_iam_role: { kind: "attach" },
  aws_iam_role_policy: { kind: "attach" },
  aws_iam_policy: { kind: "attach" },
  aws_iam_role_policy_attachment: { kind: "attach" },
  "data.aws_iam_policy_document": { kind: "attach" },
  // Plumbing
  confluent_role_binding: { kind: "skip" },
  confluent_api_key: { kind: "skip" },
  confluent_tag: { kind: "skip" },
  confluent_schema_registry_cluster_config: { kind: "skip" },
  github_actions_secret: { kind: "skip" },
  kubernetes_secret: { kind: "skip" },
  aws_eks_addon: { kind: "skip" },
  aws_launch_template: { kind: "skip" },
  aws_ecr_lifecycle_policy: { kind: "skip" },
  aws_iam_openid_connect_provider: { kind: "skip" },
  null_resource: { kind: "skip" },
  time_sleep: { kind: "skip" },
  terraform_data: { kind: "skip" },
  aws_security_group: { kind: "skip" },
  aws_security_group_rule: { kind: "skip" },
  aws_route_table: { kind: "skip" },
  aws_route_table_association: { kind: "skip" },
  aws_internet_gateway: { kind: "skip" },
  aws_s3_bucket_public_access_block: { kind: "skip" },
  aws_s3_bucket_server_side_encryption_configuration: { kind: "edge", from: "bucket", to: "rule", label: "Encrypted with", pattern: "dependency", priority: 3 },
  aws_cloudwatch_metric_alarm: { kind: "edge", from: "dimensions", to: "alarm_actions", label: "Alerts via", pattern: "event", priority: 3 },
  aws_s3_bucket_versioning: { kind: "skip" },
  aws_s3_bucket_policy: { kind: "skip" },
  aws_lambda_alias: { kind: "skip" },
  aws_apigatewayv2_route: { kind: "skip" },
  aws_apigatewayv2_stage: { kind: "skip" },
  aws_opensearchserverless_access_policy: { kind: "skip" },
  aws_opensearchserverless_security_policy: { kind: "skip" },
  "data.aws_caller_identity": { kind: "skip" },
  "data.aws_region": { kind: "skip" },
};

/** The edge-rule attribute's value is nested (a block list) for some resources, so references are gathered from anywhere under that key. */
export const ruleFor = (type: string, mode: string): Rule | undefined => TF_MAPPING[mode === "data" ? `data.${type}` : type];

/**
 * The `values` attributes the mapping reads, per resource type. `strip` keeps these and drops every other attribute, so a plan can be shared
 * without account ids, keys or secrets; nothing else in `values` ever affects the diagram.
 */
export function keptAttrs(): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  const add = (type: string, ...attrs: string[]) => {
    const t = type.replace(/^data\./, "");
    (out[t] ??= new Set()).add(attrs[0]!);
    for (const a of attrs) out[t]!.add(a);
  };
  for (const [type, rule] of Object.entries(TF_MAPPING)) {
    if (rule.kind === "node" && rule.perInstance) {
      add(type, rule.perInstance.labelAttr);
      if (rule.perInstance.peripheralWhen) add(type, rule.perInstance.peripheralWhen.attr);
    }
    if (rule.kind === "node" && rule.sqlRefs) {
      add(type, rule.sqlRefs.attr);
      add(rule.sqlRefs.type, rule.sqlRefs.on);
    }
    if (rule.kind === "join") {
      add(type, ...Object.keys(rule.where), rule.a.attr, rule.b.attr, rule.byAttr, ...(rule.b.prefixWhen ? [rule.b.prefixWhen.attr] : []));
      add(rule.a.type, rule.a.on);
      add(rule.b.type, rule.b.on);
    }
  }
  return out;
}
