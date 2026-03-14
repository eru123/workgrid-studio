import { Hono } from "hono";
import { cors } from "hono/cors";
import semver from "semver";
import type { UpdateResponse } from "./types";

type Bindings = {
	GITHUB_TOKEN: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Allow cross-origin requests from any origin so that in-app WebViews and
// browsers can call the updater endpoints without CORS errors.
app.use("*", cors());

/**
 * GET /api/update/:target/:current_version
 *
 * Update check endpoint consumed by the Tauri built-in updater plugin.
 *
 * - Fetches the latest GitHub release for eru123/workgrid-studio.
 * - Strips any non-numeric prefix from both the release tag and the client's
 *   current version before comparing (e.g. "app-v0.1.4" → "0.1.4").
 * - Returns 204 No Content when the client is already up to date, or when the
 *   release has no asset matching the requested platform.
 * - Returns 200 with the Tauri UpdateResponse payload when an update exists.
 *
 * @param target         Tauri target triple: windows-x86_64 | darwin-aarch64 |
 *                       darwin-x86_64 | linux-x86_64
 * @param current_version Semver of the installed build (prefix is ignored).
 */
app.get("/api/update/:target/:current_version", async (c) => {
	const target = c.req.param("target");
	const current_version = c.req.param("current_version");

	const repo = "eru123/workgrid-studio";
	const url = `https://api.github.com/repos/${repo}/releases`;

	const headers: Record<string, string> = {
		"User-Agent": "WorkGrid-Studio-Updater",
		Accept: "application/vnd.github.v3+json",
	};

	// Use a GitHub token when available to avoid the 60 req/hr unauthenticated limit.
	if (c.env.GITHUB_TOKEN) {
		headers["Authorization"] = `Bearer ${c.env.GITHUB_TOKEN}`;
	}

	const response = await fetch(url, { headers });

	if (!response.ok) {
		const text = await response.text();
		console.error("GitHub API failed:", response.status, text);
		return c.text(`Failed to fetch release: ${response.status}`, 500);
	}

	const releases = (await response.json()) as any[];
	if (!releases || releases.length === 0) {
		return c.text("No releases found", 404);
	}

	// Use the most recent release (index 0 — GitHub orders by published_at desc).
	const release = releases[0];

	// Normalise the release tag to a bare semver string.
	// GitHub tags follow the "app-vX.Y.Z" convention used by this project.
	let latestVersion: string = release.tag_name;
	const latestMatch = latestVersion.match(/(\d+\.\d+\.\d+.*)/);
	latestVersion = latestMatch
		? latestMatch[1]
		: latestVersion.replace(/^[^0-9]+/, "");

	// Normalise the client-reported version the same way.
	let current = current_version;
	const currentMatch = current.match(/(\d+\.\d+\.\d+.*)/);
	current = currentMatch ? currentMatch[1] : current.replace(/^[^0-9]+/, "");

	// Return 204 if the client is already on the latest version.
	if (!semver.gt(latestVersion, current)) {
		return c.body(null, 204);
	}

	// Map the Tauri target triple to the candidate asset file suffixes.
	// Multiple suffixes are tried in order so the endpoint works regardless of
	// which bundle types were included in a given release.
	let candidates: string[] = [];
	if (target.includes("windows")) {
		// Tauri v2 can ship either an NSIS or MSI updater zip — try both.
		candidates = ["x64-setup.nsis.zip", "x64_en-US.msi.zip"];
	} else if (target.includes("darwin-aarch64")) {
		candidates = ["aarch64.app.tar.gz"];
	} else if (
		target.includes("darwin-x86_64") ||
		target.includes("darwin-intel")
	) {
		candidates = ["x64.app.tar.gz"];
	} else if (target.includes("linux")) {
		candidates = ["amd64.AppImage.tar.gz"];
	} else {
		return c.text("Unsupported platform", 400);
	}

	// Pick the first candidate that has a matching build asset in this release.
	let buildAsset: any = null;
	let signatureAsset: any = null;

	for (const ext of candidates) {
		const b = release.assets.find(
			(a: any) => a.name.endsWith(ext) && !a.name.endsWith(".sig")
		);
		if (b) {
			buildAsset = b;
			signatureAsset = release.assets.find((a: any) =>
				a.name.endsWith(`${ext}.sig`)
			);
			break;
		}
	}

	if (!buildAsset) {
		// Release exists but has no asset for this platform — treat as no update.
		console.warn(
			"Release found but no compatible assets for target:",
			target,
			"tried:",
			candidates.join(", ")
		);
		return c.body(null, 204);
	}

	// Fetch the signature file contents (plain text, base64-encoded by minisign).
	let signature = "";
	if (signatureAsset) {
		const sigResponse = await fetch(signatureAsset.browser_download_url);
		signature = await sigResponse.text();
	} else {
		console.warn("No signature found for asset:", buildAsset.name);
	}

	const payload: UpdateResponse = {
		version: release.tag_name,
		notes: release.body ?? "",
		pub_date: release.published_at,
		signature: signature.trim(),
		url: buildAsset.browser_download_url,
	};

	return c.json(payload);
});

export default app;
