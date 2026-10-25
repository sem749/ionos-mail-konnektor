import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const c = new Client({ name: "t", version: "1" });
await c.connect(new StreamableHTTPClientTransport(new URL(process.argv[2])));
console.log((await c.listTools()).tools.map(t=>t.name));
for (const [n,a] of [["list_accounts",{}],["list_folders",{}],["list_messages",{}],["search_messages",{text:"Kunde"}],["list_messages",{unread_only:true}],["read_message",{uid:1}],["list_messages",{unread_only:true}]]) {
  const r = await c.callTool({ name:n, arguments:a }); console.log("==",n,JSON.stringify(a), r.isError?"ERROR":""); console.log(r.content[0].text);
}
await c.close();
