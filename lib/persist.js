const fs = require("fs");

module.exports = (path, initial = {}) => {
  if (!initial || !Object.keys(initial).length) {
    try {
      initial = require("../" + path);
    } catch(e) {}
  }

  // console.log("initial", path, initial);

  return new Proxy(initial, {
    set(obj, prop, value) {
      fs.writeFileSync(
        path,
        JSON.stringify({ ...obj, [prop]: value }, null, 2),
        "utf-8"
      );
      return Reflect.set(...arguments);
    }
  });
};
