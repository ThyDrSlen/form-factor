'use client';

import { useState, useRef, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { AppError } from '@form-factor/shared/services/error-handler';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  id: string;
}

export default function CoachPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    setInput('');
    setError(null);

    const userMsg: Message = {
      role: 'user',
      content: trimmed,
      id: `user-${Date.now()}`,
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const supabase = createClient();

      const chatHistory = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const { data, error: fnError } = await supabase.functions.invoke('coach', {
        body: { messages: chatHistory },
      });

      if (fnError) throw fnError;

      const responseText =
        data?.message?.trim() ||
        data?.content?.trim() ||
        data?.reply?.trim() ||
        'No response from coach.';

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: responseText, id: `assistant-${Date.now()}` },
      ]);
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'message' in err
        ? (err as AppError).message
        : 'Failed to reach coach. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">AI Coach</h1>
        <p className="text-text-secondary text-sm mt-1">
          Ask about form, recovery, programming, or nutrition
        </p>
      </div>

      {/* Chat Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 mb-4 pr-1">
        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center h-full">
            <div className="text-center">
              <div className="h-16 w-16 rounded-2xl bg-accent/10 flex items-center justify-center text-accent text-3xl mx-auto mb-4">
                ?
              </div>
              <p className="text-text-secondary text-sm max-w-sm">
                Ask the coach about your training — form tips, recovery advice, programming suggestions, or nutrition questions.
              </p>
              <div className="flex flex-wrap justify-center gap-2 mt-4">
                {[
                  'How should I warm up for squats?',
                  'My sleep was bad — adjust today?',
                  'Rate my pull-up form cues',
                ].map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => setInput(prompt)}
                    className="text-xs bg-card border border-line rounded-lg px-3 py-1.5 text-text-secondary hover:text-text-primary hover:border-accent/30 transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`max-w-[80%] ${
              msg.role === 'user' ? 'ml-auto' : 'mr-auto'
            }`}
          >
            <div
              className={`rounded-2xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-accent text-white'
                  : 'bg-card border border-line text-text-primary'
              }`}
            >
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
            </div>
            <span className="text-[11px] text-text-muted mt-1 block px-1">
              {msg.role === 'user' ? 'You' : 'Coach'}
            </span>
          </div>
        ))}

        {loading && (
          <div className="mr-auto max-w-[80%]">
            <div className="bg-card border border-line rounded-2xl px-4 py-3">
              <div className="flex gap-1.5">
                <span className="h-2 w-2 rounded-full bg-text-muted animate-bounce" />
                <span className="h-2 w-2 rounded-full bg-text-muted animate-bounce [animation-delay:0.15s]" />
                <span className="h-2 w-2 rounded-full bg-text-muted animate-bounce [animation-delay:0.3s]" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5 text-red-400 text-sm mb-3">
          {error}
        </div>
      )}

      {/* Input */}
      <form onSubmit={sendMessage} className="flex gap-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the coach..."
          className="flex-1 bg-card border border-line rounded-xl px-4 py-3 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="bg-accent text-white font-bold px-5 py-3 rounded-xl hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  );
}
