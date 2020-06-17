const axios = require('axios');
const lnurl = require('lnurl');

module.exports = async (req, res) => {
  let { text } = req.query;
  const decoded = lnurl.decode(text);

  try {
    let result = await axios.get(decoded);
    res.send(result.data);
  } catch(e) {
    l.error(e.message);
    res.status(500).send(e.message);
  } 
};
