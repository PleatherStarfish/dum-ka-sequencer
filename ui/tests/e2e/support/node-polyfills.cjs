const nodeCrypto = require("node:crypto");

const targetCrypto = globalThis.crypto || nodeCrypto;

if (!targetCrypto.getRandomValues) {
  Object.defineProperty(targetCrypto, "getRandomValues", {
    configurable: true,
    value: nodeCrypto.webcrypto.getRandomValues.bind(nodeCrypto.webcrypto),
  });
}

Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  value: targetCrypto,
});
