// Barrel: every existing `import ... from "@/lib/api"` keeps working.
// Data endpoints and AI (Gemini) endpoints live in separate modules with
// separate timeouts -- see http.ts.
export * from "./http";
export * from "./data";
export * from "./ai";
