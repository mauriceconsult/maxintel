import { mkdir, readFile, writeFile, unlink, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type AuthData = {
  token: string;
};

const AUTH_DIR = join(homedir(), ".maxintel");
const AUTH_FILE = join(AUTH_DIR, "auth.json");

export async function getAuth(): Promise<AuthData | null> {
  try {
    const data = await readFile(AUTH_FILE, "utf-8");
    const parsed = JSON.parse(data) as Partial<AuthData>;

    if (typeof parsed.token === "string" && parsed.token.trim().length > 0) {
      return { token: parsed.token };
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveAuth(data: AuthData): Promise<void> {
  if (!data?.token || typeof data.token !== "string") {
    throw new Error("Invalid AuthData: token must be a non-empty string.");
  }

  // Ensure directory exists with owner-only access (rwx------)
  await mkdir(AUTH_DIR, { recursive: true, mode: 0o700 });
  await chmod(AUTH_DIR, 0o700).catch(() => {});

  // Write file with owner-only access (rw-------)
  await writeFile(AUTH_FILE, JSON.stringify(data, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  await chmod(AUTH_FILE, 0o600).catch(() => {});
}

export async function clearAuth(): Promise<void> {
  try {
    await unlink(AUTH_FILE);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
