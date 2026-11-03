# Verifying the Terraform generator on real Terraform

The generator (`scripts/tf.ts`, `src/terraform.ts`, `src/tfMapping.ts`) has only been run on hand-written fixtures in `tests/fixtures/terraform/`. This is the runbook for the first run on a real project, written against `kafka-ecom-platform` (ten root modules, mostly Confluent Cloud, plus EKS and ECR). It needs the project's state or plans, so it waits until that project is deployed. See backlog V6.

Use Git Bash. Windows PowerShell 5.1 writes `>` output as UTF-16, which the generator cannot read.

## Before you start

- Authenticate the way you normally do for the project: AWS for the S3 backend, the Confluent API key and secret in the environment. Never paste them anywhere.
- Raw `terraform show -json` output contains secrets in plain text (API key secrets included). Keep it outside both repositories, never commit it, never paste it into a chat. Only the stripped copy is for sharing.

## 1. Scratch folders outside both repositories

```bash
mkdir -p ~/tf-raw ~/tf-stripped ~/tf-out
```

## 2. Export state from each directory (read only)

Start with `confluent-topics`, `confluent-rbac` and `eks`, then add the rest. Repeat per directory, changing `D`:

```bash
D=confluent-topics
cd <path-to>/kafka-ecom-platform/terraform/$D
terraform init -input=false -lockfile=readonly
terraform show -json > ~/tf-raw/$D.state.json
```

- `-lockfile=readonly` stops `init` rewriting the committed `.terraform.lock.hcl`. Afterwards `git status` in the project should show nothing changed.
- `terraform show -json` with no plan file reads the state only. It changes nothing and calls no provider API, apart from reading the state from the backend.
- The file name matters: the part before `.state.json` (or `.plan.json`) becomes that plan's prefix in the generator, so use the directory name.
- Directories: `confluent-env`, `confluent-topics`, `confluent-rbac`, `confluent-schemas`, `confluent-flink`, `eks`, `ecr`. Skip `bootstrap` and `github-oidc` (nothing useful to draw).

## 3. For `eks` (and optionally `ecr`, `confluent-flink`) make a plan instead

State has no `configuration` section, so there would be no references: no EKS-to-subnet links and no VPC box. A plan has them.

```bash
cd <path-to>/kafka-ecom-platform/terraform/eks
terraform plan -input=false -lock=false -out="$HOME/tf-raw/eks.tfplan"
terraform show -json "$HOME/tf-raw/eks.tfplan" > ~/tf-raw/eks.plan.json
```

Add your usual `-var-file` if you use one. A plan changes nothing but does contact the providers to refresh.

## 4. Strip everything

```bash
cd <path-to>/arch-diagram-tool
for f in ~/tf-raw/*.state.json ~/tf-raw/*.plan.json; do
  node scripts/tf.ts strip "$f" --out ~/tf-stripped/$(basename "$f")
done
```

`strip` keeps addresses, references and the few attributes the mapping reads, and drops every other value. It keeps the SQL text of Flink statements (the arrows come from it): read it once for anything sensitive.

## 5. Check the stripped files are clean

```bash
grep -l -i -E "secret|password|AKIA|BEGIN .*KEY|api[_-]?key" ~/tf-stripped/*.json
```

This should print nothing. If it names a file, look at the offending line before sharing anything.

## 6. Generate

```bash
node scripts/tf.ts generate ~/tf-stripped/*.json --out ~/tf-out/spec.json
```

Read the lines it prints:

- `N resources: … nodes, … zones, … links`
- `not drawn, no mapping rule`: resource types to add to `src/tfMapping.ts`
- `permission arrows could not be resolved`: value joins (Kafka ACLs) with unknown values; expect none from state
- any `error:` line

Expected for this project: 9 service accounts, 17 topics, about 55 Reads and Writes arrows from ACLs (more with prefixed ACLs that match topics), 5 Flink arrows if `confluent-flink` is included. "No configuration section" warnings for state files are normal.

## 7. Look at it

```bash
node scripts/export-svg.mjs --out ~/tf-out/spec.svg ~/tf-out/spec.json
```

Open the SVG in a browser. The full graph will be a tangle (dense services-and-topics graph, see backlog S5 findings).

## 8. Curate with an overlay

Write `~/tf-out/overlay.json` with a `hide` list (dead-letter topics, the replay tool, the Debezium accounts, the admin account), using `tests/fixtures/terraform/kafka/kafka.overlay.json` as the template, then:

```bash
node scripts/tf.ts generate ~/tf-stripped/*.json --overlay ~/tf-out/overlay.json --out ~/tf-out/spec.json
```

A `hide` entry that matches nothing is an error, which tells you the id is wrong. Then `node scripts/tf.ts pin ~/tf-stripped/*.json --overlay ~/tf-out/overlay.json` to freeze positions.

## 9. Clean up

```bash
rm -rf ~/tf-raw
```

## What to look for

A mismatch between my fixtures (written from the plan JSON format as I know it, never from real output) and real files is the main thing this run can reveal: parse errors, missing `index` or `address` shapes for modules and `for_each`, references that do not resolve, attributes named differently. Record each difference, fix the reader, and add a stripped real file (with ids changed) to the fixtures as a regression test.

## If the project stays down

- State may be empty if the stack was destroyed; then there is nothing to draw.
- A plan (step 3) against an empty state still draws cards and reference links, but Kafka ACL arrows need the service-account ids, which do not exist until apply, so they are counted as unresolved. Providers that read existing objects (data sources for the environment or the Flink region) may fail to plan at all.
- The alternative is to deploy once, run steps 2 to 9, and destroy again. Confluent Cloud and EKS cost money while up.
- Another real project with simpler Terraform (AWS only) would test the plan reader without needing a live Kafka stack.
