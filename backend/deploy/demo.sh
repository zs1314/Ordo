#!/bin/zsh
# The sample-data demo at https://$DEMO_DOMAIN: the board's interface with made-up data, all running in the visitor's
# browser (demo/). The server holds static files only, sharing no process, directory, data or login with the board.
#   zsh deploy/demo.sh setup    nginx site, certificate, directories (first time; safe to re-run)
#   zsh deploy/demo.sh          publish: build (demo/build.mjs), upload as a new release, switch, check; keeps the last 5
#   zsh deploy/demo.sh off      switch to a "closed for now" page (site and certificate stay; on brings it back)
#   zsh deploy/demo.sh on       back to the newest release
#   zsh deploy/demo.sh status
set -euo pipefail
cd "${0:A:h}/.."
source deploy/common.sh
: ${DEMO_DOMAIN:?set DEMO_DOMAIN in $ENV_FILE}
D=/opt/$APP-demo

case ${1:-publish} in
setup)
  tmp=$(mktemp -d)
  trap 'rm -rf $tmp' EXIT
  render deploy/demo.nginx > $tmp/$DEMO_DOMAIN.nginx
  ssh $HOST "rm -rf /tmp/$APP-demo-setup && install -d -m 700 /tmp/$APP-demo-setup"
  scp -q $tmp/$DEMO_DOMAIN.nginx $HOST:/tmp/$APP-demo-setup/
  ssh $HOST "D=$D DOMAIN=$DEMO_DOMAIN APP=$APP bash -s" <<'REMOTE'
set -euo pipefail
SRC=/tmp/$APP-demo-setup SITE=/etc/nginx/sites-available/$DOMAIN
install -d -o root -g root -m 755 $D $D/releases $D/off
cat > $D/off/index.html <<'HTML'
<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>示例暂时关了</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#555;background:#fcfcfd}@media (prefers-color-scheme:dark){body{color:#aaa;background:#0b0b10}}</style>
</head><body><p>示例暂时关了。</p></body></html>
HTML
chmod 644 $D/off/index.html
touch $D/versions.log
[ -e $D/current ] || ln -sfn $D/off $D/current
install -d -m 755 /var/www/letsencrypt
# certificate: install only the port-80 half first, get the certificate, then the whole site
if [ ! -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]; then
  awk '/^server \{/{n++} n<=1' "$SRC/$DOMAIN.nginx" > "$SITE"
  ln -sfn "$SITE" /etc/nginx/sites-enabled/$DOMAIN
  if ! nginx -t; then rm -f /etc/nginx/sites-enabled/$DOMAIN; echo "nginx rejects the port-80 half; not installed" >&2; exit 1; fi
  systemctl reload nginx
  certbot certonly --webroot -w /var/www/letsencrypt -d $DOMAIN --non-interactive --agree-tos --keep-until-expiring
fi
# the whole site; if nginx -t fails, put the old one back (a broken file would stop other sites' renewals from reloading)
[ -f "$SITE" ] && cp -f "$SITE" /tmp/$DOMAIN.nginx.prev
install -m 644 "$SRC/$DOMAIN.nginx" "$SITE"
ln -sfn "$SITE" /etc/nginx/sites-enabled/$DOMAIN
if ! nginx -t; then
  if [ -f /tmp/$DOMAIN.nginx.prev ]; then install -m 644 /tmp/$DOMAIN.nginx.prev "$SITE"; else rm -f /etc/nginx/sites-enabled/$DOMAIN; fi
  echo "nginx rejects the site; kept the old one" >&2; exit 1
fi
rm -f /tmp/$DOMAIN.nginx.prev
cat > /etc/letsencrypt/renewal-hooks/deploy/$APP-demo-nginx <<HOOK
#!/bin/sh
set -eu
case " \${RENEWED_DOMAINS:-} " in
  *" $DOMAIN "*) /usr/sbin/nginx -t && /bin/systemctl reload nginx ;;
esac
HOOK
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/$APP-demo-nginx
systemctl reload nginx
rm -rf $SRC
case "$(readlink $D/current)" in */off) echo "demo set up, currently off: zsh deploy/demo.sh publishes it" ;; *) echo "demo set up, on" ;; esac
REMOTE
  ;;

publish)
  ssh $HOST "test -d $D/releases" || { print -u2 "the demo is not set up on the server: zsh deploy/demo.sh setup"; exit 1; }
  tmp=$(mktemp -d)
  trap 'rm -rf $tmp' EXIT
  node demo/build.mjs $tmp/site
  ver=$(git rev-parse --short HEAD 2>/dev/null || echo "?")
  [[ -z $(git status --porcelain 2>/dev/null) ]] || ver="$ver+dirty"
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  rel=$D/releases/$ts
  # root owns everything and anyone may read it (nginx reads as www-data): set modes here, keep them in transit
  chmod -R u=rwX,go=rX $tmp/site
  ssh $HOST "install -d -m 755 $rel"
  rsync -rlpt $tmp/site/ $HOST:$rel/ || { ssh $HOST "rm -rf $rel"; print -u2 "upload failed"; exit 1; }
  ssh $HOST "bash -s" <<REMOTE
set -euo pipefail
cd $D
prev=\$(readlink current || true)
ln -sfn $rel current.new && mv -Tf current.new current
get() { curl -fsS -m 5 --resolve $DEMO_DOMAIN:443:127.0.0.1 "\$@"; }
ok=
for i in 1 2 3 4 5; do
  if get https://$DEMO_DOMAIN/ | grep -q 'src="/demo/main.js"' \
    && get -o /dev/null -D - https://$DEMO_DOMAIN/core/edits.mjs | grep -qi '^content-type: text/javascript' \
    && get -o /dev/null https://$DEMO_DOMAIN/web/fonts/adventor-todo-regular.woff2; then ok=1; break; fi
  sleep 1
done
if [ -z "\$ok" ]; then
  echo "the new release does not load; back to \${prev:-(none)}" >&2
  if [ -n "\$prev" ]; then ln -sfn "\$prev" current.new && mv -Tf current.new current; fi
  rm -rf $rel
  exit 1
fi
echo "$ts $ver" >> versions.log
ls -1dt releases/*/ | tail -n +6 | xargs -r rm -rf
echo "demo published $ts ($ver)"
REMOTE
  ;;

off) ssh $HOST "cd $D && ln -sfn $D/off current.new && mv -Tf current.new current && echo 'demo off'" ;;

on)
  ssh $HOST "bash -s" <<REMOTE
set -euo pipefail
cd $D
latest=\$(ls -1dt releases/*/ 2>/dev/null | head -1)
[ -n "\$latest" ] || { echo "nothing published yet: zsh deploy/demo.sh" >&2; exit 1; }
ln -sfn $D/\${latest%/} current.new && mv -Tf current.new current
echo "demo on: \$(basename \$latest)"
REMOTE
  ;;

status)
  ssh $HOST "bash -s" <<REMOTE
cur=\$(readlink $D/current 2>/dev/null || true)
case "\$cur" in
  "") echo "not set up" ;;
  */off) echo "off" ;;
  *) b=\$(basename "\$cur"); echo "on: \$(grep "^\$b " $D/versions.log | tail -1)" ;;
esac
REMOTE
  ;;

*) print -u2 "usage: zsh deploy/demo.sh [setup|publish|off|on|status]"; exit 2 ;;
esac
