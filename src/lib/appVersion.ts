export const APP_VERSION = __APP_VERSION__;

export async function resolveAppVersion(): Promise<string> {
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    const runtimeVersion = await getVersion();
    if (runtimeVersion && runtimeVersion.trim().length > 0) {
      return runtimeVersion;
    }
  } catch {
    // Ignore when running in plain web mode and fall back to build version.
  }

  return APP_VERSION;
}
