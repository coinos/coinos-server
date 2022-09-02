import wretch from "./wretch.js";

export default ({ host, port, wallet, user, password }) =>
  new Proxy(
    {},
    {
      get: (target, prop) => (...params) =>
        ((method, ...params) =>
          wretch()
            .url(`http://${host}:${port}/wallet/${wallet}`)
            .auth(
              `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`
            )
            .post({
              method,
              params
            })
            .json(({ result }) => result))(prop.toLowerCase(), ...params)
    }
  );
