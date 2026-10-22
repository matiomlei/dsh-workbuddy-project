/** Normal product path against the installed offline payload in an isolated DSH. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const root = resolve(process.argv[2] || "");
const log = readFileSync(join(root, "host.log"), "utf8"),
  url = log.match(/dsh web: (\S+)/)?.[1];
assert.ok(url, "DSH must be running and host.log must contain its local URL");
const base = new URL(url).origin,
  response = await fetch(url, { redirect: "manual" }),
  cookie = response.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
assert.ok(cookie, "DSH must issue a browser session cookie");
const api = async (action, body = {}) => {
  const r = await fetch(base + "/api/workbuddy-delivery", {
    method: "POST",
    headers: { cookie, origin: base, "content-type": "application/json" },
    body: JSON.stringify({ action, ...body }),
    signal: AbortSignal.timeout(40000),
  });
  const v = await r.json();
  assert.ok(r.ok && !v.error, JSON.stringify(v));
  return v;
};
const checks = [];
const home = join(root, "home"),
  repo = join(root, "source");
mkdirSync(repo, { recursive: true });
function git(cwd, ...args) {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=Product test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-C",
      cwd,
      ...args,
    ],
    { encoding: "utf8" },
  ).trim();
}
if (!existsSync(join(repo, ".git"))) {
  git(repo, "init", "-q");
  writeFileSync(join(repo, "README.md"), "Product acceptance source\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "base");
}
const sourceHead = git(repo, "rev-parse", "HEAD");
mkdirSync(join(home, "rules/release-check"), { recursive: true });
writeFileSync(
  join(home, "rules/release-check/RULE.md"),
  "---\nname: 交付检查规范\n---\nPRODUCT_RULE_SNAPSHOT: Check outputs before accepting completion.\n",
);
writeFileSync(
  join(root, "library/connectors/library-probe/mcp.json"),
  JSON.stringify({
    mcpServers: {
      library_probe: {
        type: "streamableHttp",
        url: base + "/test-library-mcp",
      },
    },
  }),
);
const catalog = (await api("capabilities")).capabilities,
  rule = catalog.find((c) => c.reference === "personal:rules/release-check");
assert.match(rule?.hash ?? "", /^[a-f0-9]{64}$/);
const expectedKinds = {
  expert: "acceptance:experts/reviewer",
  skill: "acceptance:skills/library-review",
  connector: "acceptance:connectors/library-probe",
  rule: "acceptance:rules/library-quality",
};
for (const [kind, ref] of Object.entries(expectedKinds)) {
  const item = catalog.find((c) => c.reference === ref);
  assert.equal(item?.kind, kind);
  assert.equal(item.unavailable, null);
  assert.match(item.hash, /^[a-f0-9]{64}$/);
}
const bootstrap = await api("bootstrap");
assert.equal(bootstrap.selection.provider, "delivery-test");
assert.equal(bootstrap.selection.model, "local-test");
checks.push(
  "installed offline payload loads with exact host peers and the DSH model catalog",
);
const op = (name, args, expect) => ({
    name,
    args,
    ...(expect ? { expect } : {}),
  }),
  agent = (id, label, operations, x) => ({
    id,
    type: "agent",
    position: { x, y: 100 },
    data: {
      label,
      prompt: "完成本次节点任务。",
      inputTemplate: "TEST_OPERATIONS:" + JSON.stringify(operations),
      tools: ["read", "write", "skill"],
    },
  });
const graph = {
  nodes: [
    agent(
      "implement",
      "编码实现",
      [
        op("skill", { name: "library-review" }, "SKILL_LIBRARY_PROOF"),
        op("mcp__library_probe__inspect", {}, "LIBRARY_MCP_OK"),
        op("write", {
          file_path: "app.cjs",
          content: 'module.exports = () => "DELIVERY_OK";\n',
        }),
      ],
      80,
    ),
    agent(
      "verify",
      "测试验证",
      [
        op("read", { file_path: "app.cjs" }, "DELIVERY_OK"),
        op("write", {
          file_path: "test-receipt.md",
          content: "# Verification\nImplementation read and checked.\n",
        }),
      ],
      390,
    ),
    {
      id: "done",
      type: "output",
      position: { x: 700, y: 100 },
      data: { label: "汇总交付" },
    },
  ],
  edges: [
    { id: "a-b", source: "implement", target: "verify" },
    { id: "b-c", source: "verify", target: "done" },
  ],
};
const template = await api("template/import", {
    name: "标准交付 · 编码与验证",
    definition: { graph, repositoryRoles: [{ id: "main" }] },
  }),
  id = template.templateId;
let editor = await api("editor/open", { id }),
  revision = editor.revision;
const toolCatalog = await api("editor/request", {
  editorId: editor.editorId,
  path: "/tools",
  method: "GET",
});
assert.deepEqual(
  toolCatalog.tools.map((t) => t.name),
  ["read", "write", "skill", "bash"],
);
assert.equal(
  toolCatalog.tools.some((t) => t.name === "working_directory"),
  false,
);
checks.push(
  "canvas tool catalog matches the executable base tool contract; capabilities use shared-library bindings",
);
for (const nodeId of ["implement", "verify"])
  revision = (
    await api("node/save", {
      id,
      editorId: editor.editorId,
      expectedRevision: revision,
      nodeId,
      repositoryRole: "main",
      capabilities: {
        experts: [expectedKinds.expert],
        skills: [expectedKinds.skill],
        connectors: [expectedKinds.connector],
        rules: [rule.reference, expectedKinds.rule],
      },
      expectedHashes: Object.fromEntries(
        catalog.map((item) => [item.reference, item.hash]),
      ),
    })
  ).revision;
// Reopening the UI preserves a multi-rule snapshot even when catalog order differs.
const originalBinding = (
  await api("editor/state", { editorId: editor.editorId })
).definition.nodeBindings.find((b) => b.nodeId === "implement");
const preserved = await api("node/save", {
  id,
  editorId: editor.editorId,
  expectedRevision: revision,
  nodeId: "implement",
  repositoryRole: "main",
  capabilities: {
    ...originalBinding.capabilities,
    rules: [...originalBinding.capabilities.rules].reverse(),
  },
  keepSnapshot: true,
});
revision = preserved.revision;
assert.deepEqual(preserved.binding.packages, originalBinding.packages);
revision = (
  await api("quality-policy/save", {
    id,
    editorId: editor.editorId,
    expectedRevision: revision,
    nodeId: "implement",
    required: true,
  })
).revision;
const version = await api("publish", { id, expectedRevision: revision });
assert.equal(version.ready, true);
let project = await api("project/create", {
  name: "客户服务平台",
  repositories: [{ alias: "application", url: repo, ref: "HEAD" }],
});
project = await api("project/bind", {
  id: project.id,
  expectedRevision: project.revision,
  binding: {
    templateId: id,
    version: version.version,
    repositoryMap: { main: "application" },
  },
});
checks.push(
  "template freezes a local capability package, publishes v1 and binds to a Git-backed project",
);
let run = await api("runs/start", {
  requestId: randomUUID(),
  projectId: project.id,
  expectedProjectRevision: project.revision,
  triggerInput: "实现一个最小功能并给出测试记录。",
});
async function wait(predicate) {
  for (let i = 0; i < 240; i++) {
    run = await api("runs/detail", { requestId: run.requestId });
    if (predicate(run)) return run;
    if (
      ["preparation_failed", "execution_failed", "canceled"].includes(
        run.status,
      )
    )
      throw new Error(JSON.stringify(run));
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Product run timeout");
}
await wait((r) => r.nodeStates.implement?.status === "waiting_quality");
assert.equal(run.qualityStatus, "pending");
assert.equal(run.nodeStates.verify, undefined);
assert.equal(run.models.implement.provider, "delivery-test");
assert.equal(run.models.verify.model, "local-test");
assert.ok(
  run.artifacts.some((a) => a.nodeId === "implement" && a.name === "app.cjs"),
);
checks.push(
  "host-selected models run through real DSH Agents; frozen coding output waits for quality before downstream admission",
);
const subject = run.qualitySubjects.find(
    (s) => s.evidence.nodeId === "implement",
  ),
  review = subject.reviews.at(-1);
await api("quality/decide", {
  decisionId: randomUUID(),
  requestId: run.requestId,
  subjectId: subject.id,
  subjectDigest: subject.digest,
  nodeId: "implement",
  attempt: subject.evidence.attempt,
  reviewId: review.id,
  outcome: "passed",
  note: "已检查固定代码产物，允许进入下游测试。",
});
await wait((r) => r.status === "execution_succeeded");
assert.equal(run.nodeStates.verify.status, "success");
assert.equal(run.nodeStates.done.status, "success");
assert.ok(
  run.artifacts.some(
    (a) => a.nodeId === "verify" && a.name === "test-receipt.md",
  ),
);
assert.equal(run.qualityStatus, "passed");
checks.push(
  "manual acceptance releases the tester, which reads transferred code and produces its own evidence",
);
const patch = await api("runs/patch", {
    requestId: run.requestId,
    nodeId: "verify",
    alias: "application",
  }),
  patchFile = join(root, "delivery.patch");
writeFileSync(patchFile, Buffer.from(patch.content, "base64"));
const consumer = join(root, "consumer-" + randomUUID().slice(0, 8));
execFileSync("git", ["clone", "-q", repo, consumer]);
git(consumer, "apply", "--check", patchFile);
git(consumer, "apply", patchFile);
assert.equal(
  execFileSync(
    process.execPath,
    [
      "-e",
      'if(require(process.argv[1])()!=="DELIVERY_OK")process.exit(1);console.log("CODE_EXECUTED")',
      join(consumer, "app.cjs"),
    ],
    { encoding: "utf8" },
  ).trim(),
  "CODE_EXECUTED",
);
assert.ok(
  readFileSync(join(consumer, "test-receipt.md"), "utf8").includes(
    "Implementation read",
  ),
);
assert.equal(git(repo, "rev-parse", "HEAD"), sourceHead);
assert.equal(git(repo, "status", "--porcelain"), "");
checks.push(
  "downloaded cumulative binary patch applies to a clean checkout and its generated implementation executes; source remains clean",
);
editor = await api("editor/open", { id });
const updated = structuredClone(graph);
updated.nodes[0].data.label = "编码实现 · v2";
const saved = await api("editor/request", {
  editorId: editor.editorId,
  path: "/workflows",
  method: "POST",
  body: {
    id: "delivery_d_" + editor.editorId,
    graph: updated,
    __deliveryExpectedRevision: editor.revision,
  },
});
const v2 = await api("publish", { id, expectedRevision: saved.revision });
assert.equal(v2.version, 2);
assert.equal(
  (await api("catalog")).projects.find((p) => p.id === project.id).binding
    .version,
  1,
);
assert.equal(
  (await api("runs/detail", { requestId: run.requestId })).template.version,
  1,
);
checks.push(
  "publishing v2 preserves the project v1 binding and prior run snapshot",
);
const requests = readFileSync(join(root, "test-model-requests.jsonl"), "utf8");
assert.ok(requests.includes("PRODUCT_RULE_SNAPSHOT"));
assert.ok(requests.includes("SKILL_LIBRARY_PROOF"));
assert.ok(requests.includes("LIBRARY_MCP_OK"));
assert.ok(requests.includes("EXPERT_LIBRARY_PROOF"));
assert.ok(requests.includes("RULE_LIBRARY_PROOF"));
checks.push(
  "shared-library expert and rules reach the model; bound Skill loads and MCP executes with explicit base-tool selection",
);
const report = {
  date: new Date().toISOString(),
  dsh: "0.2.1-rc.2",
  node: process.version,
  platform: process.platform,
  externalModelCalls: 0,
  adapter: "test-only delivery-test/local-test",
  checks,
  requestId: run.requestId,
  projectId: project.id,
  templateId: id,
};
writeFileSync(
  join(root, "acceptance-report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
