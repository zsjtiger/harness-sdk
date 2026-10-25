# Strands Chat

A chat interface on top of the Strands harness: a sidebar of chats (pin, search, delete) and a conversation
view. Each chat has its own harness agent, and its conversation is kept in a harness session named after the
chat, so history survives a restart.

The server uses only the standard library and `strands-harness`. The interface is a React app in `web/`,
built with Vite into `static/`.

## Run

```bash
cd chat-ui/web && npm install && npm run build   # once, and again after changing web/src
cd .. && python server.py --demo                              # echo replies, no model needed
python server.py --model bedrock/... --model openai/...   # harness agents; --model adds a model to the picker
```

Without the build, the server answers `/` with a message that says so.

## Develop the interface

Run the API server and the Vite dev server side by side. Vite serves the app under `/static/` and proxies `/api`
to port 8000.

```bash
cd chat-ui && python server.py --demo          # port 8000
cd chat-ui/web && npm run dev                  # open http://127.0.0.1:5173/static/

cd chat-ui/web && npm test                     # unit tests for the helpers and the Markdown renderer
```

Then open http://127.0.0.1:8000. Options: `--host`, `--port`, `--data` (the JSON file that stores chats,
default `./.agent/chat-ui/chats.json`), `--model` (repeatable), and `--demo`. The picker always offers the
harness default model.

## Features

- Sidebar: new chat, search, pinned and recent groups (collapsible), pin and delete per chat.
- Composer: "+" attaches text files (sent inline with the message, 200 KB in total), the microphone uses the
  browser's speech recognition (shown only where it is available), Enter sends, Shift+Enter adds a line.
- Slash commands: type `/` for `/new`, `/search`, `/pin`, `/delete`.
- Pickers under the composer: model and reasoning effort. They apply to the open chat, or to the next chat
  when none is open. Changing them rebuilds that chat's agent; its history is kept.
- Not included: Projects, Artifacts, Scheduled tasks, Customize, the account menu, and Auto/Manual approval
  mode. The harness has no matching feature for these, and its approval prompt reads from standard input,
  which would block a web server.

## Test

```bash
cd chat-ui
python -m pytest tests      # backend
cd web && npm test           # frontend
```

## Layout

- `server.py`: the HTTP server and JSON API (`ChatStore` persists chats, `ChatService` runs replies).
- `web/`: the React interface (TypeScript, Vite). `src/App.tsx` holds the state; `src/components/` has the sidebar,
  the message list, and the composer; `src/api.ts` is the API client; `src/markdown.tsx` renders messages as React
  elements, so no HTML is ever parsed from message text.
- `static/`: the build output that `server.py` serves. `index.html` and `assets/` are generated and not tracked.

## API

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/api/config` | | the models and efforts for the pickers |
| GET | `/api/chats` | | the chat list, pinned first |
| POST | `/api/chats` | | a new chat |
| GET | `/api/chats/{id}` | | a chat with its messages |
| PATCH | `/api/chats/{id}` | `{"title"?, "pinned"?, "model"?, "effort"?}` | the updated chat |
| DELETE | `/api/chats/{id}` | | `{"deleted": id}` |
| POST | `/api/chats/{id}/messages` | `{"content"}` | the assistant reply (role `error` if the model call fails) |

Replies run one at a time, because harness agents are not thread-safe.
