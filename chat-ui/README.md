# Strands Chat

A chat interface on top of the Strands harness: a sidebar of chats (pin, search, delete) and a conversation
view. Each chat has its own harness agent, and its conversation is kept in a harness session named after the
chat, so history survives a restart.

Standard library only; no extra dependencies beyond `strands-harness`.

## Run

```bash
cd chat-ui
python server.py --demo                              # echo replies, no model needed
python server.py --model bedrock/... --model openai/...   # harness agents; --model adds a model to the picker
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
python -m pytest tests
```

## Layout

- `server.py`: the HTTP server and JSON API (`ChatStore` persists chats, `ChatService` runs replies).
- `static/`: the page (`index.html`, `style.css`, `app.js`); no external scripts or fonts.

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
