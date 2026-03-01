import { invoke } from "@tauri-apps/api/core";

/**
 * Storage utility for reading/writing JSON files to
 * %USERPROFILE%/.workgrid-studio/data/
 */

export async function readData<T>(filename: string, fallback: T): Promise<T> {
    try {
        const raw = await invoke<string>("app_read_file", { filename });
        if (!raw || raw.trim() === "") return fallback;
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

export async function writeData<T>(filename: string, data: T): Promise<void> {
    const json = JSON.stringify(data, null, 2);
    await invoke<void>("app_write_file", { filename, contents: json });
}

export async function deleteData(filename: string): Promise<void> {
    await invoke<void>("app_delete_file", { filename });
}

export async function getDataDir(): Promise<string> {
    return invoke<string>("app_get_data_dir");
}
