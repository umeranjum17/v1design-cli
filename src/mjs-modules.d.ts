// The build commands are authored as untyped ES modules (.mjs) run via tsx.
// Declare them as `any` so the TS sources (MCP server) can dynamically import
// them without per-module declaration files.
declare module "*.mjs";
