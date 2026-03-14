#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const CHANGELOG_PATH = path.join(ROOT, "CHANGELOG.md");

const UNRELEASED_HEADER = "## [Unreleased]";
const NULL_REF = "0000000000000000000000000000000000000000";

function readChangelog() {
  if (!fs.existsSync(CHANGELOG_PATH)) {
    return `# Changelog\n\n${UNRELEASED_HEADER}\n`;
  }
  return fs.readFileSync(CHANGELOG_PATH, "utf8");
}

function writeChangelog(content) {
  fs.writeFileSync(CHANGELOG_PATH, content, "utf8");
}

/** Parse the [Unreleased] block, return { before, entries, after } */
function splitChangelog(content) {
  const idx = content.indexOf(UNRELEASED_HEADER);
  if (idx === -1) {
    // No Unreleased section; insert one at the top after the title
    const titleEnd = content.indexOf("\n") + 1;
    return {
      before: content.slice(0, titleEnd) + "\n",
      entries: [],
      after: content.slice(titleEnd),
    };
  }

  const afterHeader = content.indexOf("\n", idx) + 1;
  const nextSectionMatch = content.slice(afterHeader).search(/^## /m);
  const nextSection =
    nextSectionMatch === -1 ? -1 : afterHeader + nextSectionMatch;

  const rawEntries =
    nextSection === -1
      ? content.slice(afterHeader)
      : content.slice(afterHeader, nextSection);

  const entries = rawEntries
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "));

  return {
    before: content.slice(0, idx),
    entries,
    after: nextSection === -1 ? "" : content.slice(nextSection),
  };
}

function rebuildChangelog({ before, entries, after }) {
  const block =
    entries.length > 0
      ? `${UNRELEASED_HEADER}\n${entries.join("\n")}\n`
      : `${UNRELEASED_HEADER}\n`;
  return `${before}${block}\n${after}`.replace(/\n{3,}/g, "\n\n");
}

/** Add commits between two git refs to the [Unreleased] section. */
function addCommits(fromRef, toRef) {
  let rawLog;
  try {
    const range =
      fromRef === NULL_REF ? toRef : `${fromRef}..${toRef}`;
    rawLog = execSync(
      `git log ${range} --pretty=format:"- %s" --no-merges`,
      { cwd: ROOT, encoding: "utf8" }
    ).trim();
  } catch {
    console.log("Could not read git log; skipping changelog update.");
    return;
  }

  if (!rawLog) {
    console.log("No new commits to add.");
    return;
  }

  const newLines = rawLog
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .filter((l) => !l.toLowerCase().includes("docs: update changelog"))
    .filter((l) => !l.toLowerCase().includes("merge branch"))
    .filter((l) => !l.toLowerCase().includes("merge pull request"));

  const content = readChangelog();
  const parsed = splitChangelog(content);

  const existingSet = new Set(parsed.entries);
  const toAdd = newLines.filter((l) => !existingSet.has(l));

  if (toAdd.length === 0) {
    console.log("All commits already present in changelog.");
    return;
  }

  parsed.entries.push(...toAdd);
  writeChangelog(rebuildChangelog(parsed));
  console.log(`Added ${toAdd.length} commit(s) to [Unreleased].`);
}

/** Promote [Unreleased] to a versioned section. Prints the release notes to stdout. */
function promote(version) {
  const date = new Date().toISOString().slice(0, 10);
  const content = readChangelog();
  const parsed = splitChangelog(content);

  const entries =
    parsed.entries.length > 0
      ? parsed.entries
      : ["- No changes recorded."];

  const versionBlock = `## [${version}] - ${date}\n${entries.join("\n")}\n`;

  // Empty out Unreleased, prepend the version block to the rest
  parsed.entries = [];
  const newContent =
    `${parsed.before}${UNRELEASED_HEADER}\n\n${versionBlock}\n${parsed.after}`.replace(
      /\n{3,}/g,
      "\n\n"
    );

  writeChangelog(newContent);
  console.log(`Promoted [Unreleased] → [${version}] - ${date}`);

  // Emit the notes for CI consumption
  process.stdout.write(entries.join("\n") + "\n");
}

/** Print the current [Unreleased] entries (one per line). */
function getUnreleased() {
  const content = readChangelog();
  const { entries } = splitChangelog(content);
  console.log(entries.join("\n"));
}

/** Print the entries for a specific version heading. */
function getVersionNotes(version) {
  const content = readChangelog();
  const header = `## [${version}]`;
  const idx = content.indexOf(header);
  if (idx === -1) {
    console.log("");
    return;
  }
  const afterHeader = content.indexOf("\n", idx) + 1;
  const nextSectionMatch = content.slice(afterHeader).search(/^## /m);
  const nextSection =
    nextSectionMatch === -1 ? -1 : afterHeader + nextSectionMatch;

  const raw =
    nextSection === -1
      ? content.slice(afterHeader)
      : content.slice(afterHeader, nextSection);

  const entries = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "));

  console.log(entries.join("\n"));
}

function main() {
  const [command, ...args] = process.argv.slice(2);

  if (command === "add-commits") {
    const [fromRef, toRef] = args;
    if (!fromRef || !toRef) {
      throw new Error(
        "Usage: changelog.mjs add-commits <from-ref> <to-ref>"
      );
    }
    addCommits(fromRef, toRef);
    return;
  }

  if (command === "promote") {
    const [version] = args;
    if (!version) {
      throw new Error("Usage: changelog.mjs promote <version>");
    }
    promote(version);
    return;
  }

  if (command === "get-unreleased") {
    getUnreleased();
    return;
  }

  if (command === "get-version-notes") {
    const [version] = args;
    if (!version) {
      throw new Error("Usage: changelog.mjs get-version-notes <version>");
    }
    getVersionNotes(version);
    return;
  }

  throw new Error(
    `Unknown command "${command}". Use: add-commits | promote | get-unreleased | get-version-notes`
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
