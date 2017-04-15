module.exports = (req, res, next) => {
  if (req.path !== '/login') {
    res.setHeader("Cache-Control", "public, max-age=900")
  }
  return next()
}
