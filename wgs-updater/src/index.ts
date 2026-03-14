import { Hono } from "hono";
import semver from "semver";

type Bindings = {
	GITHUB_TOKEN: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/api/update/:target/:current_version", async (c) => {
	const target = c.req.param("target");
	const current_version = c.req.param("current_version");

	const repo = "eru123/workgrid-studio";
	const url = `https://api.github.com/repos/${repo}/releases`;

	const headers: Record<string, string> = {
		"User-Agent": "WorkGrid-Studio-Updater",
		Accept: "application/vnd.github.v3+json",
	};

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
	const release = releases[0];
	
	// The GitHub release tag is "app-v0.1.2", so we need to remove everything before the first number
	let latestVersion = release.tag_name;
	const versionMatch = latestVersion.match(/(\d+\.\d+\.\d+.*)/);
	if (versionMatch) {
		latestVersion = versionMatch[1];
	} else {
		latestVersion = latestVersion.replace(/^([^0-9]+)/, "");
	}
	
	let current = current_version;
	const currentMatch = current.match(/(\d+\.\d+\.\d+.*)/);
	if (currentMatch) {
		current = currentMatch[1];
	} else {
		current = current.replace(/^([^0-9]+)/, "");
	}

	// Check if update is available
	if (!semver.gt(latestVersion, current)) {
		// return 204 No Content if up to date
		return c.body(null, 204);
	}

	// Determine asset extension based on target
	let ext = "";
	if (target.includes("windows")) {
		// Tauri v2 defaults to NSIS .zip or .msi.zip for windows
		ext = "x64-setup.nsis.zip";
	} else if (target.includes("darwin-aarch64")) {
		ext = "aarch64.app.tar.gz";
	} else if (target.includes("darwin-x86_64") || target.includes("darwin-intel")) {
		ext = "x64.app.tar.gz";
	} else if (target.includes("linux")) {
		ext = "amd64.AppImage.tar.gz";
	} else {
		return c.text("Unsupported platform", 400);
	}

	// Find signature and the matching build asset
	const signatureAsset = release.assets.find((a: any) =>
		a.name.endsWith(`${ext}.sig`)
	);
	const buildAsset = release.assets.find(
		(a: any) => a.name.endsWith(ext) && !a.name.endsWith(".sig")
	);

	if (!signatureAsset || !buildAsset) {
		// No matching asset found for this platform in the release
		console.warn("Release found but no compatible assets", ext);
		return c.body(null, 204);
	}

	// Fetch the signature content
	const sigResponse = await fetch(signatureAsset.browser_download_url);
	const signature = await sigResponse.text();

	return c.json({
		version: release.tag_name,
		notes: release.body,
		pub_date: release.published_at,
		signature: signature,
		url: buildAsset.browser_download_url,
	});
});

export default app;
