import { useAppStore, OutputLevel } from "@/state/appStore";
import { DatabaseProfile } from "@/state/profilesStore";

type ConnectionProfile = Pick<
    DatabaseProfile,
    "id" | "name" | "type" | "user" | "host" | "port" | "database" | "ssh"
>;

export function formatOutputError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

export function formatConnectionTarget(profile: ConnectionProfile): string {
    const details = [`${profile.user}@${profile.host}:${profile.port ?? 3306}`];

    if (profile.type) {
        details.push(profile.type.toUpperCase());
    }
    if (profile.database) {
        details.push(`db=${profile.database}`);
    }
    if (profile.ssh) {
        details.push("ssh");
    }

    return details.join(" | ");
}

export function appendConnectionOutput(
    profile: ConnectionProfile,
    level: OutputLevel,
    message: string,
) {
    useAppStore.getState().addOutputEntry({
        level,
        message,
        profileId: profile.id,
        profileName: profile.name,
    });
}

export function appendOutput(level: OutputLevel, message: string) {
    useAppStore.getState().addOutputEntry({ level, message });
}
