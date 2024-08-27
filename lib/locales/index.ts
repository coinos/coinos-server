import fs from "fs";
export default "de,en,fa,ja,ru,el,es,fr,pt,zh".split(",").reduce((a, l) => {
      a[l] = JSON.parse(fs.readFileSync(`lib/locales/${l}.json`));
    return a;
}, {});
