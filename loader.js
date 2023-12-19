import path from 'path'
import fs from 'fs'

export function resolve (specifier, context, nextResolve) {
  const { parentURL = null } = context;

  if (specifier.startsWith('$')) {
    if (specifier.startsWith('$config')) {
      specifier = 'file://' + path.resolve('.') + "/config.js";
    }
    else if (specifier.startsWith('$')) { 
      specifier = specifier.replace(/^\$/, 'file://' + path.resolve('.') + '/') + '.js';
    }

    return {
      shortCircuit: true,
      url: new URL(specifier).href
    };
  } 

  return nextResolve(specifier, context)
}
