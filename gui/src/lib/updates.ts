/**
 * Simple update checker against GitHub releases.
 */

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
}

const GITHUB_API_URL =
  'https://api.github.com/repos/fedec65/omnimind/releases/latest';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 day
const STORAGE_KEY_LAST_CHECK = 'omnimind_update_last_check';
const STORAGE_KEY_SKIP_VERSION = 'omnimind_update_skip_version';

function normalizeVersion(v: string): string {
  return v.replace(/^v/, '');
}

function isNewer(current: string, latest: string): boolean {
  const c = normalizeVersion(current).split('.').map(Number);
  const l = normalizeVersion(latest).split('.').map(Number);
  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const a = c[i] ?? 0;
    const b = l[i] ?? 0;
    if (b > a) return true;
    if (b < a) return false;
  }
  return false;
}

export async function checkForUpdates(
  currentVersion: string
): Promise<UpdateInfo | null> {
  const now = Date.now();
  const lastCheck = parseInt(
    localStorage.getItem(STORAGE_KEY_LAST_CHECK) ?? '0',
    10
  );
  const skipVersion = localStorage.getItem(STORAGE_KEY_SKIP_VERSION);

  // Throttle: max once per day
  if (now - lastCheck < CHECK_INTERVAL_MS) {
    return null;
  }

  try {
    const res = await fetch(GITHUB_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const latestVersion = normalizeVersion(data.tag_name ?? '');
    const releaseUrl = data.html_url ?? 'https://github.com/fedec65/omnimind/releases';

    localStorage.setItem(STORAGE_KEY_LAST_CHECK, String(now));

    if (!latestVersion || !isNewer(currentVersion, latestVersion)) {
      return null;
    }

    // Don't nag about a version the user already dismissed
    if (skipVersion === latestVersion) {
      return null;
    }

    return {
      available: true,
      currentVersion: normalizeVersion(currentVersion),
      latestVersion,
      releaseUrl,
    };
  } catch {
    return null;
  }
}

export function skipVersion(version: string): void {
  localStorage.setItem(STORAGE_KEY_SKIP_VERSION, version);
}
