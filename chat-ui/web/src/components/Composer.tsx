import { type ChangeEvent, type Dispatch, type KeyboardEvent, type SetStateAction, useLayoutEffect, useRef, useState } from "react";
import type { Config } from "../api";
import { type Attachment, type CommandId, matchingCommands } from "../composer";
import type { Settings } from "../App";
import { useVoice } from "../hooks/useVoice";

const EFFORT_LABELS: Record<string, string> = { auto: "Auto", xhigh: "XHigh" };

function effortLabel(effort: string): string {
  return EFFORT_LABELS[effort] ?? effort[0].toUpperCase() + effort.slice(1);
}

interface ComposerProps {
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  attachments: Attachment[];
  pending: boolean;
  status: string;
  config: Config;
  settings: Settings;
  onFiles(files: File[]): void;
  onRemoveAttachment(index: number): void;
  onSend(): void;
  onCommand(id: CommandId): void;
  onSettings(next: Settings): void;
  onError(message: string): void;
}

export function Composer(props: ComposerProps) {
  const { draft, setDraft, attachments, pending, status, config, settings } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const commands = matchingCommands(draft);
  const menuOpen = !dismissed && commands.length > 0;
  const selected = commands[Math.min(highlight, commands.length - 1)];

  const voice = useVoice({
    onTranscript: (transcript) => setDraft((previous) => [previous.trim(), transcript].filter(Boolean).join(" ")),
    onError: props.onError,
  });

  // Grow the textarea with its content, up to 200px.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [draft]);

  function changeDraft(value: string) {
    setDraft(value);
    setDismissed(false);
    setHighlight(0);
  }

  function moveHighlight(step: number) {
    setHighlight((index) => (index + step + commands.length) % commands.length);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const composing = event.nativeEvent.isComposing;
    if (menuOpen && event.key === "ArrowDown") {
      event.preventDefault();
      moveHighlight(1);
    } else if (menuOpen && event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(-1);
    } else if (menuOpen && event.key === "Escape") {
      event.preventDefault();
      setDismissed(true);
    } else if (menuOpen && event.key === "Enter" && !composing) {
      event.preventDefault();
      props.onCommand(selected.id);
    } else if (event.key === "Enter" && !event.shiftKey && !composing) {
      event.preventDefault();
      props.onSend();
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ""; // so choosing the same file again still fires a change
    props.onFiles(files);
  }

  return (
    <div className="composer-wrap">
      {menuOpen && (
        <div className="slash-menu" id="slash-menu" role="listbox">
          {commands.map((command, index) => (
            <button
              key={command.id}
              type="button"
              className="slash-option"
              role="option"
              aria-selected={command === selected}
              onMouseDown={(event) => {
                event.preventDefault(); // keep focus in the composer
                props.onCommand(command.id);
              }}
            >
              <span className="slash-name">{command.name}</span>
              <span className="slash-help">{command.help}</span>
            </button>
          ))}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="attachments" id="attachments">
          {attachments.map((attachment, index) => (
            <span key={`${attachment.name}-${index}`} className="chip">
              {attachment.name}
              <button
                type="button"
                aria-label={`Remove ${attachment.name}`}
                onClick={() => props.onRemoveAttachment(index)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSend();
        }}
      >
        <button
          type="button"
          className="round-btn"
          id="attach"
          aria-label="Attach a text file"
          title="Attach a text file"
          onClick={() => fileRef.current?.click()}
        >
          +
        </button>
        <input ref={fileRef} type="file" id="file" multiple hidden onChange={onFileChange} />
        <textarea
          ref={textareaRef}
          id="input"
          rows={1}
          value={draft}
          disabled={pending}
          placeholder="Type / for commands"
          aria-label="Message"
          onChange={(event) => changeDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => setDismissed(true)}
        />
        {voice.supported && (
          <button
            type="button"
            className="round-btn"
            id="mic"
            aria-label="Voice input"
            aria-pressed={voice.listening}
            title="Voice input"
            onClick={voice.toggle}
          >
            🎙
          </button>
        )}
        <button type="submit" className="send-btn" id="send" aria-label="Send" title="Send" disabled={pending}>
          ↑
        </button>
      </form>

      <div className="toolbar">
        {pending && <span className="spinner" id="spinner" role="img" aria-label="Thinking" />}
        <span className="spacer" />
        <label className="picker">
          <span className="visually-hidden">Model</span>
          <select
            id="model"
            value={settings.model ?? ""}
            onChange={(event) => props.onSettings({ ...settings, model: event.target.value || null })}
          >
            <option value="">Default model</option>
            {config.models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </label>
        <label className="picker">
          <span className="visually-hidden">Effort</span>
          <select
            id="effort"
            value={settings.effort}
            onChange={(event) => props.onSettings({ ...settings, effort: event.target.value })}
          >
            {config.efforts.map((effort) => (
              <option key={effort} value={effort}>
                {effortLabel(effort)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="status" role="status">
        {status}
      </p>
    </div>
  );
}
