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
const STORAGE_KEY_LATEST = 'omnimind_update_latest';

interface CachedLatest {
  version: string;
  url: string;
  checkedAt: number;
}

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

function readCache(): CachedLatest | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LATEST);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedLatest>;
    if (typeof parsed.version !== 'string' || typeof parsed.url !== 'string') {
      return null;
    }
    return {
      version: parsed.version,
      url: parsed.url,
      checkedAt: typeof parsed.checkedAt === 'number' ? parsed.checkedAt : 0,
    };
  } catch {
    return null;
  }
}

export async function checkForUpdates(
  currentVersion: string
): Promise<UpdateInfo | null> {
  const skipVersion = localStorage.getItem(STORAGE_KEY_SKIP_VERSION);
  const cached = readCache();

  // If a newer release is already known, surface it on every launch without
  // another network call. The 24h throttle below only gates fetching, so a
  // user who restarts the app right after a release still sees the banner.
  if (
    cached &&
    isNewer(currentVersion, cached.version) &&
    skipVersion !== cached.version
  ) {
    return {
      available: true,
      currentVersion: normalizeVersion(currentVersion),
      latestVersion: cached.version,
      releaseUrl: cached.url,
    };
  }

  // Throttle the API call: max once per day
  const now = Date.now();
  const lastCheck = parseInt(
    localStorage.getItem(STORAGE_KEY_LAST_CHECK) ?? '0',
    10
  );
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

    if (latestVersion) {
      localStorage.setItem(
        STORAGE_KEY_LATEST,
        JSON.stringify({
          version: latestVersion,
          url: releaseUrl,
          checkedAt: now,
        } satisfies CachedLatest)
      );
    }

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
