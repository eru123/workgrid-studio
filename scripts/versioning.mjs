#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const PACKAGE_JSON_PATH = path.join(ROOT, "package.json");
const TAURI_CONF_PATH = path.join(ROOT, "src-tauri", "tauri.conf.json");
const CARGO_TOML_PATH = path.join(ROOT, "src-tauri", "Cargo.toml");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  const current = fs.readFileSync(filePath, "utf8");
  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const next = `${JSON.stringify(data, null, 2)}${eol}`;
  if (current !== next) {
    fs.writeFileSync(filePath, next, "utf8");
  }
}

function isSemver(version) {
  return /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.test(version);
}

function bumpVersion(version, level) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    throw new Error(`Invalid semantic version: "${version}"`);
  }

  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);

  if (level === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (level === "minor") {
    minor += 1;
    patch = 0;
  } else if (level === "patch") {
    patch += 1;
  } else {
    throw new Error(`Unsupported bump level: "${level}"`);
  }

  return `${major}.${minor}.${patch}`;
}

function updateCargoTomlPackageVersion(content, version) {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  let inPackageSection = false;
  let replaced = false;

  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (/^\[[^\]]+\]$/.test(trimmed)) {
      inPackageSection = trimmed === "[package]";
      return line;
    }

    if (inPackageSection && /^version\s*=/.test(trimmed)) {
      replaced = true;
      return `version = "${version}"`;
    }

    return line;
  });

  if (!replaced) {
    throw new Error("Could not find [package] version in src-tauri/Cargo.toml");
  }

  return nextLines.join(eol);
}

function readCargoTomlPackageVersion(content) {
  const lines = content.split(/\r?\n/);
  let inPackageSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[[^\]]+\]$/.test(trimmed)) {
      inPackageSection = trimmed === "[package]";
      continue;
    }

    if (inPackageSection) {
      const match = trimmed.match(/^version\s*=\s*"([^"]+)"/);
      if (match) {
        return match[1];
      }
    }
  }

  throw new Error("Could not find [package] version in src-tauri/Cargo.toml");
}

function getCurrentVersions() {
  const packageJson = readJson(PACKAGE_JSON_PATH);
  const tauriConf = readJson(TAURI_CONF_PATH);
  const cargoTomlContent = fs.readFileSync(CARGO_TOML_PATH, "utf8");
  const cargoVersion = readCargoTomlPackageVersion(cargoTomlContent);

  return {
    packageVersion: packageJson.version,
    tauriVersion: tauriConf.version,
    cargoVersion,
  };
}

function checkVersionSync() {
  const versions = getCurrentVersions();
  const synced =
    versions.packageVersion === versions.tauriVersion &&
    versions.packageVersion === versions.cargoVersion;

  if (!synced) {
    throw new Error(
      [
        "Version mismatch detected:",
        `- package.json: ${versions.packageVersion}`,
        `- src-tauri/tauri.conf.json: ${versions.tauriVersion}`,
        `- src-tauri/Cargo.toml: ${versions.cargoVersion}`,
      ].join("\n")
    );
  }

  return versions.packageVersion;
}

function syncVersion(version) {
  if (!isSemver(version)) {
    throw new Error(`Invalid semantic version: "${version}"`);
  }

  const tauriConf = readJson(TAURI_CONF_PATH);
  tauriConf.version = version;
  writeJson(TAURI_CONF_PATH, tauriConf);

  const cargoToml = fs.readFileSync(CARGO_TOML_PATH, "utf8");
  const nextCargoToml = updateCargoTomlPackageVersion(cargoToml, version);
  if (cargoToml !== nextCargoToml) {
    fs.writeFileSync(CARGO_TOML_PATH, nextCargoToml, "utf8");
  }
}

function main() {
  const [command = "sync", bumpLevel] = process.argv.slice(2);
  const packageJson = readJson(PACKAGE_JSON_PATH);

  if (!packageJson.version || typeof packageJson.version !== "string") {
    throw new Error("package.json is missing a valid version field");
  }

  let version = packageJson.version;

  if (command === "sync") {
    syncVersion(version);
    console.log(`Synchronized version: ${version}`);
    return;
  }

  if (command === "check") {
    const syncedVersion = checkVersionSync();
    console.log(`Version files are synchronized: ${syncedVersion}`);
    return;
  }

  if (command === "bump") {
    const level = bumpLevel || "patch";
    version = bumpVersion(version, level);
    packageJson.version = version;
    writeJson(PACKAGE_JSON_PATH, packageJson);
    syncVersion(version);
    console.log(`Bumped and synchronized version: ${version}`);
    return;
  }

  if (command === "current") {
    console.log(version);
    return;
  }

  throw new Error(
    `Unknown command "${command}". Use one of: sync | check | bump <patch|minor|major> | current`
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
