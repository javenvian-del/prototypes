#!/usr/bin/env bash
set -euo pipefail
target=both
while [ "$#" -gt 0 ]; do
  case "$1" in
    --target) target="${2:?Specify both, codex or claude}"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$target" in both|codex|claude) ;; *) echo 'Use --target both|codex|claude' >&2; exit 2;; esac
for command_name in git node; do
  command -v "$command_name" >/dev/null || { echo "Missing $command_name. Install Node.js 20+ and Git first." >&2; exit 1; }
done
node -e 'if(Number(process.versions.node.split(".")[0])<20)process.exit(1)' || { echo 'Node.js 20+ required' >&2; exit 1; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git clone --quiet --depth 1 https://github.com/javenvian-del/prototypes.git "$tmp/repo"
source_dir="$tmp/repo/skills/li-auto-event-tracking"
test -f "$source_dir/SKILL.md"
cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/li-auto-event-tracking"
mkdir -p "$cache_dir"
cp "$source_dir/package.json" "$cache_dir/package.json"
bundled="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules"
if [ ! -d "$cache_dir/node_modules/playwright" ]; then
  if [ -f "$bundled/playwright/package.json" ] && node -e 'process.exit(require(process.argv[1]).version==="1.62.1"?0:1)' "$bundled/playwright/package.json"; then
    # Reuse the installed runtime; never modify its dependencies.
    ln -s "$bundled" "$cache_dir/node_modules"
  else
    command -v npm >/dev/null || { echo 'npm is required to install Playwright' >&2; exit 1; }
    (cd "$cache_dir" && npm install --omit=dev --ignore-scripts --no-audit --no-fund)
  fi
fi
node -e 'require(process.argv[1])' "$cache_dir/node_modules/playwright"
install_one() {
  destination="$1"
  mkdir -p "$(dirname "$destination")"
  staging="${destination}.install-$$"
  cp -R "$source_dir" "$staging"
  ln -s "$cache_dir/node_modules" "$staging/node_modules"
  if [ -e "$destination" ]; then
    mv "$destination" "${destination}.backup-$(date +%Y%m%d%H%M%S)-$$"
  fi
  mv "$staging" "$destination"
  printf 'Installed: %s\n' "$destination"
}
if [ "$target" = both ] || [ "$target" = codex ]; then install_one "${CODEX_HOME:-$HOME/.codex}/skills/li-auto-event-tracking"; fi
if [ "$target" = both ] || [ "$target" = claude ]; then install_one "$HOME/.claude/skills/li-auto-event-tracking"; fi
echo '理想汽车埋点批量创建 installed. Start a new conversation to load the skill.'
echo 'Requires Google Chrome and access to the company network. Check both logins before choosing rows.'
echo 'ChatGPT: instructions/template only unless your environment provides a local terminal.'
