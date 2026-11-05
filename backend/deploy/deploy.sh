#!/bin/zsh
# Ships the code: runs the tests, rsyncs a new release to /opt/$APP/releases/<time> (unchanged files are hard links),
# points current at it, restarts the service and checks it answers; if not, switches back. Keeps the last 5 releases.
#   zsh deploy/deploy.sh               (runs node --test first)
#   zsh deploy/deploy.sh --skip-tests
# Data in /var/lib/$APP is never touched. If the demo site is on (demo.sh), it gets the same code afterwards.
set -euo pipefail
cd "${0:A:h}/.."
source deploy/common.sh
if [[ ${1:-} != --skip-tests ]]; then
  if ! out=$(node --test test/*.test.mjs 2>&1); then print -r -- "$out" | tail -30; print -u2 "tests failed, not deploying"; exit 1; fi
fi
ver=$(git rev-parse --short HEAD 2>/dev/null || echo "?")
[[ -z $(git status --porcelain 2>/dev/null) ]] || ver="$ver+dirty"
ts=$(date -u +%Y%m%dT%H%M%SZ)
rel=/opt/$APP/releases/$ts

ssh $HOST "install -d -m 755 $rel"
# -rlpt: no owners (root owns the code; the service only reads it)
rsync -rlpt --delete --link-dest=/opt/$APP/current/ \
  --exclude=.git --exclude=.gitignore --exclude=/data/ --exclude=/test/ --exclude=/dev/ --exclude=/web/dev/ --exclude=/deploy/ \
  --exclude=/demo/ --exclude='*.md' \
  ./ $HOST:$rel/
print -r -- "$ver $ts" | ssh $HOST "cat > $rel/VERSION"

ssh $HOST "bash -s" <<REMOTE
set -euo pipefail
cd /opt/$APP
prev=\$(readlink current || true)
ln -sfn $rel current.new && mv -Tf current.new current
systemctl restart $APP
ok=
for i in \$(seq 1 30); do curl -fsS -m 2 http://127.0.0.1:$PORT/api/health >/dev/null 2>&1 && { ok=1; break; }; sleep 0.5; done
if [ -z "\$ok" ]; then
  echo "the new release does not start; back to \${prev:-(none)}" >&2
  journalctl -u $APP -n 20 --no-pager >&2 || true
  if [ -n "\$prev" ]; then ln -sfn "\$prev" current.new && mv -Tf current.new current && systemctl restart $APP; fi
  rm -rf $rel
  exit 1
fi
ls -1dt releases/*/ | tail -n +6 | xargs -r rm -rf
echo "deployed $ts ($ver)"
REMOTE
if [[ -n ${DEMO_DOMAIN:-} ]] && ssh $HOST "readlink /opt/$APP-demo/current 2>/dev/null" | grep -q "/releases/"; then
  zsh deploy/demo.sh || print -u2 "the demo did not publish (the board did): run zsh deploy/demo.sh again"
fi
