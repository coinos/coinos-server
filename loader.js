import path from 'path'
import fs from 'fs'

export function resolve (specifier, parentModuleURL, defaultResolver) {
  specifier = specifier.replace(/^\$/, path.resolve('.') + "/")
  specifier = fs.existsSync(specifier) && fs.lstatSync(specifier).isDirectory() ? `${specifier}/index` : specifier
  return defaultResolver(specifier, parentModuleURL)
}
