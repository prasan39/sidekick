/**
 * In-memory GitHub token store.
 *
 * Why:
 * - We must NOT send OAuth access tokens to the browser (JWT/localStorage).
 * - For now we keep tokens in memory. This means a server restart invalidates
 *   existing sessions and users must log in again.
 *
 * Next step (if needed):
 * - Persist encrypted tokens in a DB/Redis (or Render disk) keyed by githubId.
 */

const tokensByGitHubId = new Map<number, string>();

export function setGitHubToken(githubId: number, token: string): void {
  tokensByGitHubId.set(githubId, token);
}

export function getGitHubToken(githubId: number): string | undefined {
  return tokensByGitHubId.get(githubId);
}

export function clearGitHubToken(githubId: number): void {
  tokensByGitHubId.delete(githubId);
}

