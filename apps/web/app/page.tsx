"use client";

import { ChatShell } from "./components/chat-shell";

export default function HomePage() {
  return (
    <main className="h-screen w-screen overflow-hidden">
      <ChatShell />
    </main>
  );
}
