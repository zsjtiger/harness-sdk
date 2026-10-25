// Strands Chat front end: a sidebar of chats and a conversation view. All state lives on the server;
// this file only renders what the JSON API returns.

const state = {
  chats: [],
  currentId: null,
  messages: [],
  pending: false,
};

const $ = (id) => document.getElementById(id);
const el = {
  list: $("chat-list"),
  search: $("search"),
  messages: $("messages"),
  title: $("title"),
  input: $("input"),
  send: $("send"),
  composer: $("composer"),
  status: $("status"),
  sidebar: $("sidebar"),
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `request failed (${response.status})`);
  }
  return data;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

// Escapes everything first, then adds only the markup this renderer produces: fenced code, inline code, bold, paragraphs.
function renderMarkdown(text) {
  const blocks = [];
  const withoutFences = text.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  return withoutFences
    .split(/\n{2,}/)
    .map((paragraph) => {
      const placeholder = paragraph.match(/^\u0000(\d+)\u0000$/);
      if (placeholder) return blocks[Number(placeholder[1])];
      const inline = escapeHtml(paragraph)
        .replace(/`([^`\n]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");
      return `<p>${inline}</p>`;
    })
    .join("");
}

function renderChatList() {
  const query = el.search.value.trim().toLowerCase();
  const matches = state.chats.filter((chat) => chat.title.toLowerCase().includes(query));
  el.list.replaceChildren();
  const groups = [
    ["Pinned", matches.filter((chat) => chat.pinned)],
    ["Recent", matches.filter((chat) => !chat.pinned)],
  ];
  for (const [label, chats] of groups) {
    if (chats.length === 0) continue;
    const heading = document.createElement("div");
    heading.className = "section-label";
    heading.textContent = label;
    el.list.append(heading);
    for (const chat of chats) el.list.append(chatItem(chat));
  }
}

function chatItem(chat) {
  const item = document.createElement("div");
  item.className = `chat-item${chat.id === state.currentId ? " active" : ""}`;
  item.tabIndex = 0;
  item.setAttribute("role", "link");

  const name = document.createElement("span");
  name.className = "chat-name";
  name.textContent = chat.title;

  const pin = iconButton(chat.pinned ? "Unpin" : "Pin", chat.pinned ? "★" : "☆", () => togglePin(chat));
  const remove = iconButton("Delete", "🗑", () => deleteChat(chat));

  item.append(name, pin, remove);
  item.addEventListener("click", () => openChat(chat.id));
  item.addEventListener("keydown", (event) => {
    if (event.key === "Enter") openChat(chat.id);
  });
  return item;
}

function iconButton(label, glyph, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.textContent = glyph;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function renderMessages() {
  el.messages.replaceChildren();
  if (state.messages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.innerHTML = "<h2>What can I help with?</h2><p>Ask a question to start a conversation. Chats are saved on this server.</p>";
    el.messages.append(empty);
    return;
  }
  const thread = document.createElement("div");
  thread.className = "thread";
  for (const message of state.messages) thread.append(messageNode(message.role, message.content));
  if (state.pending) thread.append(messageNode("typing", "Thinking…"));
  el.messages.append(thread);
  el.messages.scrollTop = el.messages.scrollHeight;
}

function messageNode(role, content) {
  const node = document.createElement("div");
  node.className = `message ${role === "typing" ? "typing" : role}`;
  if (role === "user") {
    node.textContent = content;
  } else {
    node.innerHTML = renderMarkdown(content);
  }
  return node;
}

function setStatus(text) {
  el.status.textContent = text;
}

async function refreshChats() {
  const { chats } = await api("/api/chats");
  state.chats = chats;
  renderChatList();
}

async function openChat(id) {
  if (state.pending) return;
  const chat = await api(`/api/chats/${id}`);
  state.currentId = chat.id;
  state.messages = chat.messages;
  el.title.textContent = chat.title;
  renderMessages();
  renderChatList();
  el.sidebar.classList.remove("open");
  el.input.focus();
}

async function newChat() {
  if (state.pending) return;
  const chat = await api("/api/chats", { method: "POST" });
  state.currentId = chat.id;
  state.messages = [];
  el.title.textContent = chat.title;
  await refreshChats();
  renderMessages();
  el.sidebar.classList.remove("open");
  el.input.focus();
}

async function togglePin(chat) {
  await api(`/api/chats/${chat.id}`, { method: "PATCH", body: { pinned: !chat.pinned } });
  await refreshChats();
}

async function deleteChat(chat) {
  if (!confirm(`Delete "${chat.title}"?`)) return;
  await api(`/api/chats/${chat.id}`, { method: "DELETE" });
  if (chat.id === state.currentId) {
    state.currentId = null;
    state.messages = [];
    el.title.textContent = "New chat";
    renderMessages();
  }
  await refreshChats();
}

async function sendMessage() {
  const content = el.input.value.trim();
  if (!content || state.pending) return;
  if (state.currentId === null) await newChat();

  const chatId = state.currentId;
  state.messages.push({ role: "user", content });
  state.pending = true;
  el.input.value = "";
  autoGrow();
  setSending(true);
  renderMessages();

  try {
    const reply = await api(`/api/chats/${chatId}/messages`, { method: "POST", body: { content } });
    if (state.currentId === chatId) state.messages.push(reply);
    setStatus("");
  } catch (error) {
    setStatus(error.message);
  } finally {
    state.pending = false;
    setSending(false);
    renderMessages();
    await refreshChats();
    if (state.currentId === chatId) el.title.textContent = state.chats.find((chat) => chat.id === chatId)?.title ?? "";
    el.input.focus();
  }
}

function setSending(sending) {
  el.send.disabled = sending;
  el.input.disabled = sending;
}

function autoGrow() {
  el.input.style.height = "auto";
  el.input.style.height = `${Math.min(el.input.scrollHeight, 200)}px`;
}

el.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage();
});

el.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendMessage();
  }
});

el.input.addEventListener("input", autoGrow);
el.search.addEventListener("input", renderChatList);
$("new-chat").addEventListener("click", newChat);
$("open-sidebar").addEventListener("click", () => el.sidebar.classList.add("open"));
$("close-sidebar").addEventListener("click", () => el.sidebar.classList.remove("open"));

refreshChats().catch((error) => setStatus(error.message));
