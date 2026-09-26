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
  const now = Date.now();

  // The cache is fresh enough to trust without a network call.
  const fetchDue =
    !cached || now - cached.checkedAt >= CHECK_INTERVAL_MS;

  const cachedBanner =
    cached &&
    isNewer(currentVersion, cached.version) &&
    skipVersion !== cached.version
      ? {
          available: true,
          currentVersion: normalizeVersion(currentVersion),
          latestVersion: cached.version,
          releaseUrl: cached.url,
        }
      : null;

  // A newer release we already know about, and the periodic refresh is not
  // due yet — show it on every launch without fetching.
  if (cachedBanner && !fetchDue) {
    return cachedBanner;
  }

  try {
    const res = await fetch(GITHUB_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return cachedBanner;

    const data = await res.json();
    const latestVersion = normalizeVersion(data.tag_name ?? '');
    const releaseUrl = data.html_url ?? 'https://github.com/fedec65/omnimind/releases';

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
    // Offline or rate-limited: keep advertising the cached release rather
    // than going silent.
    return cachedBanner;
  }
}

export function skipVersion(version: string): void {
  localStorage.setItem(STORAGE_KEY_SKIP_VERSION, version);
}
