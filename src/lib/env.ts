export const WS_URL: string =
  process.env.NEXT_PUBLIC_AGENT_WS_URL ?? "ws://localhost:4747/ws";

export const HTTP_URL: string =
  process.env.NEXT_PUBLIC_AGENT_HTTP_URL ?? "http://localhost:4747";
