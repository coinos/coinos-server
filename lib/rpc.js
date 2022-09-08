import wretch from "./wretch";

export default ({ host, port, wallet, username, password }) =>
  new Proxy(
    {},
    {
      get: (target, prop) => (...params) =>
        ((method, ...params) => {
          let url = `http://${host}:${port}/wallet/${wallet}`;
          return wretch()
            .url(url)
            .auth(
              `Basic ${Buffer.from(`${username}:${password}`).toString(
                "base64"
              )}`
            )
            .post({
              method,
              params
            })
              .json(({ result }) => result)
        })(prop.toLowerCase(), ...params)
        
    }
  );
