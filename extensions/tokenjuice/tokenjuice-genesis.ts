export type TokenjuiceGenesisPiRuntime = {
  on(event: string, handler: (event: unknown, ctx: { cwd: string }) => unknown): void;
};

export type TokenjuiceEmbeddedExtensionFactory = (pi: TokenjuiceGenesisPiRuntime) => void;
