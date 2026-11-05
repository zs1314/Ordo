# Sourced by setup.sh, deploy.sh and demo.sh (from the repository root). Reads deploy/deploy.env, or the file in TODO_DEPLOY_ENV.
ENV_FILE=${TODO_DEPLOY_ENV:-deploy/deploy.env}
[[ -f $ENV_FILE ]] || { print -u2 "missing $ENV_FILE: copy deploy/deploy.env.example and fill it in"; exit 1; }
source $ENV_FILE
: ${HOST:?set HOST in $ENV_FILE} ${DOMAIN:?set DOMAIN in $ENV_FILE}
APP=${APP:-todo} PORT=${PORT:-4404} SERVER_TZ=${SERVER_TZ:-UTC}
render() { sed -e "s|@APP@|$APP|g" -e "s|@DOMAIN@|$DOMAIN|g" -e "s|@PORT@|$PORT|g" -e "s|@DEMO_DOMAIN@|${DEMO_DOMAIN:-}|g" "$1" }
