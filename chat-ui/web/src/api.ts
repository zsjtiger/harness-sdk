export type Role = "user" | "assistant" | "error";

export interface Message {
  role: Role;
  content: string;
  created_at: number;
}

export interface ChatSummary {
  id: string;
  title: string;
  pinned: boolean;
  created_at: number;
  updated_at: number;
}

export interface Chat extends ChatSummary {
  model: string | null;
  effort: string;
  messages: Message[];
}

export interface Config {
  models: string[];
  efforts: string[];
  default_effort: string;
  user: { name: string };
}

export interface ChatChanges {
  title?: string;
  pinned?: boolean;
  model?: string; // an empty string means the harness default model
  effort?: string;
}

export class ApiError extends Error {}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(data.error ?? `request failed (${response.status})`);
  }
  return data as T;
}

export const api = {
  config: () => request<Config>("/api/config"),
  listChats: async () => (await request<{ chats: ChatSummary[] }>("/api/chats")).chats,
  createChat: () => request<Chat>("/api/chats", "POST"),
  getChat: (id: string) => request<Chat>(`/api/chats/${id}`),
  updateChat: (id: string, changes: ChatChanges) => request<Chat>(`/api/chats/${id}`, "PATCH", changes),
  deleteChat: (id: string) => request<{ deleted: string }>(`/api/chats/${id}`, "DELETE"),
  sendMessage: (id: string, content: string) => request<Message>(`/api/chats/${id}/messages`, "POST", { content }),
};
