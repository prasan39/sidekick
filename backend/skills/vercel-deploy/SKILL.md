---
name: vercel-deploy
description: Deploy sandbox or local apps to Vercel preview using a claimable link. Use this when the user asks to deploy, publish, share a live preview URL, or push an app live.
version: 1.0.0
---

# Vercel Deploy Skill

This skill provides a no-auth, claimable Vercel deployment flow for local and sandbox projects.

## When to use

- "Deploy this app"
- "Give me a Vercel preview URL"
- "Share a live link"
- "Push this to Vercel"
- "Deploy the app built in sandbox"

## Command

From backend root:

```bash
bash skills/vercel-deploy/scripts/deploy.sh [path]
```

- `path` can be a folder or an existing `.tgz` archive.
- If omitted, the script deploys the current directory.

## Recommended sandbox workflow

1. Identify the target app folder (usually under `./sandbox/<app-name>`).
2. Ensure dependencies/build state are ready if needed by that framework.
3. Run deploy script on that folder.
4. Return both links:
   - Preview URL
   - Claim URL

## Guardrails

- Always show both Preview URL and Claim URL.
- If deployment fails, return the exact error and suggest retry.
- Do not expose local secrets or `.env` contents.
