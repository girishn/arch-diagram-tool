# Regenerates the Kafka fixtures: python make-fixtures.py <output dir>. Shaped like `terraform show -json` for a Kafka-on-EKS platform.
# Names and who reads or writes which topic follow a real repo's structure; every id, key and endpoint is invented. The "SHOULD-NOT-SURVIVE" strings test `strip`.
import json, os, sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)

def res(addr, typ, name, values=None, mode="managed", **extra):
    d = {"address": addr, "mode": mode, "type": typ, "name": name, "provider_name": "registry.terraform.io/x/y", "schema_version": 0, "values": values or {}, "sensitive_values": {}}
    d.update(extra)
    return d

def cres(addr, typ, name, expr=None, mode="managed", **extra):
    d = {"address": addr, "mode": mode, "type": typ, "name": name, "provider_config_key": "p", "expressions": expr or {}, "schema_version": 0}
    d.update(extra)
    return d

R = lambda *r: {"references": list(r)}

pipeline = ["orders.order.placed", "orders.order.confirmed", "orders.order.cancelled", "inventory.stock.reserved", "inventory.stock.reservation-failed", "inventory.stock.release-requested", "payments.payment.captured", "payments.payment.failed"]
topics = pipeline + [t + ".dlt" for t in pipeline] + ["analytics.revenue.realtime"]

sas = ["svc-terraform", "svc-order-api", "svc-order-saga", "svc-inventory-service", "svc-payment-service", "svc-notification-service", "svc-debezium-order", "svc-debezium-inventory", "svc-replay-tool"]
sa_id = {n: f"sa-{i:04x}" for i, n in enumerate(sas, 1)}

reads = {
    "svc-order-saga": ["orders.order.placed", "inventory.stock.reserved", "inventory.stock.reservation-failed", "inventory.stock.release-requested", "payments.payment.captured", "payments.payment.failed"],
    "svc-inventory-service": ["orders.order.placed", "inventory.stock.release-requested", "orders.order.confirmed"],
    "svc-payment-service": ["inventory.stock.reserved"],
    "svc-notification-service": ["orders.order.confirmed", "orders.order.cancelled"],
    "svc-replay-tool": [t + ".dlt" for t in pipeline],
}
writes = {
    "svc-order-api": ["orders.order.placed"],
    "svc-order-saga": ["orders.order.confirmed", "orders.order.cancelled", "inventory.stock.release-requested", "orders.order.placed.dlt", "inventory.stock.reserved.dlt", "inventory.stock.reservation-failed.dlt", "payments.payment.captured.dlt", "payments.payment.failed.dlt"],
    "svc-inventory-service": ["inventory.stock.reserved", "inventory.stock.reservation-failed", "orders.order.placed.dlt", "inventory.stock.release-requested.dlt", "orders.order.confirmed.dlt"],
    "svc-payment-service": ["payments.payment.captured", "payments.payment.failed", "inventory.stock.reserved.dlt"],
    "svc-notification-service": ["orders.order.confirmed.dlt", "orders.order.cancelled.dlt"],
    "svc-replay-tool": pipeline,
    "svc-debezium-order": ["orders.order.placed", "orders.order.confirmed", "orders.order.cancelled", "inventory.stock.release-requested", "inventory.stock.reserved", "inventory.stock.reservation-failed"],
    "svc-debezium-inventory": ["inventory.stock.reserved", "inventory.stock.reservation-failed"],
}

def acl(key, sa, rtype, rname, pattern, op, perm="ALLOW"):
    return res(f'confluent_kafka_acl.this["{key}"]', "confluent_kafka_acl", "this", {
        "principal": f"User:{sa_id[sa]}", "resource_type": rtype, "resource_name": rname, "pattern_type": pattern, "operation": perm and op, "permission": perm,
        "host": "*", "rest_endpoint": "https://pkc-xxxxx.example.invalid:443", "credentials": [{"key": "KAFKA-KEY-SHOULD-NOT-SURVIVE", "secret": "KAFKA-SECRET-SHOULD-NOT-SURVIVE"}],
    }, index=key)

acls = []
for sa, ts in reads.items():
    for t in ts:
        acls.append(acl(f"{sa}--read--{t}", sa, "TOPIC", t, "LITERAL", "READ"))
for sa, ts in writes.items():
    for t in ts:
        acls.append(acl(f"{sa}--write--{t}", sa, "TOPIC", t, "LITERAL", "WRITE"))
# ACLs the diagram must not draw: cluster, group, transactional id, prefixed internal topics, DESCRIBE/CREATE
acls.append(acl("svc-payment-service--cluster-idempotent-write", "svc-payment-service", "CLUSTER", "kafka-cluster", "LITERAL", "IDEMPOTENT_WRITE"))
acls.append(acl("svc-debezium-order--group-read", "svc-debezium-order", "GROUP", "svc-debezium-order", "PREFIXED", "READ"))
acls.append(acl("svc-debezium-order--internal-topic-write", "svc-debezium-order", "TOPIC", "svc-debezium-order", "PREFIXED", "WRITE"))
acls.append(acl("svc-order-saga--describe", "svc-order-saga", "TOPIC", "orders.order.placed", "LITERAL", "DESCRIBE"))

def state(resources):
    return {"format_version": "1.0", "terraform_version": "1.9.5", "values": {"root_module": {"resources": resources}}}

# 1. topics: state format (no configuration section)
json.dump(state([res("confluent_kafka_cluster.this", "confluent_kafka_cluster", "this", {"display_name": "ecom-dev", "id": "lkc-0001"}), res("confluent_environment.this", "confluent_environment", "this", {"display_name": "ecom"})]
    + [res(f'confluent_kafka_topic.this["{t}"]', "confluent_kafka_topic", "this", {"topic_name": t, "partitions_count": 6, "rest_endpoint": "https://x.invalid"}, index=t) for t in topics]), open(f"{out}/kafka-topics.state.json", "w"), indent=2)

# 2. rbac: state format
json.dump(state([res(f'confluent_service_account.this["{n}"]', "confluent_service_account", "this", {"display_name": n, "id": sa_id[n], "description": "x"}, index=n) for n in sas]
    + [res(f'confluent_api_key.this["{n}"]', "confluent_api_key", "this", {"id": "KEY" + sa_id[n], "secret": "API-SECRET-SHOULD-NOT-SURVIVE"}, index=n) for n in sas]
    + acls), open(f"{out}/kafka-rbac.state.json", "w"), indent=2)

# 3. eks: plan format with configuration
eks_res = [
    res("aws_vpc.this", "aws_vpc", "this", {"cidr_block": "10.0.0.0/16"}),
    res("aws_subnet.public[0]", "aws_subnet", "public", {"cidr_block": "10.0.1.0/24"}, index=0),
    res("aws_subnet.public[1]", "aws_subnet", "public", {"cidr_block": "10.0.2.0/24"}, index=1),
    res("aws_internet_gateway.this", "aws_internet_gateway", "this"),
    res("aws_iam_role.cluster", "aws_iam_role", "cluster"), res("aws_iam_role.node", "aws_iam_role", "node"),
    res("aws_eks_cluster.this", "aws_eks_cluster", "this", {"name": "ecom-eks-dev"}),
    res("aws_eks_node_group.this", "aws_eks_node_group", "this", {"node_group_name": "ecom-eks-dev-nodes"}),
    res("aws_eks_addon.ebs_csi_driver", "aws_eks_addon", "ebs_csi_driver"),
]
eks_cfg = [
    cres("aws_vpc.this", "aws_vpc", "this"),
    cres("aws_subnet.public", "aws_subnet", "public", {"vpc_id": R("aws_vpc.this.id", "aws_vpc.this")}, count_expression={"constant_value": 2}),
    cres("aws_internet_gateway.this", "aws_internet_gateway", "this", {"vpc_id": R("aws_vpc.this.id", "aws_vpc.this")}),
    cres("aws_iam_role.cluster", "aws_iam_role", "cluster"), cres("aws_iam_role.node", "aws_iam_role", "node"),
    cres("aws_eks_cluster.this", "aws_eks_cluster", "this", {"role_arn": R("aws_iam_role.cluster.arn", "aws_iam_role.cluster"), "vpc_config": [{"subnet_ids": R("aws_subnet.public")}]}),
    cres("aws_eks_node_group.this", "aws_eks_node_group", "this", {"cluster_name": R("aws_eks_cluster.this.name", "aws_eks_cluster.this"), "node_role_arn": R("aws_iam_role.node.arn", "aws_iam_role.node"), "subnet_ids": R("aws_subnet.public")}),
    cres("aws_eks_addon.ebs_csi_driver", "aws_eks_addon", "ebs_csi_driver", {"cluster_name": R("aws_eks_cluster.this.name", "aws_eks_cluster.this")}),
]
json.dump({"format_version": "1.2", "terraform_version": "1.9.5", "planned_values": {"root_module": {"resources": eks_res}}, "resource_changes": [], "configuration": {"root_module": {"resources": eks_cfg}}}, open(f"{out}/eks.plan.json", "w"), indent=2)

# 4. ecr: one repository per service (for_each)
svcs = ["order-api", "order-saga", "inventory-service", "payment-service", "notification-service"]
json.dump({"format_version": "1.2", "planned_values": {"root_module": {"resources": [res(f'aws_ecr_repository.services["{s}"]', "aws_ecr_repository", "services", {"name": f"ecom-platform/{s}", "repository_url": "123456789012.dkr.ecr.example.invalid/x"}, index=s) for s in svcs]}},
    "configuration": {"root_module": {"resources": [cres("aws_ecr_repository.services", "aws_ecr_repository", "services", {"name": {"constant_value": "ecom-platform/x"}}, for_each_expression=R("var.services"))]}}}, open(f"{out}/ecr.plan.json", "w"), indent=2)

drawn_reads = sum(len(v) for v in reads.values())
drawn_writes = sum(len(v) for v in writes.values())
print(json.dumps({"topics": len(topics), "sas": len(sas), "acl_edges": drawn_reads + drawn_writes, "acls_total": len(acls)}))

# 5. flink: two statements that read and write topics (the topic names are in the SQL), running on one compute pool
pool = "confluent_flink_compute_pool.this"
statements = {
    "revenue-aggregation": "INSERT INTO `analytics.revenue.realtime`\nSELECT window_start, SUM(total) AS revenue\nFROM TABLE(TUMBLE(TABLE `orders.order.confirmed`, DESCRIPTOR($rowtime), INTERVAL '1' MINUTE))\nGROUP BY window_start, window_end; -- reads confirmed orders",
    "reservation-ttl": "INSERT INTO `inventory.stock.release-requested`\nSELECT r.order_id FROM `ecom`.`dev`.`inventory.stock.reserved` r\nLEFT JOIN `orders.order.confirmed` c ON r.order_id = c.order_id\nLEFT JOIN orders.order.cancelled x ON r.order_id = x.order_id\nWHERE c.order_id IS NULL AND x.order_id IS NULL",
}
json.dump({"format_version": "1.2", "planned_values": {"root_module": {"resources": [res(pool, "confluent_flink_compute_pool", "this", {"display_name": "ecom-dev", "max_cfu": 10})]
        + [res(f'confluent_flink_statement.this["{n}"]', "confluent_flink_statement", "this", {"statement_name": n, "statement": q, "rest_endpoint": "https://x.invalid"}, index=n) for n, q in statements.items()]}},
    "configuration": {"root_module": {"resources": [cres("confluent_flink_compute_pool.this", "confluent_flink_compute_pool", "this"),
        cres("confluent_flink_statement.this", "confluent_flink_statement", "this", {"compute_pool": [{"id": R("confluent_flink_compute_pool.this.id", "confluent_flink_compute_pool.this")}], "statement": {"constant_value": "..."}}, for_each_expression=R("local.statements"))]}}},
    open(f"{out}/flink.plan.json", "w"), indent=2)
