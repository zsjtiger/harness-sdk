import { useEffect, useRef } from "react";
import type { Message } from "../api";
import { Markdown } from "../markdown";

interface MessageListProps {
  messages: Message[];
  pending: boolean;
}

export function MessageList({ messages, pending }: MessageListProps) {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (section) section.scrollTop = section.scrollHeight;
  }, [messages.length, pending]);

  return (
    <section className="messages" id="messages" aria-live="polite" ref={sectionRef}>
      {messages.length === 0 && !pending ? (
        <div className="empty">
          <h2>What can I help with?</h2>
          <p>Ask a question to start a conversation. Chats are saved on this server.</p>
        </div>
      ) : (
        <div className="thread">
          {messages.map((message, index) => (
            <div key={index} className={`message ${message.role}`}>
              {message.role === "user" ? message.content : <Markdown text={message.content} />}
            </div>
          ))}
          {pending && <div className="message typing">Thinking…</div>}
        </div>
      )}
    </section>
  );
}
