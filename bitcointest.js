config = require("./config");
BitcoinCore = require("bitcoin-core");
bc = new BitcoinCore(config.bitcoin);
bc.getNetworkInfo().then(console.log);
