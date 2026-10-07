# Circle

## Different homes. One AI.

Circle is a simulated Alexa+ experience that lets people in independent homes participate in one persistent shared conversational AI space.

### What the final demo proves

- Three independent simulated homes share one Circle state.
- Each home can contribute through its own text or browser speech input.
- Circle keeps a cross-home activity timeline and shared facts synchronized.
- Circle detects a timing conflict across homes instead of only answering questions.
- Circle proposes an approval-gated repair.
- One approval applies the repaired state to every home.
- Every home can ask the same Circle for status, ownership, missing items, or recent changes.
- The backend exposes real Circle actions through a self-hosted MCP endpoint.

### Final demo flow

1. Open `http://127.0.0.1:8787`.
2. Click **Run the 60-second demo**.
3. Observe three homes contributing hotel, pickup, and arrival information.
4. Circle identifies that a 6:45 PM pickup is earlier than a 7:20 PM arrival.
5. Click **Create repair proposal**.
6. Click **Approve for everyone**.
7. Watch the shared pickup update to 7:30 PM and propagate across the Circle.
8. Ask from any home: `What's missing?`, `What's the plan?`, `Who is responsible?`, or `What changed?`.

#
## Interactive shared tasks

Circle includes a lightweight task layer so judges can play with the shared state instead of only watching the scripted demo. Create a task, assign it to any home, and complete it from the UI; the change appears in the shared timeline and every home sees the same state. The MCP server exposes `circle_create_task` and `circle_complete_task` for the same workflow.

Try these from any home conversation:
- `Create a task to book dinner`
- `What tasks are open?`
- `Complete my task`

## Run

Requires Node.js 20+.

```powershell
npm start
```

Then open `http://127.0.0.1:8787`.

### MCP smoke test

```powershell
npm run mcp:check
```

The MCP server accepts `2025-11-25` and earlier supported revisions used by the project test client, over HTTP at `/mcp`.

### Project structure

```text
Circle/
├── data/state.json
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── scripts/check-mcp.mjs
├── package.json
├── server.mjs
└── README.md
```

This repository intentionally uses zero external npm dependencies so the demo can run locally with a standard Node.js installation.
