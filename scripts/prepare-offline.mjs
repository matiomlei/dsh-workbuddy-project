/** Run on a connected preparation machine after npm ci --ignore-scripts --legacy-peer-deps. */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  cpSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { stage } from "./offline/offline-helper.mjs";
const root = fileURLToPath(new URL("../", import.meta.url)),
  out = resolve(process.argv[2] || join(root, "dist"));
const manifest = JSON.parse(readFileSync(join(root, "package.json")));
const staging = mkdtempSync(join(tmpdir(), "workbuddy-offline-"));
mkdirSync(out, { recursive: true });
try {
  stage(root, staging);
  for (const file of ["offline-helper.mjs", "install-windows.ps1"])
    cpSync(join(root, "scripts/offline", file), join(staging, file));
  cpSync(
    join(root, "docs/windows-preview.md"),
    join(staging, "WINDOWS-README.md"),
  );
  const archive = join(out, `${manifest.name}-${manifest.version}-offline.tgz`);
  execFileSync("tar", ["-czf", archive, "-C", staging, "."]);
  const hash = createHash("sha256").update(readFileSync(archive)).digest("hex");
  writeFileSync(
    archive + ".sha256",
    hash + "  " + archive.split(/[\\/]/).at(-1) + "\n",
  );
  cpSync(
    join(staging, "install-windows.ps1"),
    join(out, "install-windows.ps1"),
  );
  cpSync(join(staging, "WINDOWS-README.md"), join(out, "WINDOWS-README.md"));
  console.log(
    JSON.stringify(
      { archive, sha256: hash, bytes: readFileSync(archive).length },
      null,
      2,
    ),
  );
} finally {
  rmSync(staging, { recursive: true, force: true });
}
