let state = null;
let mcpSession = null;
let rpcId = 1;
let demoRunning = false;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function timeLabel(value) {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  } catch {
    return '';
  }
}

function setSync(label = 'SYNCED', mode = 'ok') {
  const badge = $('#syncBadge');
  if (!badge) return;
  badge.className = `sync-badge ${mode}`;
  badge.innerHTML = `<span class="sync-dot"></span>${escapeHtml(label)}`;
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function memberByName(name) {
  return state?.members?.find(member => member.name.toLowerCase() === String(name).toLowerCase()) || null;
}

function sharedFact(label) {
  return state?.facts?.find(f => f.label.toLowerCase() === label.toLowerCase()) || null;
}

function renderCircleOverview() {
  $('#circleName').textContent = state.name;
  $('#circleDesc').textContent = state.description;
  $('#memberCount').textContent = String(state.members.length);
  $('#circlePurpose').textContent = `Coordinate ${state.name.toLowerCase()} across ${state.members.length} independent homes.`;

  const confirmed = state.facts.filter(f => f.status === 'confirmed').length;
  const issues = state.conflicts.length;
  const activity = state.activity.length;
  $('#confirmedCount').textContent = String(confirmed);
  $('#issueCountTop').textContent = String(issues);
  $('#activityCount').textContent = String(activity);
}

function renderHomes() {
  const grid = $('#homesGrid');

  // Preserve any text the user is currently typing. Circle refreshes shared
  // state periodically, so re-rendering the home cards must not wipe drafts.
  const drafts = Object.fromEntries($$('.utterance').map(input => [input.dataset.actor, input.value]));
  const activeActor = document.activeElement?.dataset?.actor || null;
  const selectionStart = document.activeElement?.selectionStart ?? null;
  const selectionEnd = document.activeElement?.selectionEnd ?? null;

  grid.innerHTML = state.members.map(member => {
    const messages = (state.chat || []).filter(item => item.actor === member.name).slice(-1);
    const latest = messages[0]?.message || 'Ready to participate in the shared Circle.';
    const homeFacts = state.facts.filter(fact => fact.owner === member.name).slice(0, 2);
    const chips = homeFacts.map(fact => `<span class="mini-chip">${escapeHtml(fact.label)} · ${escapeHtml(fact.value)}</span>`).join('');
    return `
      <article class="home-card accent-${escapeHtml(member.accent)}" data-actor="${escapeHtml(member.name)}" data-home="${escapeHtml(member.home)}">
        <div class="home-head">
          <div>
            <span class="home-label">${escapeHtml(member.home)}</span>
            <h3>${escapeHtml(member.name)}</h3>
          </div>
          <span class="status"><span class="status-dot"></span>${escapeHtml(member.status)}</span>
        </div>
        <div class="home-role">This home can talk to Circle independently.</div>
        <div class="voice-row">
          <button class="mic" data-actor="${escapeHtml(member.name)}" data-home="${escapeHtml(member.home)}" aria-label="Speak as ${escapeHtml(member.name)}">⌁</button>
          <input class="utterance" data-actor="${escapeHtml(member.name)}" data-home="${escapeHtml(member.home)}" placeholder="Ask Circle…" autocomplete="off" />
          <button class="send" data-actor="${escapeHtml(member.name)}" data-home="${escapeHtml(member.home)}">Send</button>
        </div>
        <div class="response" id="resp-${slug(member.name)}">${escapeHtml(latest)}</div>
        <div class="home-facts">${chips || '<span class="mini-chip muted-chip">No personal updates yet</span>'}</div>
      </article>`;
  }).join('');

  $$('.utterance').forEach(input => {
    input.value = drafts[input.dataset.actor] || '';
  });

  if (activeActor) {
    const activeInput = $(`.utterance[data-actor="${CSS.escape(activeActor)}"]`);
    if (activeInput) {
      activeInput.focus({ preventScroll: true });
      if (selectionStart !== null && selectionEnd !== null) {
        const end = activeInput.value.length;
        activeInput.setSelectionRange(Math.min(selectionStart, end), Math.min(selectionEnd, end));
      }
    }
  }

  $$('.send').forEach(btn => btn.addEventListener('click', () => sendMessage(btn)));
  $$('.utterance').forEach(input => input.addEventListener('keydown', event => {
    if (event.key === 'Enter') input.closest('.voice-row')?.querySelector('.send')?.click();
  }));
  $$('.mic').forEach(btn => btn.addEventListener('click', () => startSpeech(btn)));
}

function renderSharedChips() {
  const chipData = [
    ['Hotel', sharedFact('Hotel')?.value || '—'],
    ['Pickup', sharedFact('Station pickup')?.value || '—'],
    ['Arrival', sharedFact('Taylor arrival')?.value || '—']
  ];
  $('#sharedChips').innerHTML = chipData.map(([label, value]) => `<span class="shared-chip"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></span>`).join('');
}

function renderFacts() {
  const facts = $('#facts');
  facts.innerHTML = state.facts.map(fact => `
    <article class="fact ${fact.status === 'pending' ? 'pending' : ''}">
      <div class="fact-top"><span class="fact-label">${escapeHtml(fact.label)}</span><span class="fact-status">${escapeHtml(fact.status)}</span></div>
      <strong>${escapeHtml(fact.value)}</strong>
      <small>Owner: ${escapeHtml(fact.owner)} · last update: ${escapeHtml(fact.updatedBy)}</small>
    </article>`).join('');
}

function renderConflicts() {
  const list = $('#conflicts');
  const conflicts = state.conflicts || [];
  $('#issueCount').textContent = String(conflicts.length);

  if (!conflicts.length) {
    list.innerHTML = `<div class="empty-state"><span class="check">✓</span><div><strong>Circle is in sync.</strong><p>No cross-home conflicts are currently blocking the shared plan.</p></div></div>`;
  } else {
    list.innerHTML = conflicts.map(conflict => `
      <article class="conflict severity-${escapeHtml(conflict.severity)}">
        <div class="conflict-title"><span class="warning">!</span><strong>${escapeHtml(conflict.title)}</strong></div>
        <p>${escapeHtml(conflict.detail)}</p>
        <div class="suggestion"><span>Circle recommendation</span><strong>${escapeHtml(conflict.suggestedAction)}</strong></div>
      </article>`).join('');
  }

  const pending = state.actions?.find(action => action.status === 'pending');
  const proposal = $('#proposal');
  if (pending) {
    proposal.classList.remove('hidden');
    proposal.innerHTML = `<div class="proposal-head"><span class="proposal-icon">→</span><div><span>APPROVAL REQUIRED</span><strong>${escapeHtml(pending.summary)}</strong></div></div><small>Nothing changes for the Circle until a participant approves this repair.</small>`;
  } else {
    proposal.classList.add('hidden');
    proposal.innerHTML = '';
  }
}

function renderTasks() {
  const tasks = $('#tasks');
  const ownerSelect = $('#taskOwner');
  const items = state.tasks || [];
  if (ownerSelect) {
    const current = ownerSelect.value;
    ownerSelect.innerHTML = state.members.map(member => `<option value="${escapeHtml(member.name)}">Assign to ${escapeHtml(member.name)}</option>`).join('');
    if (current && state.members.some(member => member.name === current)) ownerSelect.value = current;
  }
  if (!tasks) return;
  if (!items.length) {
    tasks.innerHTML = '<div class="empty-state"><div><strong>No shared tasks yet.</strong><p>Create one above and watch it appear in every home.</p></div></div>';
    return;
  }
  tasks.innerHTML = items.slice(0, 10).map(task => `
    <article class="task-card ${task.status === 'completed' ? 'completed' : ''}">
      <div class="task-check">${task.status === 'completed' ? '✓' : '○'}</div>
      <div class="task-copy"><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(task.owner)} · ${escapeHtml(task.home)} · ${escapeHtml(task.due || 'Flexible')}</span></div>
      <span class="task-status">${escapeHtml(task.status)}</span>
      ${task.status === 'completed' ? '' : `<button class="task-complete" data-task-id="${escapeHtml(task.id)}">Complete</button>`}
    </article>`).join('');
  $$('.task-complete').forEach(btn => btn.addEventListener('click', () => completeTask(btn.dataset.taskId)));
}

async function createTask() {
  const titleInput = $('#taskTitle');
  const owner = $('#taskOwner')?.value || state.members[0]?.name;
  const due = $('#taskDue')?.value.trim() || 'Flexible';
  const title = titleInput?.value.trim();
  if (!title || !owner) return;
  const member = memberByName(owner);
  try {
    setSync('ADDING SHARED TASK', 'busy');
    const result = await api('/api/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ circleId: 'weekend-trip', actor: owner, home: member?.home || 'Shared', title, owner, due })
    });
    state = result.circle;
    titleInput.value = '';
    $('#taskDue').value = '';
    render();
    setSync('ALL HOMES UPDATED', 'ok');
    speak(`Task created and assigned to ${owner}.`);
  } catch (error) {
    console.error(error); setSync('ERROR', 'bad');
  }
}

async function completeTask(taskId) {
  const task = (state.tasks || []).find(item => item.id === taskId);
  if (!task) return;
  try {
    setSync('SYNCING TASK', 'busy');
    const result = await api('/api/tasks/complete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ circleId: 'weekend-trip', taskId, actor: task.owner, home: task.home })
    });
    state = result.circle;
    render();
    setSync('ALL HOMES UPDATED', 'ok');
    speak(`${task.title} is complete for everyone.`);
  } catch (error) {
    console.error(error); setSync('ERROR', 'bad');
  }
}

function renderActivity() {
  const container = $('#activity');
  const items = state.activity || [];
  container.innerHTML = items.length ? items.slice(0, 16).map(item => `
    <div class="activity-item type-${escapeHtml(item.type)}">
      <div class="activity-node">${item.type === 'action' ? '✓' : item.type === 'reasoning' ? '!' : item.type === 'update' ? '↗' : '•'}</div>
      <div class="activity-copy"><strong>${escapeHtml(item.actor)}</strong><span>${escapeHtml(item.home)}</span><p>${escapeHtml(item.message)}</p></div>
      <time>${timeLabel(item.at)}</time>
    </div>`).join('') : '<div class="empty-state">No activity yet.</div>';
}

function renderChat() {
  const chat = $('#chat');
  const items = state.chat || [];
  chat.innerHTML = items.slice(-16).map(item => `
    <div class="chat-row ${item.role === 'assistant' ? 'assistant' : item.role === 'system' ? 'system' : 'user'}">
      <div class="chat-meta"><strong>${escapeHtml(item.actor)}</strong><span>${escapeHtml(item.home)}</span><time>${timeLabel(item.at)}</time></div>
      <div class="chat-bubble">${escapeHtml(item.message)}</div>
    </div>`).join('');
  chat.scrollTop = chat.scrollHeight;
}

function updateDemoStage() {
  const pending = state.actions?.find(action => action.status === 'pending');
  const conflict = (state.conflicts || [])[0];
  const executed = state.actions?.some(action => action.status === 'executed');
  const title = $('#demoStageTitle');
  const text = $('#demoStageText');

  if (pending) {
    title.textContent = 'Circle found a conflict and is waiting for one approval.';
    text.textContent = 'The proposed repair is visible to every home, but the shared state stays unchanged until approval.';
  } else if (conflict) {
    title.textContent = 'Circle found a cross-home conflict and can repair it.';
    text.textContent = conflict.suggestedAction;
  } else if (executed) {
    title.textContent = 'Repair applied. Every home now sees the same updated state.';
    text.textContent = 'The pickup moved to 7:30 PM to follow Taylor’s 7:20 PM arrival.';
  } else {
    title.textContent = 'Trigger the timing conflict → Circle proposes a repair → one approval updates every home.';
    text.textContent = 'Start the demo to reset the three homes and surface the agent workflow.';
  }
}

function render() {
  if (!state) return;
  renderCircleOverview();
  $('#lastUpdated').textContent = `Updated ${timeLabel(state.lastUpdated)}`;
  renderHomes();
  renderSharedChips();
  renderFacts();
  renderTasks();
  renderConflicts();
  renderActivity();
  renderChat();
  updateDemoStage();
}

async function mcpCall(method, params = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream'
  };
  if (mcpSession) headers['Mcp-Session-Id'] = mcpSession;

  const response = await fetch('/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params })
  });

  const next = response.headers.get('Mcp-Session-Id');
  if (next) mcpSession = next;
  if (response.status === 202 || response.status === 204) return null;

  const body = await response.json();
  if (body.error) throw new Error(body.error.message || 'MCP error');
  if (body.result?.structuredContent !== undefined) return body.result.structuredContent;
  return body.result;
}

async function refresh() {
  state = await api('/api/state?circleId=weekend-trip');
  render();
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.02;
  utterance.pitch = 1;
  utterance.volume = 0.85;
  window.speechSynthesis.speak(utterance);
}

async function seedDemo() {
  if (demoRunning) return;
  demoRunning = true;
  try {
    setSync('RESETTING CIRCLE', 'busy');
    state = await api('/api/demo/setup', { method: 'POST' });
    render();
    setSync('CONFLICT FOUND', 'warn');
    speak('Circle found a conflict between Taylor’s arrival and the station pickup.');
    $('#conflicts')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    console.error(error);
    setSync('ERROR', 'bad');
  } finally {
    demoRunning = false;
  }
}

async function proposeRepair() {
  try {
    setSync('REASONING', 'busy');
    const existing = state.actions?.find(action => action.status === 'pending');
    if (!existing) {
      await mcpCall('tools/call', {
        name: 'circle_propose_action',
        arguments: {
          circleId: 'weekend-trip',
          kind: 'transport',
          summary: 'Move station pickup to 7:30 PM to match Taylor’s 7:20 PM arrival.'
        }
      });
    }
    await refresh();
    setSync('APPROVAL READY', 'warn');
    speak('I found a timing conflict. A repair is ready for approval.');
    $('#proposal')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    setSync('ERROR', 'bad');
    console.error(error);
  }
}

async function approveRepair() {
  try {
    const action = state.actions?.find(item => item.status === 'pending');
    if (!action) {
      await proposeRepair();
      return;
    }
    setSync('APPLYING TO EVERY HOME', 'busy');
    await mcpCall('tools/call', {
      name: 'circle_approve_action',
      arguments: { circleId: 'weekend-trip', actionId: action.id }
    });
    await refresh();
    setSync('ALL HOMES SYNCED', 'ok');
    speak('Approved. The shared pickup is now 7:30 PM across the Circle.');
    $('#homesGrid')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    setSync('ERROR', 'bad');
    console.error(error);
  }
}

async function sendMessage(button) {
  const actor = button.dataset.actor;
  const home = button.dataset.home;
  const input = document.querySelector(`.utterance[data-actor="${CSS.escape(actor)}"]`);
  const text = input?.value.trim();
  if (!text) return;

  setSync('SYNCING', 'busy');
  input.value = '';
  try {
    const result = await api('/api/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ circleId: 'weekend-trip', actor, home, text })
    });
    state = result.circle;
    render();
    setSync('SYNCED', 'ok');
    speak(result.reply);
  } catch (error) {
    console.error(error);
    setSync('ERROR', 'bad');
  }
}

function startSpeech(button) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const input = document.querySelector(`.utterance[data-actor="${CSS.escape(button.dataset.actor)}"]`);
  if (!Recognition || !input) {
    if (input) input.placeholder = 'Speech input is unavailable in this browser.';
    return;
  }

  setSync('LISTENING', 'busy');
  const recognition = new Recognition();
  recognition.lang = 'en-IN';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = event => {
    input.value = event.results[0][0].transcript;
    input.closest('.voice-row')?.querySelector('.send')?.click();
  };
  recognition.onerror = () => setSync('SYNCED', 'ok');
  recognition.onend = () => setSync('SYNCED', 'ok');
  recognition.start();
}

$('#demoBtn').addEventListener('click', seedDemo);
$('#createTaskBtn').addEventListener('click', createTask);
$('#taskTitle').addEventListener('keydown', event => { if (event.key === 'Enter') createTask(); });
$('#proposalBtn').addEventListener('click', proposeRepair);
$('#approveBtn').addEventListener('click', approveRepair);
$('#resetBtn').addEventListener('click', async () => {
  await api('/api/reset', { method: 'POST' });
  await refresh();
  setSync('RESET COMPLETE', 'ok');
  speak('Circle is reset and ready.');
});

(async function boot() {
  try {
    await mcpCall('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'circle-web-sim', version: '1.0.0' }
    });
    await mcpCall('notifications/initialized', {});
    await refresh();
    setSync('SYNCED', 'ok');
  } catch (error) {
    console.error(error);
    setSync('MCP OFFLINE', 'bad');
    try { await refresh(); } catch (fallbackError) { console.error(fallbackError); }
  }

  setInterval(async () => {
    if (document.hidden) return;
    try { await refresh(); } catch (error) { console.error(error); }
  }, 1800);
})();
