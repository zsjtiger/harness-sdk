import type { RefObject } from "react";
import type { ChatSummary } from "../api";

interface SidebarProps {
  open: boolean;
  chats: ChatSummary[];
  currentId: string | null;
  query: string;
  collapsed: Record<string, boolean>;
  searchRef: RefObject<HTMLInputElement | null>;
  onClose(): void;
  onNew(): void;
  onSearch(): void;
  onQuery(query: string): void;
  onToggleSection(label: string): void;
  onOpen(id: string): void;
  onTogglePin(chat: ChatSummary): void;
  onDelete(chat: ChatSummary): void;
}

export function Sidebar(props: SidebarProps) {
  const { open, chats, currentId, query, collapsed, searchRef } = props;
  const needle = query.trim().toLowerCase();
  const matches = chats.filter((chat) => chat.title.toLowerCase().includes(needle));
  const groups = [
    { label: "Pinned", chats: matches.filter((chat) => chat.pinned) },
    { label: "Recent", chats: matches.filter((chat) => !chat.pinned) },
  ].filter((group) => group.chats.length > 0);

  return (
    <aside className={`sidebar${open ? " open" : ""}`} id="sidebar">
      <div className="sidebar-top">
        <span className="brand">Strands Chat</span>
        <button className="icon-btn" id="close-sidebar" aria-label="Close sidebar" onClick={props.onClose}>
          ×
        </button>
      </div>
      <nav className="nav" aria-label="Main">
        <button className="nav-item" id="new-chat" onClick={props.onNew}>
          <span className="glyph">+</span>New chat
        </button>
        <button className="nav-item" id="focus-search" onClick={props.onSearch}>
          <span className="glyph">⌕</span>Search
        </button>
      </nav>
      <input
        ref={searchRef}
        className="search"
        id="search"
        type="search"
        placeholder="Search chats"
        aria-label="Search chats"
        value={query}
        onChange={(event) => props.onQuery(event.target.value)}
      />
      <div className="chat-list" id="chat-list">
        {groups.map((group) => (
          <div key={group.label}>
            <button
              type="button"
              className="section-toggle"
              aria-expanded={!collapsed[group.label]}
              onClick={() => props.onToggleSection(group.label)}
            >
              <span className="chevron">▾</span>
              {group.label}
            </button>
            <div className="section-items" hidden={collapsed[group.label]}>
              {group.chats.map((chat) => (
                <ChatItem
                  key={chat.id}
                  chat={chat}
                  active={chat.id === currentId}
                  onOpen={props.onOpen}
                  onTogglePin={props.onTogglePin}
                  onDelete={props.onDelete}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

interface ChatItemProps {
  chat: ChatSummary;
  active: boolean;
  onOpen(id: string): void;
  onTogglePin(chat: ChatSummary): void;
  onDelete(chat: ChatSummary): void;
}

function ChatItem({ chat, active, onOpen, onTogglePin, onDelete }: ChatItemProps) {
  return (
    <div
      className={`chat-item${active ? " active" : ""}`}
      role="link"
      tabIndex={0}
      onClick={() => onOpen(chat.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen(chat.id);
      }}
    >
      <svg className="chat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
      </svg>
      <span className="chat-name">{chat.title}</span>
      <button
        type="button"
        title={chat.pinned ? "Unpin" : "Pin"}
        aria-label={chat.pinned ? "Unpin" : "Pin"}
        onClick={(event) => {
          event.stopPropagation();
          onTogglePin(chat);
        }}
      >
        {chat.pinned ? "★" : "☆"}
      </button>
      <button
        type="button"
        title="Delete"
        aria-label="Delete"
        onClick={(event) => {
          event.stopPropagation();
          onDelete(chat);
        }}
      >
        🗑
      </button>
    </div>
  );
}
