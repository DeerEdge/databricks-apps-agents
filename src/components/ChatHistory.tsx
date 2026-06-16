"use client";

import { useEffect, useState } from "react";
import { getAllChats, deleteChat, getCurrentChatId, setCurrentChatId, type Chat } from "@/lib/chatStorage";

export default function ChatHistory({
  onSelectChat,
  onNewChat,
  currentChatId,
}: {
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  currentChatId: string | null;
}) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [showDelete, setShowDelete] = useState<string | null>(null);

  useEffect(() => {
    // Load chats from localStorage
    const allChats = getAllChats();
    setChats(allChats);
  }, []);

  function handleSelectChat(chatId: string) {
    setCurrentChatId(chatId);
    onSelectChat(chatId);
  }

  function handleDeleteChat(chatId: string, e: React.MouseEvent) {
    e.stopPropagation();
    deleteChat(chatId);
    setChats((prev) => prev.filter((c) => c.id !== chatId));
    setShowDelete(null);
  }

  function handleNewChat(e: React.MouseEvent) {
    e.preventDefault();
    onNewChat();
  }

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}>
      <button
        onClick={handleNewChat}
        style={{
          flex: "0 0 auto",
          padding: "10px 12px",
          marginBottom: "8px",
          fontSize: "12px",
          fontFamily: "var(--font-mono)",
          fontWeight: 500,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "#fff",
          background: "var(--accent)",
          border: "none",
          borderRadius: "6px",
          cursor: "pointer",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#cc2b1a")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "var(--accent)")}
      >
        + New Chat
      </button>

      <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
        {chats.length === 0 ? (
          <p
            style={{
              fontSize: "11px",
              color: "var(--ink-3)",
              padding: "12px",
              textAlign: "center",
              fontStyle: "italic",
            }}
          >
            No chats yet
          </p>
        ) : (
          chats.map((chat) => (
            <button
              key={chat.id}
              onClick={() => handleSelectChat(chat.id)}
              style={{
                flex: "0 0 auto",
                padding: "8px 10px",
                borderRadius: "6px",
                background: currentChatId === chat.id ? "#fff5f4" : "transparent",
                border: currentChatId === chat.id ? "1px solid #ffc9c2" : "1px solid transparent",
                cursor: "pointer",
                textAlign: "left",
                transition: "background 0.12s, border-color 0.12s",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
              }}
              onMouseEnter={(e) => {
                if (currentChatId !== chat.id) {
                  e.currentTarget.style.background = "var(--paper-sunk)";
                }
              }}
              onMouseLeave={(e) => {
                if (currentChatId !== chat.id) {
                  e.currentTarget.style.background = "transparent";
                }
              }}
            >
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: 500,
                    color: "var(--ink)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {chat.title}
                </div>
                <div
                  style={{
                    fontSize: "10px",
                    color: "var(--ink-3)",
                    marginTop: "2px",
                  }}
                >
                  {formatTime(chat.updatedAt)}
                </div>
              </div>
              {(showDelete === chat.id || currentChatId === chat.id) && (
                <button
                  onClick={(e) => handleDeleteChat(chat.id, e)}
                  style={{
                    flex: "0 0 auto",
                    background: "none",
                    border: "none",
                    color: "var(--ink-3)",
                    fontSize: "16px",
                    cursor: "pointer",
                    padding: "2px 4px",
                    transition: "color 0.15s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#9b2226")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ink-3)")}
                  title="Delete chat"
                >
                  ✕
                </button>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
