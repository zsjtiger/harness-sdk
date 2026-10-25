import http.client
import json
import sys
import threading
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import ChatService, ChatStore, echo_replier_factory, make_server  # noqa: E402


@pytest.fixture
def base_url(tmp_path):
    service = ChatService(ChatStore(tmp_path / "chats.json"), echo_replier_factory)
    server = make_server("127.0.0.1", 0, service)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"127.0.0.1:{server.server_port}"
    server.shutdown()
    server.server_close()


def request(host, method, path, body=None, raw=None):
    connection = http.client.HTTPConnection(host, timeout=5)
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    connection.request(method, path, body=data, headers={"Content-Type": "application/json"})
    response = connection.getresponse()
    payload = response.read()
    connection.close()
    content_type = response.getheader("Content-Type", "")
    return response.status, (json.loads(payload) if content_type == "application/json" else payload)


def test_chat_lifecycle(base_url):
    status, chat = request(base_url, "POST", "/api/chats")
    assert status == 201
    assert chat["title"] == "New chat"

    status, reply = request(base_url, "POST", f"/api/chats/{chat['id']}/messages", {"content": "Hello there\nsecond line"})
    assert status == 200
    assert reply == {**reply, "role": "assistant", "content": "Echo: Hello there\nsecond line"}

    status, detail = request(base_url, "GET", f"/api/chats/{chat['id']}")
    assert [m["role"] for m in detail["messages"]] == ["user", "assistant"]
    assert detail["title"] == "Hello there"  # the first line of the first message becomes the title

    status, _ = request(base_url, "PATCH", f"/api/chats/{chat['id']}", {"pinned": True})
    assert status == 200
    status, listing = request(base_url, "GET", "/api/chats")
    assert listing["chats"][0]["id"] == chat["id"]
    assert listing["chats"][0]["pinned"] is True

    status, _ = request(base_url, "DELETE", f"/api/chats/{chat['id']}")
    assert status == 200
    status, _ = request(base_url, "GET", f"/api/chats/{chat['id']}")
    assert status == 404


def test_unknown_chat_and_empty_message_are_rejected(base_url):
    status, error = request(base_url, "POST", "/api/chats/abcdef123456/messages", {"content": "hi"})
    assert status == 404
    assert "no chat" in error["error"]

    _, chat = request(base_url, "POST", "/api/chats")
    status, error = request(base_url, "POST", f"/api/chats/{chat['id']}/messages", {"content": "   "})
    assert status == 400
    assert "empty" in error["error"]


def test_malformed_bodies_are_rejected(base_url):
    _, chat = request(base_url, "POST", "/api/chats")
    status, error = request(base_url, "POST", f"/api/chats/{chat['id']}/messages", raw=b"{not json")
    assert status == 400
    assert "invalid JSON" in error["error"]

    status, error = request(base_url, "PATCH", f"/api/chats/{chat['id']}", {"pinned": "yes"})
    assert status == 400
    assert "boolean" in error["error"]


def test_a_failing_replier_is_shown_as_an_error_message(tmp_path):
    def broken(chat_id):
        def reply(prompt):
            raise RuntimeError("model unavailable")

        return reply

    service = ChatService(ChatStore(tmp_path / "chats.json"), broken)
    chat = service.store.create()
    message = service.send(chat["id"], "hi")
    assert message["role"] == "error"
    assert message["content"] == "RuntimeError: model unavailable"
    assert [m["role"] for m in service.store.get(chat["id"])["messages"]] == ["user", "error"]


def test_chats_survive_a_restart(tmp_path):
    path = tmp_path / "chats.json"
    chat = ChatService(ChatStore(path), echo_replier_factory)
    created = chat.store.create()
    chat.send(created["id"], "remember me")

    restarted = ChatStore(path)
    assert [m["content"] for m in restarted.get(created["id"])["messages"]] == ["remember me", "Echo: remember me"]


def test_static_files_are_served_and_stay_inside_the_static_directory(base_url):
    status, body = request(base_url, "GET", "/")
    assert status == 200
    assert b"Strands Chat" in body

    status, _ = request(base_url, "GET", "/static/%2e%2e/server.py")
    assert status == 404
