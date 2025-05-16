import fs from "fs";
export default "ar,bn,de,el,en,es,fa,fr,hi,it,ja,ko,nl,pl,pt,ru,th,tr,zh".split(",").reduce((a, l) => {
      a[l] = JSON.parse(fs.readFileSync(`lib/locales/${l}.json`));
    return a;
}, {});
