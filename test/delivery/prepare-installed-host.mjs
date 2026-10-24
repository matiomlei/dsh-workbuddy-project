/** Prepare a NEW isolated test home from source or an offline payload, with a test-only model. */
import {
  mkdirSync,
  existsSync,
  cpSync,
  renameSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  initializeProfile,
  configure,
  verifyHost,
  resolveRuntime,
  stage,
} from "../../scripts/offline/offline-helper.mjs";
const [rootArg, archiveArg, dshArg] = process.argv.slice(2);
if (!rootArg || !archiveArg || !dshArg)
  throw new Error(
    "Usage: node test/delivery/prepare-installed-host.mjs <new-root> <source-directory-or-offline.tgz> <DSH-directory>",
  );
const root = resolve(rootArg),
  archive = resolve(archiveArg),
  runtime = resolveRuntime([resolve(dshArg)]);
if (existsSync(root)) throw new Error("Test root must not exist");
const home = join(root, "home"),
  profile = join(home, "profiles/web"),
  staging = join(root, "staging");
mkdirSync(staging, { recursive: true });
process.env.DSH_HOME = home;
const library = join(root, "library");
const put = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
put(join(library, "library.json"), JSON.stringify({ name: "交付验证能力库" }));
put(
  join(library, "experts/reviewer/.codebuddy-plugin/plugin.json"),
  JSON.stringify({
    name: "reviewer",
    agentName: "lead",
    expertType: "agent",
    displayName: { zh: "工程评审专家" },
  }),
);
put(
  join(library, "experts/reviewer/agents/lead.md"),
  "EXPERT_LIBRARY_PROOF: Follow the bound delivery rules.\n",
);
put(
  join(library, "skills/library-review/SKILL.md"),
  "---\nname: library-review\ndescription: Acceptance skill from shared library\n---\nSKILL_LIBRARY_PROOF: Verify the implementation and record evidence.\n",
);
put(
  join(library, "rules/library-quality/RULE.md"),
  "---\nname: 共享工程规范\n---\nRULE_LIBRARY_PROOF: Validate deliverables.\n",
);
put(
  join(library, "connectors/library-probe/connector.json"),
  JSON.stringify({
    id: "library-probe",
    name: "共享 MCP 验证服务",
    type: "mcp",
  }),
);
put(
  join(library, "connectors/library-probe/mcp.json"),
  JSON.stringify({
    mcpServers: {
      library_probe: {
        type: "streamableHttp",
        url: "http://127.0.0.1:1/test-library-mcp",
      },
    },
  }),
);
if (statSync(archive).isDirectory()) stage(archive, staging);
else execFileSync("tar", ["-xzf", archive, "-C", staging]);
await initializeProfile(runtime.anchor, profile, "web");
const payload = join(profile, "plugins/dsh-workbuddy-project");
mkdirSync(dirname(payload), { recursive: true });
renameSync(join(staging, "dsh-workbuddy-project"), payload);
configure(
  payload,
  join(profile, "cordis.patch.yml"),
  join(profile, "cordis.patch.yml"),
  "web",
);
const patch = join(profile, "cordis.patch.yml");
writeFileSync(
  patch,
  readFileSync(patch, "utf8").replace(
    "libraries: []",
    `libraries: [{name: acceptance, path: ${JSON.stringify(library)}}]`,
  ),
);
await verifyHost(payload, profile, runtime.anchor);
cpSync(new URL("./starter-fixture.mjs", import.meta.url), join(root,"starter-fixture.mjs"));
cpSync(new URL("./dialogue-fixture.mjs", import.meta.url), join(root,"dialogue-fixture.mjs"));
cpSync(
  new URL("./test-provider.mjs", import.meta.url),
  join(root, "test-provider.mjs"),
);
symlinkSync(
  join(dirname(runtime.anchor), "node_modules"),
  join(root, "node_modules"),
  process.platform === "win32" ? "junction" : "dir",
);
const slash = (path) => path.replaceAll("\\", "/");
writeFileSync(
  join(root, "test.patch.yml"),
  `- id: agent-default-model\n  config: {provider: delivery-test, model: local-test}\n- id: session-title-llm\n  disabled: true\n- insert:\n    - id: delivery-test-model\n      name: ${JSON.stringify(slash(join(root, "test-provider.mjs")))}\n`,
);
writeFileSync(
  join(root, "test-host.json"),
  JSON.stringify({ root, home, profile, payload, runtime }, null, 2),
);
console.log(
  JSON.stringify(
    {
      root,
      home,
      patch: join(root, "test.patch.yml"),
      command:
        "Set DSH_HOME to home, then: dsh --profile web --patch <patch> --no-open --port 0 (capture output in <root>/host.log)",
    },
    null,
    2,
  ),
);
