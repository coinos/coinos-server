DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
curl -k https://api.bitcoinaverage.com/exchanges/all > $DIR/rates.tmp && mv $DIR/rates.tmp $DIR/public/js/rates.json
