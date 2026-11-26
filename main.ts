// main.ts — entrypoint for "Skylane Archipelago — Island Air Rally".
// Copies game/ and screenshots/ from this repository into the output
// directory and writes /output/dossier.json with buildDossier from the
// kit's vendor/makefun-game.ts (copied unchanged into vendor/).
// Runs on Node 22 with the standard library only; no network, no installs.
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output.

import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { buildDossier } from "./vendor/makefun-game.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? "/output");
const TEXT_MAX_BYTES = 163840;

function countFiles(dir: string): number {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) total += countFiles(full);
    else if (st.isFile()) total += 1;
  }
  return total;
}

function main(): void {
  const gameDir = join(REPO_ROOT, "game");
  const shotsDir = join(REPO_ROOT, "screenshots");
  if (!existsSync(gameDir)) throw new Error("game/ is missing from the repository");
  if (!existsSync(shotsDir)) throw new Error("screenshots/ is missing from the repository");

  mkdirSync(OUT_DIR, { recursive: true });
  cpSync(gameDir, join(OUT_DIR, "game"), { recursive: true });
  cpSync(shotsDir, join(OUT_DIR, "screenshots"), { recursive: true });

  const gameFiles = countFiles(join(OUT_DIR, "game"));
  const shotFiles = countFiles(join(OUT_DIR, "screenshots"));

  const dossier = buildDossier(OUT_DIR, { text_max_bytes: TEXT_MAX_BYTES });
  // explicit 0644 via chmod (a mode argument to writeFileSync is
  // still masked by the process umask): the harness may run under
  // any umask, and the dossier must come out 0644 either way
  const dossierPath = join(OUT_DIR, "dossier.json");
  writeFileSync(dossierPath, Buffer.from(dossier));
  chmodSync(dossierPath, 0o644);
  console.log(`Skylane Archipelago: copied ${gameFiles} game files, ${shotFiles} screenshots`);
  console.log(`dossier.json: ${dossier.byteLength} bytes`);
}

main();
