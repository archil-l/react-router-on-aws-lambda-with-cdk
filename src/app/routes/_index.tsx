import type { MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import Welcome from "../features/welcome/welcome";

export async function loader() {
  const streamingEndpoint = process.env.LLM_STREAM_URL;
  if (!streamingEndpoint) {
    throw new Error("LLM_STREAM_URL environment variable is required");
  }
  const mcpProxyEndpoint = process.env.MCP_PROXY_ENDPOINT ?? null;
  return {
    streamingEndpoint,
    mcpProxyEndpoint,
  };
}

export const meta: MetaFunction = () => [
  { title: "My App" },
  { name: "description", content: "A React Router app on AWS Lambda" },
  { name: "robots", content: "index, follow" },
];

export default function Index() {
  const { streamingEndpoint, mcpProxyEndpoint } =
    useLoaderData<typeof loader>();
  return (
    <Welcome
      streamingEndpoint={streamingEndpoint}
      mcpProxyEndpoint={mcpProxyEndpoint}
    />
  );
}
