#!/usr/bin/env bash

# Claimable Vercel preview deployment helper.
# Adapted from vercel-labs/agent-skills (vercel-deploy-claimable).

set -euo pipefail

DEPLOY_ENDPOINT="${VERCEL_DEPLOY_ENDPOINT:-https://claude-skills-deploy.vercel.com/api/deploy}"
INPUT_PATH="${1:-.}"

usage() {
  cat <<'EOF'
Usage: bash skills/vercel-deploy/scripts/deploy.sh [path]

Arguments:
  path   Directory to deploy or a .tgz archive (default: current directory)
EOF
}

for req in curl tar grep mktemp; do
  if ! command -v "$req" >/dev/null 2>&1; then
    echo "Error: required command '$req' is not installed." >&2
    exit 1
  fi
done

if [[ "${INPUT_PATH:-}" == "-h" || "${INPUT_PATH:-}" == "--help" ]]; then
  usage
  exit 0
fi

detect_framework() {
  local pkg_json="$1"
  if [ ! -f "$pkg_json" ]; then
    echo "null"
    return
  fi

  local content
  content="$(cat "$pkg_json")"

  has_dep() {
    echo "$content" | grep -q "\"$1\""
  }

  if has_dep "next"; then echo "nextjs"; return; fi
  if has_dep "gatsby"; then echo "gatsby"; return; fi
  if has_dep "@remix-run/"; then echo "remix"; return; fi
  if has_dep "@react-router/"; then echo "react-router"; return; fi
  if has_dep "astro"; then echo "astro"; return; fi
  if has_dep "@sveltejs/kit"; then echo "sveltekit-1"; return; fi
  if has_dep "nuxt"; then echo "nuxtjs"; return; fi
  if has_dep "@solidjs/start"; then echo "solidstart-1"; return; fi
  if has_dep "react-scripts"; then echo "create-react-app"; return; fi
  if has_dep "@angular/core"; then echo "angular"; return; fi
  if has_dep "@nestjs/core"; then echo "nestjs"; return; fi
  if has_dep "fastify"; then echo "fastify"; return; fi
  if has_dep "hono"; then echo "hono"; return; fi
  if has_dep "express"; then echo "express"; return; fi
  if has_dep "vite"; then echo "vite"; return; fi
  if has_dep "parcel"; then echo "parcel"; return; fi
  echo "null"
}

TEMP_DIR="$(mktemp -d)"
TARBALL="$TEMP_DIR/project.tgz"
STAGING_DIR="$TEMP_DIR/staging"
FRAMEWORK="null"
CLEANUP_TEMP=true

cleanup() {
  if [ "$CLEANUP_TEMP" = true ]; then
    rm -rf "$TEMP_DIR"
  fi
}
trap cleanup EXIT

echo "Preparing deployment..." >&2

if [ -f "$INPUT_PATH" ] && [[ "$INPUT_PATH" == *.tgz ]]; then
  echo "Using provided tarball..." >&2
  TARBALL="$INPUT_PATH"
  CLEANUP_TEMP=false
elif [ -d "$INPUT_PATH" ]; then
  PROJECT_PATH="$(cd "$INPUT_PATH" && pwd)"
  FRAMEWORK="$(detect_framework "$PROJECT_PATH/package.json")"

  mkdir -p "$STAGING_DIR"

  if command -v rsync >/dev/null 2>&1; then
    rsync -a \
      --exclude='node_modules' \
      --exclude='.git' \
      --exclude='.env' \
      --exclude='.env.*' \
      "$PROJECT_PATH"/ "$STAGING_DIR"/
  else
    tar -cf - -C "$PROJECT_PATH" \
      --exclude='node_modules' \
      --exclude='.git' \
      --exclude='.env' \
      --exclude='.env.*' \
      . | tar -xf - -C "$STAGING_DIR"
  fi

  # If static HTML root has one non-index html file, rename in staging only.
  if [ ! -f "$STAGING_DIR/package.json" ]; then
    html_count=0
    lone_html=""
    while IFS= read -r -d '' file; do
      html_count=$((html_count + 1))
      lone_html="$file"
    done < <(find "$STAGING_DIR" -maxdepth 1 -type f -name "*.html" -print0)

    if [ "$html_count" -eq 1 ]; then
      base="$(basename "$lone_html")"
      if [ "$base" != "index.html" ]; then
        mv "$lone_html" "$STAGING_DIR/index.html"
      fi
    fi
  fi

  echo "Creating deployment package..." >&2
  tar -czf "$TARBALL" -C "$STAGING_DIR" .
else
  echo "Error: input must be a directory or a .tgz file." >&2
  exit 1
fi

if [ "$FRAMEWORK" != "null" ]; then
  echo "Detected framework: $FRAMEWORK" >&2
fi

echo "Deploying..." >&2
RESPONSE="$(curl -sS -X POST "$DEPLOY_ENDPOINT" -F "file=@$TARBALL" -F "framework=$FRAMEWORK")"

if echo "$RESPONSE" | grep -q '"error"'; then
  ERROR_MSG="$(echo "$RESPONSE" | sed -n 's/.*"error":"\([^"]*\)".*/\1/p')"
  echo "Error: ${ERROR_MSG:-unknown deploy error}" >&2
  echo "$RESPONSE" >&2
  exit 1
fi

PREVIEW_URL="$(echo "$RESPONSE" | sed -n 's/.*"previewUrl":"\([^"]*\)".*/\1/p')"
CLAIM_URL="$(echo "$RESPONSE" | sed -n 's/.*"claimUrl":"\([^"]*\)".*/\1/p')"

if [ -z "$PREVIEW_URL" ]; then
  echo "Error: deployment response missing previewUrl." >&2
  echo "$RESPONSE" >&2
  exit 1
fi

echo "" >&2
echo "Deployment successful!" >&2
echo "Preview URL: $PREVIEW_URL" >&2
if [ -n "$CLAIM_URL" ]; then
  echo "Claim URL:   $CLAIM_URL" >&2
fi
echo "" >&2

# JSON for programmatic parsing by the assistant runtime.
echo "$RESPONSE"
