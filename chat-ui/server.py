"""Backend for the chat UI: a JSON API over harness agents, one agent per chat.

Run ``python server.py`` to answer with the harness default model (it needs that model's credentials),
or ``python server.py --demo`` to answer with an echo agent and no model at all.

Chats and their messages live in one JSON file. Each chat's agent keeps its conversation in a harness
session named after the chat, so the history survives a restart.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import re
import threading
import time
import uuid
from collections.abc import Callable
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

STATIC_DIR = Path(__file__).parent / "static"
DEFAULT_DATA_FILE = Path(".agent/chat-ui/chats.json")
DEFAULT_TITLE = "New chat"
MAX_BODY_BYTES = 1_000_000
MAX_TITLE_CHARS = 60

Replier = Callable[[str], str]
ReplierFactory = Callable[[str], Replier]


class ApiError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def harness_replier_factory(chat_id: str) -> Replier:
    """A reply function backed by a harness agent whose session is the chat id."""
    from strands_harness import create_harness

    agent = create_harness(session={"id": chat_id})
    return lambda prompt: str(agent(prompt))


def echo_replier_factory(chat_id: str) -> Replier:
    """A reply function that needs no model; used for ``--demo`` and tests."""
    return lambda prompt: f"Echo: {prompt}"


class ChatStore:
    """Chats kept in memory and written to one JSON file after every change."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._chats: dict[str, dict] = json.loads(path.read_text()) if path.exists() else {}

    def list_chats(self) -> list[dict]:
        with self._lock:
            summaries = [_summary(chat) for chat in self._chats.values()]
        return sorted(summaries, key=lambda chat: (not chat["pinned"], -chat["updated_at"]))

    def get(self, chat_id: str) -> dict:
        with self._lock:
            return _copy(self._require(chat_id))

    def create(self) -> dict:
        now = time.time()
        chat = {
            "id": uuid.uuid4().hex[:12],
            "title": DEFAULT_TITLE,
            "pinned": False,
            "created_at": now,
            "updated_at": now,
            "messages": [],
        }
        with self._lock:
            self._chats[chat["id"]] = chat
            self._save()
            return _copy(chat)

    def update(self, chat_id: str, title: str | None, pinned: bool | None) -> dict:
        with self._lock:
            chat = self._require(chat_id)
            if title is not None:
                chat["title"] = title.strip()[:MAX_TITLE_CHARS] or DEFAULT_TITLE
            if pinned is not None:
                chat["pinned"] = pinned
            self._save()
            return _copy(chat)

    def delete(self, chat_id: str) -> None:
        with self._lock:
            self._require(chat_id)
            del self._chats[chat_id]
            self._save()

    def append(self, chat_id: str, role: str, content: str) -> dict:
        message = {"role": role, "content": content, "created_at": time.time()}
        with self._lock:
            chat = self._require(chat_id)
            chat["messages"].append(message)
            chat["updated_at"] = message["created_at"]
            if chat["title"] == DEFAULT_TITLE and role == "user":
                chat["title"] = content.strip().splitlines()[0][:MAX_TITLE_CHARS] or DEFAULT_TITLE
            self._save()
            return dict(message)

    def _require(self, chat_id: str) -> dict:
        chat = self._chats.get(chat_id)
        if chat is None:
            raise ApiError(HTTPStatus.NOT_FOUND, f"no chat {chat_id!r}")
        return chat

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._chats, indent=2))
        tmp.replace(self._path)


class ChatService:
    """Chat operations plus the replies. Replies run one at a time: harness agents are not thread-safe."""

    def __init__(self, store: ChatStore, replier_factory: ReplierFactory) -> None:
        self.store = store
        self._replier_factory = replier_factory
        self._repliers: dict[str, Replier] = {}
        self._reply_lock = threading.Lock()

    def send(self, chat_id: str, content: str) -> dict:
        if not content.strip():
            raise ApiError(HTTPStatus.BAD_REQUEST, "message content is empty")
        self.store.get(chat_id)  # raises 404 for an unknown chat before anything is stored
        self.store.append(chat_id, "user", content)
        with self._reply_lock:
            try:
                reply = self._replier(chat_id)(content)
            except Exception as error:  # a model or tool failure is shown in the chat, not as a server crash
                return self.store.append(chat_id, "error", f"{type(error).__name__}: {error}")
        return self.store.append(chat_id, "assistant", reply)

    def _replier(self, chat_id: str) -> Replier:
        if chat_id not in self._repliers:
            self._repliers[chat_id] = self._replier_factory(chat_id)
        return self._repliers[chat_id]


def _summary(chat: dict) -> dict:
    return {key: chat[key] for key in ("id", "title", "pinned", "created_at", "updated_at")}


def _copy(chat: dict) -> dict:
    return json.loads(json.dumps(chat))


CHAT_PATH = re.compile(r"^/api/chats/([a-z0-9]+)(/messages)?$")


def make_handler(service: ChatService) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            self._handle(self._get)

        def do_POST(self) -> None:
            self._handle(self._post)

        def do_PATCH(self) -> None:
            self._handle(self._patch)

        def do_DELETE(self) -> None:
            self._handle(self._delete)

        def _handle(self, route: Callable[[str], None]) -> None:
            path = unquote(urlsplit(self.path).path)
            try:
                route(path)
            except ApiError as error:
                self._json(error.status, {"error": error.message})

        def _get(self, path: str) -> None:
            if path == "/":
                return self._static("index.html")
            if path.startswith("/static/"):
                return self._static(path.removeprefix("/static/"))
            if path == "/api/chats":
                return self._json(200, {"chats": service.store.list_chats()})
            chat_id = _chat_id(path)
            if chat_id:
                return self._json(200, service.store.get(chat_id))
            raise ApiError(404, "not found")

        def _post(self, path: str) -> None:
            if path == "/api/chats":
                return self._json(201, service.store.create())
            chat_id = _chat_id(path, messages=True)
            if chat_id:
                message = service.send(chat_id, str(self._body().get("content", "")))
                return self._json(200, message)
            raise ApiError(404, "not found")

        def _patch(self, path: str) -> None:
            chat_id = _chat_id(path)
            if not chat_id:
                raise ApiError(404, "not found")
            body = self._body()
            title = body.get("title")
            pinned = body.get("pinned")
            if title is not None and not isinstance(title, str):
                raise ApiError(400, "title must be a string")
            if pinned is not None and not isinstance(pinned, bool):
                raise ApiError(400, "pinned must be a boolean")
            self._json(200, service.store.update(chat_id, title, pinned))

        def _delete(self, path: str) -> None:
            chat_id = _chat_id(path)
            if not chat_id:
                raise ApiError(404, "not found")
            service.store.delete(chat_id)
            self._json(200, {"deleted": chat_id})

        def _body(self) -> dict:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY_BYTES:
                raise ApiError(413, "request body is too large")
            if length == 0:
                return {}
            try:
                body = json.loads(self.rfile.read(length))
            except json.JSONDecodeError as error:
                raise ApiError(400, f"invalid JSON: {error}") from error
            if not isinstance(body, dict):
                raise ApiError(400, "request body must be a JSON object")
            return body

        def _json(self, status: int, payload: dict) -> None:
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _static(self, name: str) -> None:
            target = (STATIC_DIR / name).resolve()
            if not target.is_relative_to(STATIC_DIR.resolve()) or not target.is_file():
                raise ApiError(404, "not found")
            data = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, format: str, *args: object) -> None:
            pass  # keep the terminal for the server's own output

    return Handler


def _chat_id(path: str, messages: bool = False) -> str | None:
    match = CHAT_PATH.match(path)
    if not match or bool(match.group(2)) != messages:
        return None
    return match.group(1)


def make_server(host: str, port: int, service: ChatService) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), make_handler(service))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA_FILE, help="JSON file that stores the chats")
    parser.add_argument("--demo", action="store_true", help="answer with an echo agent instead of a model")
    args = parser.parse_args()

    factory = echo_replier_factory if args.demo else harness_replier_factory
    service = ChatService(ChatStore(args.data), factory)
    server = make_server(args.host, args.port, service)
    print(f"Strands Chat on http://{args.host}:{server.server_port}  (data: {args.data})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
