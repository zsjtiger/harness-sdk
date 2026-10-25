import http.client
import json
import sys
import threading
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import ChatService, ChatStore, echo_replier_factory, make_server  # noqa: E402

MODELS = ["bedrock/example-model", "openai/example-model"]


@pytest.fixture
def base_url(tmp_path):
    service = ChatService(ChatStore(tmp_path / "chats.json"), echo_replier_factory, models=MODELS)
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
    assert chat["model"] is None
    assert chat["effort"] == "auto"

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


def test_config_lists_models_and_efforts(base_url):
    status, config = request(base_url, "GET", "/api/config")
    assert status == 200
    assert config["models"] == MODELS
    assert config["efforts"][0] == "auto"
    assert "max" in config["efforts"]


def test_model_and_effort_are_saved_per_chat(base_url):
    _, chat = request(base_url, "POST", "/api/chats")
    status, updated = request(base_url, "PATCH", f"/api/chats/{chat['id']}", {"model": MODELS[1], "effort": "high"})
    assert status == 200
    assert (updated["model"], updated["effort"]) == (MODELS[1], "high")

    # An empty model choice goes back to the harness default.
    _, updated = request(base_url, "PATCH", f"/api/chats/{chat['id']}", {"model": ""})
    assert updated["model"] is None


def test_unknown_model_and_effort_are_rejected(base_url):
    _, chat = request(base_url, "POST", "/api/chats")
    status, error = request(base_url, "PATCH", f"/api/chats/{chat['id']}", {"model": "nowhere/none"})
    assert status == 400
    assert "unknown model" in error["error"]

    status, error = request(base_url, "PATCH", f"/api/chats/{chat['id']}", {"effort": "ludicrous"})
    assert status == 400
    assert "effort must be one of" in error["error"]


def test_settings_reach_the_agent_and_a_change_rebuilds_it(tmp_path):
    built = []

    def recording(chat_id, model, effort):
        built.append((model, effort))
        return lambda prompt: f"{model}/{effort}"

    service = ChatService(ChatStore(tmp_path / "chats.json"), recording, models=MODELS)
    chat = service.store.create()
    assert service.send(chat["id"], "one")["content"] == "None/auto"
    assert service.send(chat["id"], "two")["content"] == "None/auto"  # same settings reuse the agent

    service.update_chat(chat["id"], {"model": MODELS[0], "effort": "low"})
    assert service.send(chat["id"], "three")["content"] == f"{MODELS[0]}/low"
    assert built == [(None, "auto"), (MODELS[0], "low")]


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
    def broken(chat_id, model, effort):
        def reply(prompt):
            raise RuntimeError("model unavailable")

        return reply

    service = ChatService(ChatStore(tmp_path / "chats.json"), broken, models=[])
    chat = service.store.create()
    message = service.send(chat["id"], "hi")
    assert message["role"] == "error"
    assert message["content"] == "RuntimeError: model unavailable"
    assert [m["role"] for m in service.store.get(chat["id"])["messages"]] == ["user", "error"]


def test_chats_survive_a_restart(tmp_path):
    path = tmp_path / "chats.json"
    chat = ChatService(ChatStore(path), echo_replier_factory, models=[])
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


def test_root_explains_a_missing_frontend_build(tmp_path, monkeypatch):
    import server

    monkeypatch.setattr(server, "STATIC_DIR", tmp_path)  # an empty directory: nothing built yet
    service = ChatService(ChatStore(tmp_path / "chats.json"), echo_replier_factory, models=[])
    httpd = make_server("127.0.0.1", 0, service)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        status, error = request(f"127.0.0.1:{httpd.server_port}", "GET", "/")
    finally:
        httpd.shutdown()
        httpd.server_close()
    assert status == 503
    assert "npm run build" in error["error"]
