let config = require("./config");
let fs = require("fs");

let mailgun = require("mailgun-js")({
  apiKey: config.mailgun,
  domain: config.domain
});

let data = {
  ...config.mail,
  subject: "User Documents",
  text: "Documents uploaded"
};

fs.readdir("./uploads", (err, files) => {
  files.forEach(file => {
    console.log(file);
    data.text = file;
    fs.rename(file, "../verified" + file);
    mailgun.messages().send(data, function(error, body) {
      console.log(body);
    });
  });
});
