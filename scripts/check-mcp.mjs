const base = process.env.MCP_URL || 'http://127.0.0.1:8787/mcp';
let sessionId = null;
let id = 1;

async function rpc(method, params = {}) {
  const headers = {
    'content-type': 'application/json',
    'accept': 'application/json, text/event-stream'
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const response = await fetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params })
  });
  const next = response.headers.get('Mcp-Session-Id');
  if (next) sessionId = next;
  if (response.status === 202 || response.status === 204) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const init = await rpc('initialize', {
  protocolVersion: '2025-11-25',
  capabilities: {},
  clientInfo: { name: 'circle-check', version: '1.0.0' }
});

if (!init?.result?.protocolVersion) throw new Error('MCP initialize failed');
console.log(`initialize: ${init.result.protocolVersion}`);
console.log(`session: ${sessionId ? 'ok' : 'missing'}`);
await rpc('notifications/initialized');

const list = await rpc('tools/list');
const tools = list?.result?.tools || [];
console.log(`tools (${tools.length}): ${tools.map(tool => tool.name).join(', ')}`);
if (tools.length !== 8) throw new Error('Expected eight Circle tools');

const state = await rpc('tools/call', {
  name: 'circle_get_state',
  arguments: { circleId: 'weekend-trip' }
});

const circle = state?.result?.structuredContent;
console.log(`circle: ${circle?.name}`);
console.log(`members: ${circle?.members?.map(member => `${member.name}@${member.home}`).join(', ')}`);

const conflicts = await rpc('tools/call', {
  name: 'circle_detect_conflicts',
  arguments: { circleId: 'weekend-trip' }
});
console.log(`conflicts: ${conflicts?.result?.structuredContent?.conflicts?.length ?? 0}`);
const created = await rpc('tools/call', { name: 'circle_create_task', arguments: { circleId: 'weekend-trip', actor: 'Alex', home: 'Home A', title: 'MCP smoke task', owner: 'Alex', due: 'Test' } });
const task = created?.result?.structuredContent;
if (!task?.id) throw new Error('Task creation failed');
await rpc('tools/call', { name: 'circle_complete_task', arguments: { circleId: 'weekend-trip', taskId: task.id, actor: 'Alex', home: 'Home A' } });
console.log('task create/complete: ok');
console.log('MCP smoke test passed.');
