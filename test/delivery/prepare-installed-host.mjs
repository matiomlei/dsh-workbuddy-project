/** Install an offline payload into a NEW test home, adding a test-only model. */
import {
  mkdirSync,
  existsSync,
  cpSync,
  renameSync,
  symlinkSync,
  writeFileSync,
  realpathSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  initializeProfile,
  configure,
  verifyHost,
  resolveRuntime,
} from "../../scripts/offline/offline-helper.mjs";
const [rootArg, archiveArg, dshArg] = process.argv.slice(2);
if (!rootArg || !archiveArg || !dshArg)
  throw new Error(
    "Usage: node test/delivery/prepare-installed-host.mjs <new-root> <offline.tgz> <DSH-directory>",
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
execFileSync("tar", ["-xzf", archive, "-C", staging]);
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
await verifyHost(payload, profile, runtime.anchor);
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
