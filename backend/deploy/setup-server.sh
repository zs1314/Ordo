#!/bin/bash
# Runs on the server as root, fed over ssh by setup.sh with APP and DOMAIN set and the rendered files in /tmp/$APP-setup/.
# Safe to re-run: what exists is kept. Installs the system user $APP, /opt/$APP (code, node), /var/lib/$APP (data), a node
# binary of its own (the service cannot read root's nvm), the systemd service, the nginx site and its certificate.
set -euo pipefail
: "${APP:?}" "${DOMAIN:?}"
NODE_VERSION=v24.16.0
SRC=/tmp/$APP-setup

id "$APP" >/dev/null 2>&1 || useradd --system --home-dir "/var/lib/$APP" --no-create-home --shell /usr/sbin/nologin "$APP"
install -d -o root -g root -m 755 "/opt/$APP" "/opt/$APP/releases" "/opt/$APP/runtime"
install -d -o "$APP" -g "$APP" -m 750 "/var/lib/$APP"

# node: the official linux-x64 binary, checked against SHASUMS256
if [ "$("/opt/$APP/runtime/node" -v 2>/dev/null || true)" != "$NODE_VERSION" ]; then
  tmp=$(mktemp -d)
  tarball=node-$NODE_VERSION-linux-x64.tar.xz
  curl -fsSL -o "$tmp/$tarball" "https://nodejs.org/dist/$NODE_VERSION/$tarball"
  curl -fsSL -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
  (cd "$tmp" && grep " $tarball\$" SHASUMS256.txt | sha256sum -c -)
  tar -xJf "$tmp/$tarball" -C "$tmp" "node-$NODE_VERSION-linux-x64/bin/node"
  install -m 755 "$tmp/node-$NODE_VERSION-linux-x64/bin/node" "/opt/$APP/runtime/node"
  rm -rf "$tmp"
fi
echo "node: $("/opt/$APP/runtime/node" -v)"

install -m 644 "$SRC/$APP.service" "/etc/systemd/system/$APP.service"
systemctl daemon-reload
systemctl enable "$APP" >/dev/null 2>&1

# certificate: install only the port-80 half first, get the certificate, then the whole site
SITE=/etc/nginx/sites-available/$DOMAIN
install -d -m 755 /var/www/letsencrypt
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  awk '/^server \{/{n++} n<=1' "$SRC/$DOMAIN.nginx" > "$SITE"
  ln -sfn "$SITE" "/etc/nginx/sites-enabled/$DOMAIN"
  nginx -t && systemctl reload nginx
  certbot certonly --webroot -w /var/www/letsencrypt -d "$DOMAIN" --non-interactive --agree-tos --keep-until-expiring
fi
install -m 644 "$SRC/$DOMAIN.nginx" "$SITE"
# behind Cloudflare, log and rate-limit the visitor's address rather than Cloudflare's (see cloudflare-realip.conf)
install -m 644 "$SRC/cloudflare-realip.conf" /etc/nginx/conf.d/cloudflare-realip.conf
ln -sfn "$SITE" "/etc/nginx/sites-enabled/$DOMAIN"
cat > "/etc/letsencrypt/renewal-hooks/deploy/$APP-nginx" <<HOOK
#!/bin/sh
set -eu
case " \${RENEWED_DOMAINS:-} " in
  *" $DOMAIN "*) /usr/sbin/nginx -t && /bin/systemctl reload nginx ;;
esac
HOOK
chmod 755 "/etc/letsencrypt/renewal-hooks/deploy/$APP-nginx"
nginx -t && systemctl reload nginx
rm -rf "$SRC"
echo "setup ok"
