'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Sparkles, ChevronDown, ChevronRight, User, Bot, Loader2 } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  toolCalls?: { name: string; input: unknown; result: unknown }[];
}

const QUICK_COMMANDS = [
  'Quantos restaurantes temos no banco?',
  'Liste as 10 tabelas com mais registros',
  'Mostre restaurantes sem telefone',
  'Adicione os 20 melhores de Paris',
  'Qual a completude média dos dados?',
];

function ToolCallBlock({ name, input, result }: { name: string; input: unknown; result: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 rounded-lg border border-gold/15 bg-gold/5 text-xs overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-2 text-gold/70 hover:text-gold transition-colors">
        <span className="w-1.5 h-1.5 rounded-full bg-gold/60" />
        <span className="font-mono">{name}</span>
        {open ? <ChevronDown className="w-3 h-3 ml-auto" /> : <ChevronRight className="w-3 h-3 ml-auto" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="px-3 pb-3 space-y-2 border-t border-gold/10">
              <div>
                <p className="text-white/30 uppercase tracking-widest text-[10px] mt-2 mb-1">Input</p>
                <pre className="text-white/50 font-mono bg-black/30 rounded p-2 overflow-x-auto text-[10px] max-h-32">
                  {JSON.stringify(input, null, 2)}
                </pre>
              </div>
              <div>
                <p className="text-white/30 uppercase tracking-widest text-[10px] mb-1">Output</p>
                <pre className="text-emerald-400/60 font-mono bg-black/30 rounded p-2 overflow-x-auto text-[10px] max-h-48">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  const toolCallPattern = /⚙️ \*\*Executando: ([^*]+)\*\*/g;
  const cleanContent = msg.content.replace(toolCallPattern, '').trim();

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center ${
        isUser ? 'bg-white/10' : 'bg-gradient-to-br from-gold/30 to-amber-700/30 border border-gold/20'
      }`}>
        {isUser ? <User className="w-4 h-4 text-white/60" /> : <Bot className="w-4 h-4 text-gold/70" />}
      </div>

      <div className={`max-w-[80%] space-y-1 ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        {cleanContent && (
          <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser ? 'bg-white/10 text-white rounded-tr-none' : 'bg-white/[0.04] border border-white/5 text-white/80 rounded-tl-none'
          }`}>
            <div className="whitespace-pre-wrap">{cleanContent}</div>
          </div>
        )}

        {msg.toolCalls?.map((tc, i) => (
          <ToolCallBlock key={i} name={tc.name} input={tc.input} result={tc.result} />
        ))}

        <span className="text-[10px] text-white/20 px-1">
          {new Date(msg.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </motion.div>
  );
}

export default function AgentChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Olá! Sou o **TWK Database Architect**. Tenho acesso completo ao banco de dados PostgreSQL e posso executar queries, importar restaurantes, enriquecer dados e muito mais. Como posso ajudar?',
      timestamp: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const sendMessage = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;

    setInput('');
    const userMsg: Message = { role: 'user', content, timestamp: new Date().toISOString() };
    setMessages((m) => [...m, userMsg]);
    setLoading(true);

    const allMessages = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: allMessages }),
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';
      const assistantMsg: Message = { role: 'assistant', content: '', timestamp: new Date().toISOString(), toolCalls: [] };
      setMessages((m) => [...m, assistantMsg]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') continue;
          try {
            const { text, error } = JSON.parse(payload);
            if (error) throw new Error(error);
            if (text) {
              assistantText += text;
              setMessages((m) => m.map((msg, idx) =>
                idx === m.length - 1 ? { ...msg, content: assistantText } : msg
              ));
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: `Erro: ${String(err)}`, timestamp: new Date().toISOString() }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}
        </AnimatePresence>

        {loading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3 items-center">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gold/30 to-amber-700/30 border border-gold/20 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-gold/70" />
            </div>
            <div className="flex gap-1.5 bg-white/[0.04] border border-white/5 rounded-2xl rounded-tl-none px-4 py-3">
              {[0, 1, 2].map((i) => (
                <motion.div key={i} className="w-1.5 h-1.5 rounded-full bg-gold/50"
                  animate={{ y: [0, -4, 0] }}
                  transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.15 }} />
              ))}
            </div>
          </motion.div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick commands */}
      <div className="px-4 py-2 flex gap-2 overflow-x-auto no-scrollbar">
        {QUICK_COMMANDS.map((cmd) => (
          <button key={cmd} onClick={() => sendMessage(cmd)}
            className="flex-shrink-0 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-full px-3 py-1.5 text-white/50 hover:text-white/80 transition-colors">
            {cmd}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-white/5">
        <div className="flex gap-3 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Pergunte ao agente… (Enter para enviar, Shift+Enter para nova linha)"
            rows={1}
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-gold/30 placeholder:text-white/20 resize-none transition-colors max-h-32 overflow-y-auto"
            style={{ minHeight: '48px' }}
          />
          <button onClick={() => sendMessage()} disabled={loading || !input.trim()}
            className="p-3 bg-gold/20 hover:bg-gold/30 border border-gold/30 rounded-xl text-gold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
