# Strands Chat

A chat interface on top of the Strands harness: a sidebar of chats (pin, search, delete) and a conversation
view. Each chat has its own harness agent, and its conversation is kept in a harness session named after the
chat, so history survives a restart.

Standard library only; no extra dependencies beyond `strands-harness`.

## Run

```bash
cd chat-ui
python server.py --demo        # echo replies, no model needed
python server.py               # the harness default model (needs that model's credentials)
```

Then open http://127.0.0.1:8000. Options: `--host`, `--port`, and `--data` (the JSON file that stores chats,
default `./.agent/chat-ui/chats.json`).

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
| GET | `/api/chats` | | the chat list, pinned first |
| POST | `/api/chats` | | a new chat |
| GET | `/api/chats/{id}` | | a chat with its messages |
| PATCH | `/api/chats/{id}` | `{"title"?, "pinned"?}` | the updated chat |
| DELETE | `/api/chats/{id}` | | `{"deleted": id}` |
| POST | `/api/chats/{id}/messages` | `{"content"}` | the assistant reply (role `error` if the model call fails) |

Replies run one at a time, because harness agents are not thread-safe.
