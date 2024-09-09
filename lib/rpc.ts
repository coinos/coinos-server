import got from "got";
import { fail } from "$lib/utils";
import { err } from "$lib/logging";

export default ({ host, port, wallet, username, password }): any => {
  let url = `http://${host}:${port}/wallet/${wallet}`;
  let token = btoa(`${username}:${password}`);
  let headers = { authorization: `Basic ${token}` };
  let p = (json) => got.post(url, { json, headers }).json();

  let get =
    (_, prop: any) =>
    (...params) =>
      p({ method: prop.toLowerCase(), params })
        .then((res: any) => res.result)
        .catch((e) => (err(e.message), fail(`Failed to call ${prop}`)));

  return new Proxy({}, { get });
};
