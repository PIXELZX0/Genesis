export type GenesisPiCodingAgentSkillSourceAugmentation = never;

declare module "@earendil-works/pi-coding-agent" {
  interface Skill {
    // Genesis relies on the source identifier returned by pi skill loaders.
    source: string;
  }
}
