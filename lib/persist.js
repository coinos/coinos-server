fs = require("fs");

module.exports = (path, initial = {}) => {
  try {
    return require("../" + path);
  } catch {
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
  }
};
