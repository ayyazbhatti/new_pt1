#!/usr/bin/env bash
# Run from your machine. SSHs to the Hetzner server and runs setup-and-deploy.sh from GitHub raw.
#
# Usage:
#   ./deploy/run-remote-setup.sh root@YOUR_SERVER_IP
#
# Override script URL (e.g. fork or pinned commit):
#   export SETUP_SCRIPT_URL='https://raw.githubusercontent.com/you/new_pt1/main/deploy/setup-and-deploy.sh'
#   ./deploy/run-remote-setup.sh root@YOUR_SERVER_IP

set -e
if [ -z "${1:-}" ]; then
  echo "Usage: $0 root@YOUR_HETZNER_SERVER_IP"
  echo "  Example: $0 root@203.0.113.10"
  exit 1
fi
SERVER="$1"
SCRIPT="${SETUP_SCRIPT_URL:-https://raw.githubusercontent.com/ayyazbhatti/new_pt1/main/deploy/setup-and-deploy.sh}"

echo "Connecting to $SERVER and running setup..."
echo "(You may be prompted for SSH password or use key auth.)"
ssh -o StrictHostKeyChecking=accept-new "$SERVER" "curl -fsSL '$SCRIPT' | bash" || {
  echo "If curl from GitHub fails (private repo, or raw URL blocked), use Option A in docs/HETZNER_DEPLOYMENT.md:"
  echo "  ssh $SERVER"
  echo "  sudo mkdir -p /opt && sudo chown \"\$USER\":\"\$USER\" /opt"
  echo "  git clone --depth 1 -b main https://github.com/ayyazbhatti/new_pt1.git /opt/newpt   # or your fork"
  echo "  cd /opt/newpt && sudo bash deploy/setup-and-deploy.sh"
}
