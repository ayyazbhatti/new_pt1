#!/usr/bin/env bash
# Run from your machine. Connects to the Hetzner server and runs setup-and-deploy.sh.
# Usage: ./deploy/run-remote-setup.sh [root@178.104.49.76]
# You will be prompted for the root password once.

set -e
SERVER="${1:-root@178.104.49.76}"
SCRIPT="https://raw.githubusercontent.com/ayyazbhatti/new_pt1/main/deploy/setup-and-deploy.sh"

echo "Connecting to $SERVER and running setup..."
echo "(You will be prompted for the server root password.)"
ssh -o StrictHostKeyChecking=no "$SERVER" "curl -sSL $SCRIPT | bash" || {
  echo "If curl from GitHub fails (e.g. private repo), run this instead:"
  echo "  ssh $SERVER"
  echo "  git clone https://github.com/ayyazbhatti/new_pt1.git /opt/newpt && cd /opt/newpt && bash deploy/setup-and-deploy.sh"
}
