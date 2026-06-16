// Chat history storage — localStorage only
// Each chat is a conversation thread with a list of messages

export interface Citation {
  name: string;
  trust: string;
  citation: string;
}

export type ChartSpec = unknown; // Flexible chart spec from API response

export interface Message {
  id: string;
  role: "user" | "agent";
  content: string | unknown;
  timestamp: string; // ISO timestamp
  // Agent messages only:
  citations?: Citation[];
  chart?: ChartSpec | null;
  steps?: string[];
}

export interface Chat {
  id: string;
  title: string; // First question, truncated
  createdAt: string; // ISO timestamp
  updatedAt: string;
  messages: Message[];
  conversationId: string | null; // Genie thread ID for continuing conversations
}

const STORAGE_KEY = "meddesert_chats";
const CURRENT_CHAT_KEY = "meddesert_current_chat_id";

function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

function truncateTitle(text: string, maxLength: number = 50): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + "…";
}

export function getAllChats(): Chat[] {
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function getChat(chatId: string): Chat | null {
  if (typeof window === "undefined") return null;
  const chats = getAllChats();
  return chats.find((c) => c.id === chatId) ?? null;
}

export function getCurrentChatId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(CURRENT_CHAT_KEY);
  } catch {
    return null;
  }
}

export function setCurrentChatId(chatId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (chatId === null) {
      localStorage.removeItem(CURRENT_CHAT_KEY);
    } else {
      localStorage.setItem(CURRENT_CHAT_KEY, chatId);
    }
  } catch {
    // Silently fail
  }
}

export function createChat(): Chat {
  const now = new Date().toISOString();
  const chat: Chat = {
    id: generateId(),
    title: "New conversation",
    createdAt: now,
    updatedAt: now,
    messages: [],
    conversationId: null,
  };
  return chat;
}

export function saveChat(chat: Chat): void {
  if (typeof window === "undefined") return;
  try {
    const chats = getAllChats();
    const index = chats.findIndex((c) => c.id === chat.id);
    if (index >= 0) {
      chats[index] = chat;
    } else {
      chats.unshift(chat); // New chat at the top
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
  } catch {
    // Silently fail
  }
}

export function deleteChat(chatId: string): void {
  if (typeof window === "undefined") return;
  try {
    const chats = getAllChats();
    const filtered = chats.filter((c) => c.id !== chatId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    if (getCurrentChatId() === chatId) {
      setCurrentChatId(null);
    }
  } catch {
    // Silently fail
  }
}

export function addMessageToChat(chatId: string, message: Message): void {
  if (typeof window === "undefined") return;
  const chat = getChat(chatId);
  if (!chat) return;
  chat.messages.push(message);
  chat.updatedAt = new Date().toISOString();

  // Update title from first message if still "New conversation"
  if (chat.title === "New conversation" && chat.messages.length > 0) {
    const firstUserMsg = chat.messages.find((m) => m.role === "user");
    if (firstUserMsg && typeof firstUserMsg.content === "string") {
      chat.title = truncateTitle(firstUserMsg.content);
    }
  }

  saveChat(chat);
}

export function setConversationId(chatId: string, conversationId: string | null): void {
  if (typeof window === "undefined") return;
  const chat = getChat(chatId);
  if (!chat) return;
  chat.conversationId = conversationId;
  saveChat(chat);
}
