/**
 * GitHub OAuth + JWT Authentication
 *
 * Flow:
 * 1. Frontend redirects to /api/auth/github
 * 2. User authorizes on GitHub
 * 3. GitHub redirects to /api/auth/github/callback
 * 4. Backend exchanges code for token, fetches profile, issues JWT
 * 5. Frontend stores JWT in localStorage, sends in Authorization header
 */

import { Router, Request, Response, NextFunction } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { getGitHubToken, setGitHubToken } from './github-token-store.js';

// ── Types ────────────────────────────────────────────────────────────

export interface AuthUser {
  githubId: number;
  login: string;
  avatarUrl: string;
  githubToken: string;
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// ── Config ───────────────────────────────────────────────────────────

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

const jwtSecret = new TextEncoder().encode(JWT_SECRET);

// ── JWT helpers ──────────────────────────────────────────────────────

async function signToken(user: AuthUser): Promise<string> {
  return new SignJWT({
    githubId: user.githubId,
    login: user.login,
    avatarUrl: user.avatarUrl,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(jwtSecret);
}

export async function verifyToken(token: string): Promise<AuthUser> {
  const { payload } = await jwtVerify(token, jwtSecret);
  const githubId = payload.githubId as number;
  const githubToken = getGitHubToken(githubId);
  if (!githubToken) {
    // Server restarted or token was cleared. Force re-login.
    throw new Error('GitHub token missing for session');
  }
  return {
    githubId,
    login: payload.login as string,
    avatarUrl: payload.avatarUrl as string,
    githubToken,
  };
}

// ── Auth Middleware ───────────────────────────────────────────────────

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = authHeader.slice(7);
  verifyToken(token)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(() => {
      res.status(401).json({ error: 'Invalid or expired token' });
    });
}

// ── Auth Router ──────────────────────────────────────────────────────

export function createAuthRouter(): Router {
  const router = Router();

  // Redirect to GitHub OAuth
  router.get('/github', (_req: Request, res: Response) => {
    if (!GITHUB_CLIENT_ID) {
      res.status(500).json({ error: 'GITHUB_CLIENT_ID not configured' });
      return;
    }
    const params = new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      scope: 'copilot',
      redirect_uri: `${APP_URL}/api/auth/github/callback`,
    });
    res.redirect(`https://github.com/login/oauth/authorize?${params}`);
  });

  // OAuth callback
  router.get('/github/callback', async (req: Request, res: Response) => {
    const code = req.query.code as string | undefined;
    if (!code) {
      res.status(400).json({ error: 'Missing code parameter' });
      return;
    }

    try {
      // Exchange code for access token
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          client_secret: GITHUB_CLIENT_SECRET,
          code,
        }),
      });
      const tokenData = await tokenRes.json() as { access_token?: string; error?: string };

      if (!tokenData.access_token) {
        res.status(400).json({ error: tokenData.error || 'Failed to get access token' });
        return;
      }

      // Fetch user profile
      const userRes = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const userData = await userRes.json() as { id: number; login: string; avatar_url: string };

      // Store token server-side. Do NOT put it into the client JWT.
      setGitHubToken(userData.id, tokenData.access_token);

      // Sign JWT
      const jwt = await signToken({
        githubId: userData.id,
        login: userData.login,
        avatarUrl: userData.avatar_url,
        githubToken: tokenData.access_token, // required by type; excluded from JWT payload
      });

      // Redirect to frontend with token
      res.redirect(`${APP_URL}/auth/callback?token=${jwt}`);
    } catch (err) {
      console.error('[Auth] OAuth callback error:', err);
      res.status(500).json({ error: 'Authentication failed' });
    }
  });

  // Get current user info (validates token)
  router.get('/me', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    try {
      const user = await verifyToken(authHeader.slice(7));
      res.json({
        githubId: user.githubId,
        login: user.login,
        avatarUrl: user.avatarUrl,
      });
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  });

  return router;
}
