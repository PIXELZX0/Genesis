import type { TokenjuiceEmbeddedExtensionFactory } from "./tokenjuice-genesis.js";

const TOKENJUICE_HOST_SUBPATH = ["tokenjuice", ["open", "claw"].join("")].join("/");
const TOKENJUICE_FACTORY_EXPORT = ["createTokenjuice", "Open", "Claw", "EmbeddedExtension"].join(
  "",
);

let factoryPromise: Promise<TokenjuiceEmbeddedExtensionFactory> | undefined;

function isTokenjuiceFactory(value: unknown): value is TokenjuiceEmbeddedExtensionFactory {
  return typeof value === "function";
}

export function createTokenjuiceGenesisEmbeddedExtension(): Promise<TokenjuiceEmbeddedExtensionFactory> {
  factoryPromise ??= (import(TOKENJUICE_HOST_SUBPATH) as Promise<Record<string, unknown>>).then(
    (moduleExports) => {
      const factory = moduleExports[TOKENJUICE_FACTORY_EXPORT];
      if (!isTokenjuiceFactory(factory)) {
        throw new Error("tokenjuice host extension factory is unavailable");
      }
      return factory;
    },
  );
  return factoryPromise;
}
