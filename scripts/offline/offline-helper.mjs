import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  lstatSync,
  symlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageName = "dsh-workbuddy-project";
const jsTag = "tag:yaml.org,2002:js";
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** Resolve only regular dependency closure, never bundle DSH peers or native binaries. */
export function stage(pluginDir, target) {
  const manifest = readJson(join(pluginDir, "package.json"));
  const payload = join(target, packageName),
    receipt = [];
  mkdirSync(join(payload, "node_modules"), { recursive: true });
  for (const name of manifest.files)
    if (existsSync(join(pluginDir, name)))
      cpSync(join(pluginDir, name), join(payload, name), {
        recursive: true,
        dereference: true,
      });
  cpSync(join(pluginDir, "package.json"), join(payload, "package.json"));
  const copied = new Map();
  function dependency(name, from, expected) {
    const request = createRequire(join(from, "package.json"));
    let dir;
    try {
      dir = dirname(request.resolve(name + "/package.json"));
    } catch {
      let file = request.resolve(name);
      dir = dirname(file);
      while (
        !existsSync(join(dir, "package.json")) ||
        readJson(join(dir, "package.json")).name !== name
      ) {
        const parent = dirname(dir);
        if (parent === dir)
          throw new Error("Cannot resolve dependency " + name);
        dir = parent;
      }
    }
    dir = realpathSync(dir);
    const pkg = readJson(join(dir, "package.json"));
    if (expected && /^\d+\.\d+\.\d+/.test(expected) && pkg.version !== expected)
      throw new Error("Dependency is not pinned: " + name);
    if (copied.has(name)) {
      if (copied.get(name) !== pkg.version)
        throw new Error(
          "Multiple dependency versions require an explicit nested layout: " +
            name,
        );
      return;
    }
    copied.set(name, pkg.version);
    const dest = join(payload, "node_modules", name);
    cpSync(dir, dest, {
      recursive: true,
      dereference: true,
      filter: (p) =>
        !["node_modules", ".git", ".DS_Store"].includes(
          p.split(/[\\/]/).at(-1),
        ),
    });
    receipt.push({ name, version: pkg.version });
    for (const [child, range] of Object.entries(pkg.dependencies ?? {}))
      dependency(child, dir);
    for (const [child, range] of Object.entries(
      pkg.optionalDependencies ?? {},
    )) {
      if (!existsSync(join(dir, "node_modules", child))) {
        try {
          request.resolve(child);
        } catch {
          continue;
        }
      }
      dependency(child, dir);
    }
  }
  for (const [name, version] of Object.entries(manifest.dependencies ?? {}))
    dependency(name, pluginDir, version);
  function portable(path) {
    for (const entry of readdirSync(path)) {
      const child = join(path, entry),
        stat = lstatSync(child);
      if (stat.isSymbolicLink() || entry.endsWith(".node"))
        throw new Error("Non-portable file: " + child);
      if (stat.isDirectory()) portable(child);
    }
  }
  portable(payload);
  writeFileSync(
    join(target, "offline-manifest.json"),
    JSON.stringify(
      {
        package: manifest.name,
        version: manifest.version,
        node: manifest.engines.node,
        dsh: manifest.engines.dsh,
        dependencies: receipt,
        peerDependencies: manifest.peerDependencies,
      },
      null,
      2,
    ) + "\n",
  );
  return payload;
}

export function configure(payload, patchFile, outputFile, profile) {
  if (!/^[a-zA-Z0-9_-]+$/.test(profile))
    throw new Error("Invalid profile name.");
  const require = createRequire(join(payload, "package.json"));
  const YAML = require("yaml");
  const source = existsSync(patchFile)
    ? readFileSync(patchFile, "utf8").replace(/^\uFEFF/, "")
    : "[]\n";
  const doc = YAML.parseDocument(source, {
    customTags: [{ tag: jsTag, resolve: (value) => value }],
    uniqueKeys: true,
  });
  if (doc.errors.length || doc.warnings.length) {
    throw new Error(
      `Cannot safely edit YAML: ${[...doc.errors, ...doc.warnings].map((error) => error.message).join("; ")}`,
    );
  }
  if (doc.contents === null) doc.contents = doc.createNode([]);
  if (!YAML.isSeq(doc.contents))
    throw new Error("cordis.patch.yml must contain a top-level YAML array.");
  const js = (expression) => {
    const value = new YAML.Scalar(expression);
    value.tag = jsTag;
    return value;
  };
  const ensureConfig = (row) => {
    let config = row.get("config", true);
    if (config === undefined) {
      config = doc.createNode({});
      row.set("config", config);
    }
    if (!YAML.isMap(config))
      throw new Error(`Plugin ${row.get("id")} has a non-map config.`);
    return config;
  };
  const projectRows = [];
  const visit = (rows) => {
    for (const row of rows.items) {
      if (!YAML.isMap(row))
        throw new Error("Every patch row must be a mapping.");
      if (["workbuddy-project", "workbuddy-projects"].includes(row.get("id")))
        projectRows.push(row);
      const insert = row.get("insert", true);
      if (insert !== undefined) {
        if (!YAML.isSeq(insert))
          throw new Error("Patch insert must be an array.");
        visit(insert);
      }
    }
  };
  visit(doc.contents);
  if (projectRows.length > 1)
    throw new Error(
      "Duplicate workbuddy-project IDs; merge these entries before installing.",
    );
  let projects = projectRows[0];
  if (!projects) {
    projects = doc.createNode({ id: "workbuddy-project" });
    const insertion = doc.createNode({ insert: [] });
    insertion.get("insert", true).add(projects);
    doc.contents.add(insertion);
  }
  if (projects.has("disabled") && projects.get("disabled") !== false)
    throw new Error(
      "workbuddy-project is explicitly disabled; enable it before installing.",
    );
  projects.set("id", "workbuddy-project");
  projects.set("name", `./plugins/${packageName}/lib/index.js`);
  const projectConfig = ensureConfig(projects);
  if (!projectConfig.has("projectsRoot"))
    projectConfig.set("projectsRoot", js("dshHomePath('projects')"));
  if (!projectConfig.has("compileOptions"))
    projectConfig.set("compileOptions", true);
  if (!projectConfig.has("libraries"))
    projectConfig.set("libraries", doc.createNode([]));

  // Current plugin registers its presets through ctx.agentPresets itself.
  // Existing host preset configuration must not be replaced or extended.
  writeFileSync(outputFile, String(doc), "utf8");
}

export function resolveRuntime(locations) {
  for (const location of locations) {
    if (!existsSync(location)) continue;
    const directory = statSync(location).isDirectory();
    let current = directory
      ? resolve(location)
      : dirname(realpathSync(location));
    while (true) {
      for (const candidate of [
        join(current, "package.json"),
        join(current, "node_modules/@deepseek-ai/dsh/package.json"),
      ]) {
        if (!existsSync(candidate)) continue;
        const manifest = readJson(candidate);
        if (manifest.name !== "@deepseek-ai/dsh") continue;
        const bin =
          typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.dsh;
        if (typeof bin !== "string")
          throw new Error(`No dsh CLI entry declared in ${candidate}`);
        const entry = resolve(dirname(candidate), bin);
        if (!existsSync(entry))
          throw new Error(
            `Missing DSH CLI entry: ${entry}. Complete offline npm ci before installing the plugin.`,
          );
        return { anchor: realpathSync(candidate), entry: realpathSync(entry) };
      }
      // Explicit directories never fall back to a different installation above them.
      if (directory || dirname(current) === current) break;
      current = dirname(current);
    }
  }
  throw new Error(
    "Cannot locate @deepseek-ai/dsh/package.json. Pass -DshRoot with the offline npm project directory or the DSH package directory.",
  );
}

export async function initializeProfile(anchor, profileDir, profileName) {
  if (existsSync(join(profileDir, "package.json"))) return;
  const hostRequire = createRequire(anchor);
  const boot = await import(
    pathToFileURL(hostRequire.resolve("@deepseek-ai/dsh-app-boot"))
  );
  const template = boot.PROFILE_TEMPLATES[profileName];
  if (!template)
    throw new Error(
      `No shipped template for profile ${profileName}; initialize this custom profile first.`,
    );
  boot.initProfile(profileDir, template.bundles);
}

export async function verifyHost(payload, profileDir, dshLocation) {
  const { anchor } = resolveRuntime([dshLocation]);
  const hostManifest = readJson(anchor);
  const manifest = readJson(join(payload, "package.json"));
  const hostRequire = createRequire(anchor);
  const bootFile = hostRequire.resolve("@deepseek-ai/dsh-app-boot");
  const boot = await import(pathToFileURL(bootFile));
  const { Context } = await import(
    pathToFileURL(hostRequire.resolve("@deepseek-ai/cordis"))
  );
  const semver = createRequire(bootFile)("semver");
  const supportedHost = manifest.engines?.dsh;
  if (supportedHost && !semver.satisfies(hostManifest.version, supportedHost))
    throw new Error(`Requires DSH ${supportedHost}; found ${hostManifest.version}`);
  const profile = boot.loadProfileDirectory(
    "offline-check",
    profileDir,
    anchor,
  );
  const resolution = await boot.createRuntimeResolution({
    installAnchor: anchor,
    profile,
    home: process.env.DSH_HOME,
  });
  for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
    const entry = resolution.entries.find(
      (candidate) => candidate.name === name,
    );
    if (!entry) throw new Error(`Missing DSH host dependency: ${name}`);
    const version = readJson(join(entry.packageDir, "package.json")).version;
    if (!semver.satisfies(version, range))
      throw new Error(
        `Incompatible DSH host dependency: ${name}@${version}; requires ${range}`,
      );
  }
  // Local path plugins have no npm-installed peers. Junctions reuse the exact host
  // package directories and leave the host installation untouched.
  for (const name of Object.keys(manifest.peerDependencies ?? {})) {
    const entry = resolution.entries.find((item) => item.name === name),
      link = join(payload, "node_modules", name);
    mkdirSync(dirname(link), { recursive: true });
    if (existsSync(link)) {
      if (realpathSync(link) !== realpathSync(entry.packageDir))
        throw new Error("Refusing a duplicate host peer: " + name);
    } else
      symlinkSync(
        entry.packageDir,
        link,
        process.platform === "win32" ? "junction" : "dir",
      );
  }
  const ctx = new Context();
  const fiber = ctx.plugin(boot.PluginPackages, { resolution });
  try {
    await fiber;
    for (const entry of [
      "index.js",
      "connector-client.js",
      "connector-local.js",
    ]) {
      await import(pathToFileURL(join(payload, "lib", entry)));
    }
  } finally {
    await fiber.dispose();
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === "stage" && args.length === 2) stage(...args);
    else if (command === "configure" && args.length === 4) configure(...args);
    else if (command === "verify-host" && args.length === 3)
      await verifyHost(...args);
    else if (command === "resolve-runtime" && args.length)
      console.log(JSON.stringify(resolveRuntime(args)));
    else if (command === "init-profile" && args.length === 3)
      await initializeProfile(...args);
    else
      throw new Error(
        "Commands: stage <plugin> <directory>; configure <payload> <patch> <output> <profile>; resolve-runtime <locations...>; init-profile <dsh-manifest> <profile-directory> <profile-name>; verify-host <payload> <profile-directory> <dsh-location>",
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
