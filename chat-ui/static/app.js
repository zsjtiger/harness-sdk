// Strands Chat front end: a sidebar of chats, a conversation view, and a composer. All state lives on the
// server; this file only renders what the JSON API returns and sends what the user chooses.

const MAX_ATTACHMENT_BYTES = 200_000; // all attached files together, so one message stays well under the server limit
const CHAT_ICON =
  '<svg class="chat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
  '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';

const state = {
  chats: [],
  currentId: null,
  messages: [],
  pending: false,
  attachments: [],
  config: { models: [], efforts: [], default_effort: "auto" },
  settings: { model: null, effort: "auto" }, // what the pickers show; applied to the open chat, or to the next one
  collapsed: { Pinned: false, Recent: false },
  slashItems: [],
  slashIndex: 0,
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
  attach: $("attach"),
  file: $("file"),
  attachments: $("attachments"),
  mic: $("mic"),
  model: $("model"),
  effort: $("effort"),
  spinner: $("spinner"),
  slashMenu: $("slash-menu"),
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

// ---- Sidebar -------------------------------------------------------------------------------------------------

function renderChatList() {
  const query = el.search.value.trim().toLowerCase();
  const matches = state.chats.filter((chat) => chat.title.toLowerCase().includes(query));
  el.list.replaceChildren();
  for (const [label, chats] of [
    ["Pinned", matches.filter((chat) => chat.pinned)],
    ["Recent", matches.filter((chat) => !chat.pinned)],
  ]) {
    if (chats.length > 0) el.list.append(section(label, chats));
  }
}

function section(label, chats) {
  const wrapper = document.createElement("div");
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "section-toggle";
  toggle.setAttribute("aria-expanded", String(!state.collapsed[label]));
  toggle.innerHTML = `<span class="chevron">▾</span>${label}`;
  toggle.addEventListener("click", () => {
    state.collapsed[label] = !state.collapsed[label];
    renderChatList();
  });

  const items = document.createElement("div");
  items.className = "section-items";
  items.hidden = state.collapsed[label];
  for (const chat of chats) items.append(chatItem(chat));

  wrapper.append(toggle, items);
  return wrapper;
}

function chatItem(chat) {
  const item = document.createElement("div");
  item.className = `chat-item${chat.id === state.currentId ? " active" : ""}`;
  item.tabIndex = 0;
  item.setAttribute("role", "link");
  item.innerHTML = CHAT_ICON;

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

async function refreshChats() {
  const { chats } = await api("/api/chats");
  state.chats = chats;
  renderChatList();
}

function openSidebar() {
  el.sidebar.classList.add("open");
}

function closeSidebar() {
  el.sidebar.classList.remove("open");
}

// ---- Conversation --------------------------------------------------------------------------------------------

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
  el.messages.append(thread);
  el.messages.scrollTop = el.messages.scrollHeight;
}

function messageNode(role, content) {
  const node = document.createElement("div");
  node.className = `message ${role}`;
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

async function openChat(id) {
  if (state.pending) return;
  const chat = await api(`/api/chats/${id}`);
  state.currentId = chat.id;
  state.messages = chat.messages;
  state.settings = { model: chat.model, effort: chat.effort };
  el.title.textContent = chat.title;
  setPickers(state.settings);
  renderMessages();
  renderChatList();
  closeSidebar();
  el.input.focus();
}

async function newChat() {
  if (state.pending) return;
  let chat = await api("/api/chats", { method: "POST" });
  if (state.settings.model !== null || state.settings.effort !== state.config.default_effort) {
    chat = await api(`/api/chats/${chat.id}`, {
      method: "PATCH",
      body: { model: state.settings.model ?? "", effort: state.settings.effort },
    });
  }
  state.currentId = chat.id;
  state.messages = [];
  el.title.textContent = chat.title;
  await refreshChats();
  renderMessages();
  closeSidebar();
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

// ---- Composer: sending, pickers, attachments, voice ----------------------------------------------------------

async function sendMessage() {
  const text = el.input.value.trim();
  if ((!text && state.attachments.length === 0) || state.pending) return;
  try {
    if (state.currentId === null) await newChat();
    const chatId = state.currentId;
    const content = buildContent(text);

    state.messages.push({ role: "user", content });
    state.pending = true;
    el.input.value = "";
    state.attachments = [];
    renderAttachments();
    autoGrow();
    setSending(true);
    renderMessages();
    setStatus("");

    try {
      const reply = await api(`/api/chats/${chatId}/messages`, { method: "POST", body: { content } });
      if (state.currentId === chatId) state.messages.push(reply);
    } finally {
      state.pending = false;
      setSending(false);
      renderMessages();
      await refreshChats();
      if (state.currentId === chatId) el.title.textContent = state.chats.find((chat) => chat.id === chatId)?.title ?? "";
    }
  } catch (error) {
    setStatus(error.message);
  } finally {
    el.input.focus();
  }
}

function setSending(sending) {
  el.send.disabled = sending;
  el.input.disabled = sending;
  el.spinner.hidden = !sending;
}

function autoGrow() {
  el.input.style.height = "auto";
  el.input.style.height = `${Math.min(el.input.scrollHeight, 200)}px`;
}

const EFFORT_LABELS = { auto: "Auto", xhigh: "XHigh" };

function fillPickers() {
  const option = (value, label) => new Option(label, value);
  el.model.replaceChildren(
    option("", "Default model"),
    ...state.config.models.map((model) => option(model, model))
  );
  el.effort.replaceChildren(
    ...state.config.efforts.map((effort) => option(effort, EFFORT_LABELS[effort] ?? effort[0].toUpperCase() + effort.slice(1)))
  );
}

function setPickers(settings) {
  el.model.value = settings.model ?? "";
  el.effort.value = settings.effort;
}

// Picker changes apply to the open chat right away, or to the next chat that is created.
async function onPickerChange() {
  state.settings = { model: el.model.value || null, effort: el.effort.value };
  if (state.currentId === null) return;
  try {
    await api(`/api/chats/${state.currentId}`, {
      method: "PATCH",
      body: { model: el.model.value, effort: el.effort.value },
    });
    setStatus("");
  } catch (error) {
    setStatus(error.message);
  }
}

// Each attachment is sent inline as a fenced block, so its text reaches the model as part of the message.
function buildContent(text) {
  const parts = state.attachments.map(
    (attachment) => `Attached file: ${attachment.name}\n${fenceFor(attachment.text)}\n${attachment.text}\n${fenceFor(attachment.text)}`
  );
  if (text) parts.push(text);
  return parts.join("\n\n");
}

function fenceFor(text) {
  const longestRun = Math.max(0, ...(text.match(/`+/g) || []).map((run) => run.length));
  return "`".repeat(Math.max(3, longestRun + 1));
}

async function addAttachment(file) {
  const total = state.attachments.reduce((sum, attachment) => sum + attachment.text.length, 0) + file.size;
  if (total > MAX_ATTACHMENT_BYTES) {
    setStatus(`${file.name} does not fit: attachments are limited to ${MAX_ATTACHMENT_BYTES / 1000} KB in total`);
    return;
  }
  const text = await file.text();
  if (text.includes("\u0000")) {
    setStatus(`${file.name} is not a text file`);
    return;
  }
  state.attachments.push({ name: file.name, text });
  renderAttachments();
}

function renderAttachments() {
  el.attachments.replaceChildren(...state.attachments.map((attachment, index) => attachmentChip(attachment, index)));
}

function attachmentChip(attachment, index) {
  const chip = document.createElement("span");
  chip.className = "chip";
  chip.textContent = attachment.name;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "×";
  remove.setAttribute("aria-label", `Remove ${attachment.name}`);
  remove.addEventListener("click", () => {
    state.attachments.splice(index, 1);
    renderAttachments();
  });
  chip.append(remove);
  return chip;
}

// Slash commands: typing "/" at the start of the composer lists commands; Enter runs the highlighted one.
const COMMANDS = [
  { name: "/new", help: "Start a new chat", run: () => newChat() },
  { name: "/search", help: "Search your chats", run: () => focusSearch() },
  { name: "/pin", help: "Pin or unpin the current chat", run: () => withCurrentChat(togglePin) },
  { name: "/delete", help: "Delete the current chat", run: () => withCurrentChat(deleteChat) },
];

function withCurrentChat(action) {
  const chat = state.chats.find((candidate) => candidate.id === state.currentId);
  if (!chat) {
    setStatus("Open a chat first");
    return;
  }
  return action(chat);
}

function focusSearch() {
  openSidebar();
  el.search.focus();
}

function updateSlashMenu() {
  const value = el.input.value;
  const commandPrefix = value.startsWith("/") && !/\s/.test(value);
  state.slashItems = commandPrefix ? COMMANDS.filter((command) => command.name.startsWith(value.toLowerCase())) : [];
  state.slashIndex = Math.min(state.slashIndex, Math.max(0, state.slashItems.length - 1));
  renderSlashMenu();
}

function renderSlashMenu() {
  el.slashMenu.replaceChildren();
  el.slashMenu.hidden = state.slashItems.length === 0;
  state.slashItems.forEach((command, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "slash-option";
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(index === state.slashIndex));
    option.innerHTML = `<span class="slash-name"></span><span class="slash-help"></span>`;
    option.querySelector(".slash-name").textContent = command.name;
    option.querySelector(".slash-help").textContent = command.help;
    option.addEventListener("mousedown", (event) => {
      event.preventDefault(); // keep focus in the composer
      runCommand(command);
    });
    el.slashMenu.append(option);
  });
}

async function runCommand(command) {
  el.input.value = "";
  autoGrow();
  updateSlashMenu();
  try {
    await command.run();
  } catch (error) {
    setStatus(error.message);
  }
}

// Voice input uses the browser's speech recognition; the button is hidden where it is unavailable.
function setupVoice() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return;
  el.mic.hidden = false;
  const recognition = new Recognition();
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = false;
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    el.input.value = [el.input.value.trim(), transcript].filter(Boolean).join(" ");
    autoGrow();
    updateSlashMenu();
  };
  recognition.onend = () => el.mic.setAttribute("aria-pressed", "false");
  recognition.onerror = (event) => setStatus(`Voice input failed: ${event.error}`);
  el.mic.addEventListener("click", () => {
    if (el.mic.getAttribute("aria-pressed") === "true") {
      recognition.stop();
      return;
    }
    el.mic.setAttribute("aria-pressed", "true");
    recognition.start();
  });
}

// ---- Wiring --------------------------------------------------------------------------------------------------

el.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage();
});

el.input.addEventListener("keydown", (event) => {
  const menuOpen = state.slashItems.length > 0;
  if (menuOpen && event.key === "ArrowDown") {
    event.preventDefault();
    state.slashIndex = (state.slashIndex + 1) % state.slashItems.length;
    renderSlashMenu();
  } else if (menuOpen && event.key === "ArrowUp") {
    event.preventDefault();
    state.slashIndex = (state.slashIndex - 1 + state.slashItems.length) % state.slashItems.length;
    renderSlashMenu();
  } else if (menuOpen && event.key === "Escape") {
    event.preventDefault();
    state.slashItems = [];
    renderSlashMenu();
  } else if (menuOpen && event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    runCommand(state.slashItems[state.slashIndex]);
  } else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendMessage();
  }
});

el.input.addEventListener("input", () => {
  autoGrow();
  updateSlashMenu();
});
el.input.addEventListener("blur", () => {
  state.slashItems = [];
  renderSlashMenu();
});

el.attach.addEventListener("click", () => el.file.click());
el.file.addEventListener("change", async () => {
  for (const file of el.file.files) await addAttachment(file);
  el.file.value = "";
});

el.model.addEventListener("change", onPickerChange);
el.effort.addEventListener("change", onPickerChange);

el.search.addEventListener("input", renderChatList);
$("new-chat").addEventListener("click", () => newChat().catch((error) => setStatus(error.message)));
$("focus-search").addEventListener("click", focusSearch);
$("open-sidebar").addEventListener("click", openSidebar);
$("close-sidebar").addEventListener("click", closeSidebar);

setupVoice();

async function init() {
  state.config = await api("/api/config");
  state.settings = { model: null, effort: state.config.default_effort };
  fillPickers();
  setPickers(state.settings);
  await refreshChats();
}

init().catch((error) => setStatus(error.message));
