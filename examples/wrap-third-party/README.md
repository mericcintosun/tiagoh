# Wrap a third party MCP server

tiagoh is not limited to first party tools. This example puts an x402 paywall in front of the
official, unmodified `@modelcontextprotocol/server-everything` MCP server.

## Run it

From this directory:

```bash
npx tiagoh wrap
```

That spawns `server-everything` over stdio, prices its `echo` and `add` tools, and serves the paid
gateway on `http://localhost:4402`. Nothing about the upstream server changes.

Discover and call the paid tools:

```bash
npx tiagoh call http://localhost:4402                       # list priced tools
npx tiagoh call http://localhost:4402 echo '{"message":"hi"}'
```

Or point an MCP host at it through the bridge, so the host sees the paid tools as its own:

```bash
npx tiagoh connect http://localhost:4402
```

## What this shows

- `tiagoh wrap` monetizes an MCP server you did not write, with no code changes to it.
- The x402 flow is identical to a first party tool: a 402 challenge, a signed payment, and charge on
  success.
- The same gateway serves the Bazaar discovery document at `/.well-known/x402.json`.

Every tool not listed in `tools` stays free. Edit `tiagoh.config.json` to price more of the
`server-everything` tools, set your own `payTo`, and pick the payment asset.
