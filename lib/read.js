module.exports = (stream, func) => {
  var remaining = "";

  stream.on("data", function (data) {
    remaining += data;
    var index = remaining.indexOf("\n");
    var last = 0;
    while (index > -1) {
      var line = remaining.substring(last, index);
      last = index + 1;
      func(line);
      index = remaining.indexOf("\n", last);
    }

    remaining = remaining.substring(last);
  });

  stream.on("error", () => {});

  stream.on("end", function () {
    if (remaining.length > 0) {
      func(remaining);
    }
  });
};
