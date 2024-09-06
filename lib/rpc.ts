import got from "got";

export default ({ host, port, wallet, username, password }) =>
  new Proxy(
    {},
    {
      get:
        (_, prop) =>
        (...params) =>
          ((method, ...params) => {
            let url = `http://${host}:${port}/wallet/${wallet}`;
            return got
              .post(url, {
                json: {
                  method,
                  params,
                },
                headers: {
                  authorization: `Basic ${Buffer.from(
                    `${username}:${password}`,
                  ).toString("base64")}`,
                },
              })
              .json()
              .then(({ result }) => result);
          })((prop as any).toLowerCase(), ...params),
    },
  );
