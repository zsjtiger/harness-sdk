import { useEffect, useRef, useState } from "react";
import { type Chat, type ChatSummary, type Config, type Message, api } from "./api";
import { Composer } from "./components/Composer";
import { MessageList } from "./components/MessageList";
import { Sidebar } from "./components/Sidebar";
import { type Attachment, type CommandId, MAX_ATTACHMENT_CHARS, attachedChars, buildContent } from "./composer";

export interface Settings {
  model: string | null;
  effort: string;
}

const DEFAULT_TITLE = "New chat";
const EMPTY_CONFIG: Config = { models: [], efforts: [], default_effort: "auto", user: { name: "" } };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function App() {
  const [config, setConfig] = useState<Config>(EMPTY_CONFIG);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [current, setCurrent] = useState<Chat | null>(null);
  const [settings, setSettings] = useState<Settings>({ model: null, effort: "auto" }); // shown in the pickers
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  async function refreshChats() {
    setChats(await api.listChats());
  }

  // Runs an action from an event handler and shows its error in the status line.
  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      setStatus(messageOf(error));
    }
  }

  useEffect(() => {
    void run(async () => {
      const loaded = await api.config();
      setConfig(loaded);
      setSettings({ model: null, effort: loaded.default_effort });
      await refreshChats();
    });
    // Runs once on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openChat(id: string) {
    if (pending) return;
    await run(async () => {
      const chat = await api.getChat(id);
      setCurrent(chat);
      setSettings({ model: chat.model, effort: chat.effort });
      setSidebarOpen(false);
    });
  }

  // A new chat takes the settings the pickers show, so choosing a model first and then starting a chat works.
  async function newChat(): Promise<Chat> {
    let chat = await api.createChat();
    if (settings.model !== null || settings.effort !== config.default_effort) {
      chat = await api.updateChat(chat.id, { model: settings.model ?? "", effort: settings.effort });
    }
    setCurrent(chat);
    setSidebarOpen(false);
    await refreshChats();
    return chat;
  }

  async function sendMessage() {
    const text = draft.trim();
    if ((!text && attachments.length === 0) || pending) return;
    const content = buildContent(text, attachments);
    setDraft("");
    setAttachments([]);
    setStatus("");
    setPending(true);
    try {
      const chat = current ?? (await newChat());
      const userMessage: Message = { role: "user", content, created_at: Date.now() / 1000 };
      setCurrent((open) => (open?.id === chat.id ? { ...open, messages: [...open.messages, userMessage] } : open));
      const reply = await api.sendMessage(chat.id, content);
      setCurrent((open) => (open?.id === chat.id ? { ...open, messages: [...open.messages, reply] } : open));
    } catch (error) {
      setStatus(messageOf(error));
    } finally {
      setPending(false);
      await run(refreshChats);
    }
  }

  async function changeSettings(next: Settings) {
    setSettings(next);
    if (!current) return;
    const chatId = current.id;
    await run(async () => {
      const updated = await api.updateChat(chatId, { model: next.model ?? "", effort: next.effort });
      setCurrent((open) => (open?.id === chatId ? { ...open, model: updated.model, effort: updated.effort } : open));
    });
  }

  async function togglePin(chat: ChatSummary) {
    await run(async () => {
      await api.updateChat(chat.id, { pinned: !chat.pinned });
      await refreshChats();
    });
  }

  async function deleteChat(chat: ChatSummary) {
    if (pending || !window.confirm(`Delete "${chat.title}"?`)) return;
    await run(async () => {
      await api.deleteChat(chat.id);
      setCurrent((open) => (open?.id === chat.id ? null : open));
      await refreshChats();
    });
  }

  // Each file is checked against the running total, so a batch cannot exceed the limit.
  async function attachFiles(files: File[]) {
    const added: Attachment[] = [];
    let total = attachedChars(attachments);
    for (const file of files) {
      const text = await file.text();
      if (text.includes("\u0000")) {
        setStatus(`${file.name} is not a text file`);
      } else if (total + text.length > MAX_ATTACHMENT_CHARS) {
        setStatus(`${file.name} does not fit: attachments are limited to ${MAX_ATTACHMENT_CHARS / 1000} KB in total`);
      } else {
        total += text.length;
        added.push({ name: file.name, text });
      }
    }
    if (added.length > 0) setAttachments((list) => [...list, ...added]);
  }

  async function runCommand(id: CommandId) {
    setDraft("");
    if (id === "search") {
      setSidebarOpen(true);
      searchRef.current?.focus();
      return;
    }
    if (id === "new") {
      if (!pending) await run(async () => void (await newChat()));
      return;
    }
    const chat = chats.find((candidate) => candidate.id === current?.id);
    if (!chat) {
      setStatus("Open a chat first");
      return;
    }
    if (id === "pin") await togglePin(chat);
    else await deleteChat(chat);
  }

  const title = chats.find((chat) => chat.id === current?.id)?.title ?? current?.title ?? DEFAULT_TITLE;

  return (
    <div className="app">
      <Sidebar
        open={sidebarOpen}
        chats={chats}
        currentId={current?.id ?? null}
        query={query}
        collapsed={collapsed}
        searchRef={searchRef}
        userName={config.user.name}
        onClose={() => setSidebarOpen(false)}
        onNew={() => void runCommand("new")}
        onSearch={() => void runCommand("search")}
        onQuery={setQuery}
        onToggleSection={(label) => setCollapsed((state) => ({ ...state, [label]: !state[label] }))}
        onOpen={(id) => void openChat(id)}
        onTogglePin={(chat) => void togglePin(chat)}
        onDelete={(chat) => void deleteChat(chat)}
      />
      <main className="main">
        <header className="topbar">
          <button className="icon-btn" id="open-sidebar" aria-label="Open sidebar" onClick={() => setSidebarOpen(true)}>
            ☰
          </button>
          <h1 className="title" id="title">
            {title}
          </h1>
        </header>
        <MessageList messages={current?.messages ?? []} pending={pending} />
        <Composer
          draft={draft}
          setDraft={setDraft}
          attachments={attachments}
          pending={pending}
          status={status}
          config={config}
          settings={settings}
          onFiles={(files) => void attachFiles(files)}
          onRemoveAttachment={(index) => setAttachments((list) => list.filter((_, position) => position !== index))}
          onSend={() => void sendMessage()}
          onCommand={(id) => void runCommand(id)}
          onSettings={(next) => void changeSettings(next)}
          onError={setStatus}
        />
      </main>
    </div>
  );
}
