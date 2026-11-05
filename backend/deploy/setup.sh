#!/bin/zsh
# Prepares the server: the first time, or after changing todo.service or site.nginx. Safe to re-run; code goes out with deploy.sh.
#   zsh deploy/setup.sh
# Renders the systemd and nginx files, runs setup-server.sh there (user, directories, node, service, certificate), then writes
# /etc/$APP.env (mode 600). The password and the Canvas token travel over ssh's stdin, never on a command line. The cookie
# secret is generated on the server the first time and kept afterwards (changing it signs everyone out).
set -euo pipefail
cd "${0:A:h}/.."
source deploy/common.sh
if [[ -n ${PASSWORD_FILE:-} ]]; then [[ -s $PASSWORD_FILE ]] || { print -u2 "password file $PASSWORD_FILE is missing or empty"; exit 1; }
else print -u2 "no PASSWORD_FILE: the board will not ask for a password"; fi

tmp=$(mktemp -d)
trap 'rm -rf $tmp' EXIT
render deploy/todo.service > $tmp/$APP.service
render deploy/site.nginx > $tmp/$DOMAIN.nginx
cp deploy/cloudflare-realip.conf $tmp/
ssh $HOST "rm -rf /tmp/$APP-setup && install -d -m 700 /tmp/$APP-setup"
scp -q $tmp/* $HOST:/tmp/$APP-setup/
ssh $HOST "APP=$APP DOMAIN=$DOMAIN bash -s" < deploy/setup-server.sh

token() {
  local f=${CANVAS_TOKEN_FILE:-}
  [[ -n $f && -f $f ]] || { print; return }
  local line=$(grep -E '^(export +)?CANVAS_TOKEN=' $f | tail -1)
  if [[ -n $line ]]; then line=${line#*CANVAS_TOKEN=}; line=${line#[\"\']}; print -r -- ${line%[\"\']}
  else print -r -- "$(head -1 $f)"; fi
}
{ print -r -- "$([[ -n ${PASSWORD_FILE:-} ]] && cat $PASSWORD_FILE)"; token } | ssh $HOST "set -euo pipefail; umask 077; f=/etc/$APP.env
  read -r pw || true
  read -r ctok || true
  secret=\$(grep '^TODO_SECRET=' \$f 2>/dev/null | cut -d= -f2- || true)
  [ -n \"\$secret\" ] || secret=\$(head -c 32 /dev/urandom | base64 | tr -d '\n=+/')
  [ -n \"\$ctok\" ] || ctok=\$(grep '^CANVAS_TOKEN=' \$f 2>/dev/null | cut -d= -f2- || true)
  cat > \$f.new <<ENV
TZ=$SERVER_TZ
TODO_DIR=/var/lib/$APP
TODO_PORT=$PORT
TODO_PUBLIC_HOST=$DOMAIN
TODO_PASSWORD=\$pw
TODO_SECRET=\$secret
CANVAS_HOST=${CANVAS_HOST:-}
CANVAS_TOKEN=\$ctok
ENV
  mv \$f.new \$f && chmod 600 \$f && echo 'env ok'"
