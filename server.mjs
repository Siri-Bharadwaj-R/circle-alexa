import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data', 'state.json');
const PORT = Number(process.env.PORT || 8787);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

let state = await loadState();
const sessions = new Map();

async function loadState() {
  try {
    const parsed = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
    if (parsed?.circles) {
      for (const circle of Object.values(parsed.circles)) {
        if (!Array.isArray(circle.tasks)) circle.tasks = [];
      }
      return parsed;
    }
    return { circles: {} };
  } catch {
    return { circles: {} };
  }
}

async function persist() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function now() {
  return new Date().toISOString();
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, body, contentType = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': contentType, ...headers });
  res.end(body);
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function slugify(value) {
  const id = String(value || 'circle')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return id || `circle-${randomUUID().slice(0, 8)}`;
}

function demoCircle() {
  const t = now();
  return {
    id: 'weekend-trip',
    name: 'Weekend Trip',
    description: 'A shared plan across three independent homes.',
    mode: 'active',
    createdAt: t,
    members: [
      { id: 'member-a', name: 'Alex', home: 'Home A', accent: 'lime', status: 'online' },
      { id: 'member-b', name: 'Jordan', home: 'Home B', accent: 'cyan', status: 'online' },
      { id: 'member-c', name: 'Taylor', home: 'Home C', accent: 'violet', status: 'online' }
    ],
    shared: {
      destination: 'Lake District',
      event: 'Weekend Trip',
      date: 'Saturday',
      status: 'active'
    },
    facts: [
      {
        id: 'fact-hotel',
        label: 'Hotel',
        value: 'Lakeview Resort',
        status: 'confirmed',
        owner: 'Alex',
        updatedBy: 'Alex',
        updatedAt: t
      },
      {
        id: 'fact-cab',
        label: 'Station pickup',
        value: '6:45 PM',
        status: 'confirmed',
        owner: 'Jordan',
        updatedBy: 'Jordan',
        updatedAt: t
      },
      {
        id: 'fact-arrival',
        label: 'Taylor arrival',
        value: '7:20 PM',
        status: 'confirmed',
        owner: 'Taylor',
        updatedBy: 'Taylor',
        updatedAt: t
      }
    ],
    conflicts: [],
    actions: [],
    tasks: [
      { id: 'task-hotel', title: 'Confirm hotel check-in', owner: 'Alex', home: 'Home A', status: 'open', due: 'Today', createdBy: 'Alex', createdAt: t, completedAt: null },
      { id: 'task-snacks', title: 'Pick up snacks', owner: 'Jordan', home: 'Home B', status: 'open', due: 'Saturday', createdBy: 'Jordan', createdAt: t, completedAt: null }
    ],
    activity: [],
    chat: [],
    lastUpdated: t
  };
}

function ensureDemoCircle() {
  if (!state.circles['weekend-trip']) state.circles['weekend-trip'] = demoCircle();
  return state.circles['weekend-trip'];
}

function getCircle(id = 'weekend-trip') {
  return state.circles[id] || ensureDemoCircle();
}

function addActivity(circle, actor, home, message, type = 'update') {
  circle.activity.unshift({
    id: randomUUID(), actor, home, message, type, at: now()
  });
  circle.activity = circle.activity.slice(0, 40);
  circle.lastUpdated = now();
}

function addChat(circle, actor, home, message, role = 'user') {
  circle.chat.push({ id: randomUUID(), actor, home, message, role, at: now() });
  circle.chat = circle.chat.slice(-30);
  circle.lastUpdated = now();
}

function findFact(circle, label) {
  const needle = String(label || '').toLowerCase();
  return circle.facts.find(f => f.label.toLowerCase() === needle);
}

function setFact(circle, { label, value, owner, actor = owner, status = 'updated' }) {
  const timestamp = now();
  let fact = findFact(circle, label);
  if (!fact) {
    fact = {
      id: randomUUID(), label, value, status, owner: owner || 'Circle', updatedBy: actor, updatedAt: timestamp
    };
    circle.facts.push(fact);
  } else {
    fact.value = value;
    fact.status = status;
    fact.owner = owner || fact.owner;
    fact.updatedBy = actor;
    fact.updatedAt = timestamp;
  }
  return fact;
}

function conflictId(type) {
  return `conflict-${type}`;
}

function detectConflicts(circle) {
  const conflicts = [];
  const arrival = findFact(circle, 'Taylor arrival');
  const pickup = findFact(circle, 'Station pickup');

  if (arrival && pickup) {
    const arrivalMinutes = parseTime(arrival.value);
    const pickupMinutes = parseTime(pickup.value);
    if (Number.isFinite(arrivalMinutes) && Number.isFinite(pickupMinutes) && pickupMinutes < arrivalMinutes) {
      conflicts.push({
        id: conflictId('pickup'),
        severity: 'high',
        title: 'Pickup is scheduled before Taylor arrives',
        detail: `Taylor arrives at ${arrival.value}, but the station pickup is set for ${pickup.value}.`,
        suggestedAction: 'Move station pickup to 7:30 PM.',
        kind: 'transport'
      });
    }
  }

  const dinner = findFact(circle, 'Dinner');
  if (dinner?.status === 'pending') {
    conflicts.push({
      id: conflictId('dinner'),
      severity: 'low',
      title: 'Dinner still needs an owner',
      detail: 'The Circle has no confirmed dinner plan yet.',
      suggestedAction: 'Assign dinner planning to a member.',
      kind: 'assignment'
    });
  }

  circle.conflicts = conflicts;
  circle.lastUpdated = now();
  return conflicts;
}

function parseTime(value) {
  const match = String(value || '').trim().match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!match) return Number.NaN;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const period = match[3]?.toUpperCase();
  if (period === 'PM' && hour !== 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function pendingAction(circle) {
  return circle.actions.find(action => action.status === 'pending');
}

function toolResult(text, data) {
  return {
    content: [{ type: 'text', text }],
    structuredContent: data
  };
}

function toolDefinitions() {
  return [
    {
      name: 'circle_create',
      description: 'Create a shared Circle for people in different homes.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Circle name' },
          description: { type: 'string', description: 'What the Circle is for' }
        },
        required: ['name']
      }
    },
    {
      name: 'circle_get_state',
      description: 'Read the live shared state of a Circle.',
      inputSchema: { type: 'object', properties: { circleId: { type: 'string' } } }
    },
    {
      name: 'circle_update',
      description: 'Record a fact contributed by one home into shared Circle state.',
      inputSchema: {
        type: 'object',
        properties: {
          circleId: { type: 'string' },
          actor: { type: 'string' },
          home: { type: 'string' },
          label: { type: 'string' },
          value: { type: 'string' },
          owner: { type: 'string' }
        },
        required: ['circleId', 'actor', 'home', 'label', 'value']
      }
    },
    {
      name: 'circle_detect_conflicts',
      description: 'Find conflicts or missing work in the shared Circle state.',
      inputSchema: { type: 'object', properties: { circleId: { type: 'string' } }, required: ['circleId'] }
    },
    {
      name: 'circle_create_task',
      description: 'Create a shared task and assign it to a home in the Circle.',
      inputSchema: {
        type: 'object',
        properties: {
          circleId: { type: 'string' },
          actor: { type: 'string' },
          home: { type: 'string' },
          title: { type: 'string' },
          owner: { type: 'string' },
          due: { type: 'string' }
        },
        required: ['circleId', 'actor', 'home', 'title', 'owner']
      }
    },
    {
      name: 'circle_complete_task',
      description: 'Mark a shared Circle task complete from any participating home.',
      inputSchema: {
        type: 'object',
        properties: {
          circleId: { type: 'string' },
          taskId: { type: 'string' },
          actor: { type: 'string' },
          home: { type: 'string' }
        },
        required: ['circleId', 'taskId', 'actor', 'home']
      }
    },
    {
      name: 'circle_propose_action',
      description: 'Create an approval-gated action proposal to repair shared Circle state.',
      inputSchema: {
        type: 'object',
        properties: {
          circleId: { type: 'string' },
          kind: { type: 'string' },
          summary: { type: 'string' }
        },
        required: ['circleId', 'kind', 'summary']
      }
    },
    {
      name: 'circle_approve_action',
      description: 'Approve and execute a pending Circle action.',
      inputSchema: {
        type: 'object',
        properties: { circleId: { type: 'string' }, actionId: { type: 'string' } },
        required: ['circleId', 'actionId']
      }
    }
  ];
}

async function callTool(name, args = {}) {
  if (name === 'circle_create') {
    const id = slugify(args.name);
    if (state.circles[id]) throw new Error(`Circle ${id} already exists`);
    const base = demoCircle();
    const circle = {
      ...base,
      id,
      name: String(args.name),
      description: String(args.description || 'Shared AI space across homes.'),
      members: [],
      facts: [],
      conflicts: [],
      actions: [],
      tasks: [],
      activity: [],
      chat: [],
      lastUpdated: now()
    };
    state.circles[id] = circle;
    addActivity(circle, 'Circle', 'Shared', `Created ${circle.name}.`, 'create');
    await persist();
    return toolResult(`Circle ${circle.name} created.`, circle);
  }

  const circle = getCircle(args.circleId);

  if (name === 'circle_get_state') {
    detectConflicts(circle);
    await persist();
    return toolResult(JSON.stringify(circle), circle);
  }

  if (name === 'circle_update') {
    setFact(circle, {
      label: args.label,
      value: args.value,
      owner: args.owner || args.actor,
      actor: args.actor,
      status: 'confirmed'
    });
    addActivity(circle, args.actor, args.home, `${args.label}: ${args.value}`, 'update');
    addChat(circle, args.actor, args.home, `Shared an update: ${args.label} → ${args.value}`, 'system');
    detectConflicts(circle);
    await persist();
    return toolResult(`Recorded ${args.label}.`, circle);
  }

  if (name === 'circle_detect_conflicts') {
    const conflicts = detectConflicts(circle);
    await persist();
    return toolResult(
      conflicts.length ? `${conflicts.length} issue(s) need attention.` : 'No conflicts detected.',
      { conflicts, circleId: circle.id }
    );
  }

  if (name === 'circle_create_task') {
    const title = String(args.title || '').trim();
    const owner = String(args.owner || '').trim();
    const member = circle.members.find(m => m.name.toLowerCase() === owner.toLowerCase());
    if (!title) throw new Error('Task title is required');
    if (!member) throw new Error('Task owner must be a Circle member');
    const task = {
      id: randomUUID(), title, owner: member.name, home: member.home, status: 'open',
      due: String(args.due || 'Flexible'), createdBy: args.actor || 'Circle', createdAt: now(), completedAt: null
    };
    circle.tasks = circle.tasks || [];
    circle.tasks.unshift(task);
    addActivity(circle, args.actor || 'Circle', args.home || 'Shared', `Created task: ${task.title} → ${task.owner}.`, 'task');
    addChat(circle, 'Circle', 'Shared', `Task created: ${task.title} is assigned to ${task.owner}.`, 'assistant');
    await persist();
    return toolResult(`Created task ${task.title}.`, task);
  }

  if (name === 'circle_complete_task') {
    const task = (circle.tasks || []).find(item => item.id === args.taskId);
    if (!task) throw new Error('Task not found');
    if (task.status === 'completed') return toolResult('Task is already complete.', task);
    task.status = 'completed';
    task.completedAt = now();
    addActivity(circle, args.actor || task.owner, args.home || task.home, `Completed task: ${task.title}.`, 'task');
    addChat(circle, 'Circle', 'Shared', `${task.title} is complete. Every home can see the update.`, 'assistant');
    await persist();
    return toolResult(`Completed ${task.title}.`, task);
  }

  if (name === 'circle_propose_action') {
    const existing = pendingAction(circle);
    if (existing) return toolResult(`An approval is already pending: ${existing.summary}`, existing);
    const action = {
      id: randomUUID(),
      kind: String(args.kind || 'general'),
      summary: String(args.summary),
      status: 'pending',
      proposedAt: now(),
      approvedAt: null
    };
    circle.actions.unshift(action);
    addActivity(circle, 'Circle', 'Shared', `Proposed: ${action.summary}`, 'proposal');
    addChat(circle, 'Circle', 'Shared', `I found a problem and proposed: ${action.summary}`, 'assistant');
    circle.lastUpdated = now();
    await persist();
    return toolResult(`Approval required: ${action.summary}`, action);
  }

  if (name === 'circle_approve_action') {
    const action = circle.actions.find(item => item.id === args.actionId);
    if (!action) throw new Error('Action not found');
    if (action.status !== 'pending') return toolResult(`Action is already ${action.status}.`, action);

    action.status = 'executed';
    action.approvedAt = now();

    if (action.kind === 'transport') {
      setFact(circle, {
        label: 'Station pickup',
        value: '7:30 PM',
        owner: 'Jordan',
        actor: 'Circle',
        status: 'confirmed'
      });
    }

    if (action.kind === 'assignment') {
      setFact(circle, {
        label: 'Dinner',
        value: 'Jordan to coordinate',
        owner: 'Jordan',
        actor: 'Circle',
        status: 'confirmed'
      });
    }

    addActivity(circle, 'Circle', 'Shared', `Executed: ${action.summary}`, 'action');
    addChat(circle, 'Circle', 'Shared', `Approved and applied: ${action.summary}`, 'assistant');
    detectConflicts(circle);
    await persist();
    return toolResult(`Executed: ${action.summary}`, action);
  }

  throw new Error(`Unknown tool: ${name}`);
}

function jsonRpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id, error };
}

async function handleMcp(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'MCP endpoint requires POST.' }, { Allow: 'POST' });
  }

  const body = await readBody(req);
  if (!body || body.jsonrpc !== '2.0') {
    return sendJson(res, 400, jsonRpcError(body?.id ?? null, -32600, 'Invalid JSON-RPC request'));
  }

  const method = body.method;
  const id = body.id ?? null;

  if (method === 'initialize') {
    const requested = body.params?.protocolVersion || '2025-11-25';
    const supported = new Set(['2025-11-25', '2025-06-18', '2025-03-26']);
    const protocolVersion = supported.has(requested) ? requested : '2025-11-25';
    const sessionId = randomUUID();
    sessions.set(sessionId, { createdAt: Date.now(), protocolVersion });

    return sendJson(res, 200, {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion,
        capabilities: {
          tools: { listChanged: false }
        },
        serverInfo: { name: 'circle-mcp', version: '1.0.0' },
        instructions: 'Circle is a shared multi-home AI space. Use tools to read shared state, record contributions, detect conflicts, propose repairs, and apply approved actions.'
      }
    }, { 'Mcp-Session-Id': sessionId });
  }

  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return sendText(res, 202, '');
  }

  if (method === 'ping') {
    return sendJson(res, 200, { jsonrpc: '2.0', id, result: {} });
  }

  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId || !sessions.has(sessionId)) {
    return sendJson(res, 400, jsonRpcError(id, -32000, 'Missing or invalid Mcp-Session-Id'));
  }

  try {
    if (method === 'tools/list') {
      return sendJson(res, 200, { jsonrpc: '2.0', id, result: { tools: toolDefinitions() } });
    }

    if (method === 'tools/call') {
      const name = body.params?.name;
      const args = body.params?.arguments || {};
      if (!toolDefinitions().some(tool => tool.name === name)) {
        return sendJson(res, 200, jsonRpcError(id, -32601, `Unknown tool: ${name}`));
      }
      const result = await callTool(name, args);
      return sendJson(res, 200, { jsonrpc: '2.0', id, result });
    }

    return sendJson(res, 200, jsonRpcError(id, -32601, `Method not found: ${method}`));
  } catch (error) {
    return sendJson(res, 200, {
      jsonrpc: '2.0',
      id,
      error: { code: -32001, message: error.message || 'Tool execution failed' }
    });
  }
}

async function routeApi(req, res, url) {
  if (url.pathname === '/api/state' && req.method === 'GET') {
    const circle = getCircle(url.searchParams.get('circleId') || 'weekend-trip');
    detectConflicts(circle);
    await persist();
    return sendJson(res, 200, circle);
  }

  if (url.pathname === '/api/demo/setup' && req.method === 'POST') {
    state.circles['weekend-trip'] = demoCircle();
    const circle = state.circles['weekend-trip'];
    addActivity(circle, 'Alex', 'Home A', 'Booked the hotel.', 'update');
    addActivity(circle, 'Jordan', 'Home B', 'Confirmed station pickup for 6:45 PM.', 'update');
    addActivity(circle, 'Taylor', 'Home C', 'Train arrival is 7:20 PM.', 'update');
    addActivity(circle, 'Circle', 'Shared', 'Detected a pickup timing conflict.', 'reasoning');
    addChat(circle, 'Circle', 'Shared', 'I found a conflict: the pickup is before Taylor arrives. I can propose a repair.', 'assistant');
    detectConflicts(circle);
    await persist();
    return sendJson(res, 200, circle);
  }

  if (url.pathname === '/api/reset' && req.method === 'POST') {
    state.circles['weekend-trip'] = demoCircle();
    await persist();
    return sendJson(res, 200, state.circles['weekend-trip']);
  }

  if (url.pathname === '/api/tasks' && req.method === 'POST') {
    const body = await readBody(req);
    const circle = getCircle(body?.circleId || 'weekend-trip');
    try {
      const result = await callTool('circle_create_task', {
        circleId: circle.id, actor: body?.actor || 'Alex', home: body?.home || 'Home A',
        title: body?.title, owner: body?.owner, due: body?.due || 'Flexible'
      });
      detectConflicts(circle);
      return sendJson(res, 200, { task: result.structuredContent, circle });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (url.pathname === '/api/tasks/complete' && req.method === 'POST') {
    const body = await readBody(req);
    const circle = getCircle(body?.circleId || 'weekend-trip');
    try {
      const result = await callTool('circle_complete_task', {
        circleId: circle.id, taskId: body?.taskId, actor: body?.actor || 'Alex', home: body?.home || 'Home A'
      });
      return sendJson(res, 200, { task: result.structuredContent, circle });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (url.pathname === '/api/respond' && req.method === 'POST') {
    const body = await readBody(req);
    const circle = getCircle(body?.circleId || 'weekend-trip');
    const actor = body?.actor || 'Alex';
    const home = body?.home || 'Home A';
    const text = String(body?.text || '').trim();
    if (!text) return sendJson(res, 400, { error: 'Message is required.' });

    const normalized = text.toLowerCase();
    addChat(circle, actor, home, text, 'user');

    let reply = '';
    let action = null;

    if (/(what.*task|tasks|to-do|todo)/i.test(text)) {
      const tasks = circle.tasks || [];
      const open = tasks.filter(t => t.status === 'open');
      reply = open.length ? `There are ${open.length} open tasks: ${open.slice(0, 4).map(t => `${t.title} → ${t.owner}`).join('; ')}.` : 'All shared tasks are complete.';
    } else if (/(create|add|make).*(task|todo)/i.test(text)) {
      const titleMatch = text.match(/(?:task|todo)\s*(?:to|:)?\s*(.+)$/i);
      const title = titleMatch?.[1]?.trim() || 'New shared task';
      const owner = actor;
      await callTool('circle_create_task', { circleId: circle.id, actor, home, title, owner, due: 'Flexible' });
      reply = `Created a shared task: ${title}, assigned to ${owner}.`;
    } else if (/(complete|done|finish).*(task|todo)/i.test(text)) {
      const open = (circle.tasks || []).find(t => t.status === 'open' && t.owner.toLowerCase() === actor.toLowerCase());
      if (open) {
        await callTool('circle_complete_task', { circleId: circle.id, taskId: open.id, actor, home });
        reply = `Done. I marked “${open.title}” complete for the Circle.`;
      } else {
        reply = `I couldn't find an open task assigned to ${actor}.`;
      }
    } else     if (/(what.*missing|still.*(need|left)|what.*left)/i.test(text)) {
      detectConflicts(circle);
      if (circle.conflicts.length) {
        reply = circle.conflicts.map(c => c.suggestedAction).join(' ');
      } else {
        reply = 'Nothing important is currently blocked. The Circle is in sync.';
      }
    } else if (/(who.*doing|who.*responsible|owner|assigned)/i.test(text)) {
      const owned = circle.facts.filter(f => f.owner && f.owner !== 'Circle').map(f => `${f.label} → ${f.owner}`).slice(0, 4);
      reply = owned.length ? `Current ownership: ${owned.join('; ')}.` : 'No shared responsibilities have been assigned yet.';
    } else if (/(what.*changed|changes|latest updates|updates)/i.test(text)) {
      const recent = circle.activity.filter(item => item.type !== 'reasoning').slice(0, 3).map(item => `${item.actor} — ${item.message}`).join(' | ');
      reply = recent ? `Latest Circle updates: ${recent}` : 'There are no recent changes yet.';
    } else if (/(what.*plan|status|where.*stand|overview)/i.test(text)) {
      const confirmed = circle.facts.filter(f => f.status === 'confirmed').length;
      reply = `${confirmed} shared items are confirmed. ${circle.conflicts.length ? `There ${circle.conflicts.length === 1 ? 'is' : 'are'} ${circle.conflicts.length} issue${circle.conflicts.length === 1 ? '' : 's'} needing attention.` : 'There are no active conflicts.'}`;
    } else if (/(cab|pickup|station)/i.test(text) && /(7:30|move|change|later)/i.test(text)) {
      const proposal = pendingAction(circle);
      if (!proposal) {
        action = await callTool('circle_propose_action', {
          circleId: circle.id,
          kind: 'transport',
          summary: 'Move station pickup to 7:30 PM to match Taylor’s 7:20 PM arrival.'
        });
      }
      reply = 'I can move the pickup to 7:30 PM. I have prepared an approval request.';
    } else if (/(hotel|booked.*hotel)/i.test(normalized)) {
      await callTool('circle_update', { circleId: circle.id, actor, home, label: 'Hotel', value: 'Lakeview Resort', owner: actor });
      reply = 'Hotel update shared with the Circle.';
    } else if (/(arrive|arriving|train)/i.test(normalized)) {
      const timeMatch = text.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
      const arrival = timeMatch?.[1] || '7:20 PM';
      await callTool('circle_update', { circleId: circle.id, actor, home, label: actor === 'Taylor' ? 'Taylor arrival' : `${actor} arrival`, value: arrival, owner: actor });
      reply = `Arrival update shared: ${arrival}.`;
    } else if (/(cab|pickup)/i.test(normalized)) {
      await callTool('circle_update', { circleId: circle.id, actor, home, label: 'Station pickup', value: '6:45 PM', owner: actor });
      reply = 'Pickup update shared. Circle will check it against the rest of the plan.';
    } else {
      await callTool('circle_update', { circleId: circle.id, actor, home, label: `${actor} note`, value: text, owner: actor });
      reply = 'Got it. That update is now part of the shared Circle state.';
    }

    addChat(circle, 'Circle', 'Shared', reply, 'assistant');
    detectConflicts(circle);
    await persist();
    return sendJson(res, 200, { reply, action, circle });
  }

  return sendJson(res, 404, { error: 'API route not found.' });
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  if (pathname.includes('..')) return sendText(res, 400, 'Bad path');

  const file = path.join(PUBLIC_DIR, pathname);
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error('not a file');
    const body = await fs.readFile(file);
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    return sendText(res, 200, body, type, { 'Cache-Control': 'no-store' });
  } catch {
    return sendText(res, 404, 'Not found');
  }
}

ensureDemoCircle();
await persist();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    if (url.pathname === '/mcp') return handleMcp(req, res);
    if (url.pathname.startsWith('/api/')) return routeApi(req, res, url);
    if (req.method !== 'GET') return sendText(res, 405, 'Method not allowed');
    return serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: 'Internal server error.' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Circle running at http://127.0.0.1:${PORT}`);
  console.log(`MCP endpoint: http://127.0.0.1:${PORT}/mcp`);
});
