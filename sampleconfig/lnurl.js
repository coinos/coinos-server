import fs from "fs";

export default {
  host: "app",
  port: 3118,
  protocol: "http",
  url: "https://desk.bobcat-liberty.ts.net",
  endpoint: "/lnurl",
  listen: true,
  auth: {
    apiKeys: [
      {
        id: "50bdeb634d",
        key: "ac9bdd15a983072311c74c13877d122f16a27a8f40cb4dfa5014eece4da5cda2"
      }
    ]
  },
  lightning: {
    backend: "lnd",
    config: {
      hostname: "lnd:9735",
      cert: {
        data: fs.readFileSync(
          "/app/config/lnd/tls.cert",
          "utf8"
        )
      },
      macaroon: {
        data:
          "0201036c6e6402f801030a100a1edc729d77423ec23fa75b85b781391201301a160a0761646472657373120472656164120577726974651a130a04696e666f120472656164120577726974651a170a08696e766f69636573120472656164120577726974651a210a086d616361726f6f6e120867656e6572617465120472656164120577726974651a160a076d657373616765120472656164120577726974651a170a086f6666636861696e120472656164120577726974651a160a076f6e636861696e120472656164120577726974651a140a057065657273120472656164120577726974651a180a067369676e6572120867656e657261746512047265616400000620aea455def2702fb1ec9838f1300255147ed20e825a539a1ee2e99e7049b04c11"
      }
    }
  },
	store: {
		backend: 'knex',
		config: {
			client: 'mysql',
			connection: {
				host: 'maria',
				user: 'root',
				password: 'password',
				database: 'coinos',
			},
		},
	},
};
