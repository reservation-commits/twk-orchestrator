'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Sparkles, ChevronDown, ChevronRight, User, Bot, Loader2, Brain, CheckCircle2, AlertCircle, Square, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const CHAT_STORAGE_KEY = 'twk_chat_history';

/* eslint-disable @typescript-eslint/no-explicit-any */
const markdownComponents = {
  p:    (props: any) => <p className="my-1 first:mt-0 last:mb-0" {...props} />,
  a:    (props: any) => <a className="text-gold underline underline-offset-2 hover:text-gold/80" target="_blank" rel="noreferrer" {...props} />,
  ul:   (props: any) => <ul className="list-disc pl-5 my-1 space-y-0.5" {...props} />,
  ol:   (props: any) => <ol className="list-decimal pl-5 my-1 space-y-0.5" {...props} />,
  pre:  (props: any) => <pre className="bg-white/5 border border-white/10 rounded-lg p-3 my-2 overflow-x-auto font-mono text-xs" {...props} />,
  code: ({ className, ...props }: any) => (
    <code className={`font-mono text-[12px] ${className ?? 'bg-white/5 rounded px-1 py-0.5'}`} {...props} />
  ),
  table: (props: any) => (
    <div className="overflow-x-auto my-2">
      <table className="w-full text-xs border-collapse" {...props} />
    </div>
  ),
  th: (props: any) => <th className="border border-white/10 bg-white/5 px-2 py-1 text-left text-gold/80 font-medium" {...props} />,
  td: (props: any) => <td className="border border-white/10 px-2 py-1" {...props} />,
  blockquote: (props: any) => <blockquote className="border-l-2 border-gold/40 pl-3 my-1 text-white/60" {...props} />,
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Turns raw upstream errors into human-readable Portuguese messages. */
function formatBackendError(err: string): string {
  if (/credit balance is too low/i.test(err)) {
    return '⚠️ **Conta da Anthropic sem créditos.**\n\nO agente não consegue chamar o Claude porque o saldo está zerado. Acesse [console.anthropic.com/settings/billing](https://console.anthropic.com/settings/billing) e adicione créditos. Não precisa redeployar — assim que o saldo voltar, o chat funciona.';
  }
  if (/invalid x-api-key|authentication_error|invalid api key/i.test(err)) {
    return '⚠️ **Chave da Anthropic inválida.**\n\nVerifique a variável `ANTHROPIC_API_KEY` no `.env.local` ou no painel do EasyPanel.';
  }
  if (/rate.?limit/i.test(err)) {
    return '⚠️ **Limite de requisições atingido na Anthropic.** Aguarde alguns segundos e tente novamente.';
  }
  // Match only a genuine "unknown model" 404 — not any 400 that happens to contain
  // the words "invalid" and "model" (e.g. "not supported for this model").
  if (/not_found_error|model:\s|model not found|model.*does not exist/i.test(err)) {
    return '⚠️ **Modelo do Claude não encontrado.** O nome do modelo configurado não existe mais. Avise o desenvolvedor.';
  }
  if (/timeout|ETIMEDOUT|fetch failed/i.test(err)) {
    return '⚠️ **Timeout ao chamar a API.** A Anthropic não respondeu a tempo. Tente novamente.';
  }
  // Surface the real upstream message for any other 400 so the cause is visible,
  // instead of guessing. invalid_request_error covers unsupported params, etc.
  if (/invalid_request_error|400/i.test(err)) {
    return `⚠️ **Requisição inválida à API da Anthropic.**\n\nDetalhe: ${err}`;
  }
  return `⚠️ Erro: ${err}`;
}

interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  result?: unknown;
  running: boolean;
  isError?: boolean;
  duration?: number;
}

interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  cache_creation: number;
  cost_usd: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  usage?: Usage;
  interrupted?: boolean;
}

const QUICK_COMMANDS = [
  'Quantos restaurantes temos no banco?',
  'Liste as 10 tabelas com mais registros',
  'Mostre restaurantes sem telefone',
  'Adicione os 20 melhores de Paris',
  'Qual a completude média dos dados?',
];

function ToolCallBlock({ tc }: { tc: ToolCall }) {
  const [open, setOpen] = useState(false);
  const statusColor = tc.running ? 'bg-gold/60 animate-pulse' : tc.isError ? 'bg-red-400' : 'bg-emerald-400/70';
  return (
    <div className={`mt-2 rounded-lg border text-xs overflow-hidden ${tc.isError ? 'border-red-400/20 bg-red-400/5' : 'border-gold/15 bg-gold/5'}`}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-2 text-gold/70 hover:text-gold transition-colors">
        <span className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
        <span className="font-mono">{tc.name}</span>
        {tc.running
          ? <Loader2 className="w-3 h-3 animate-spin text-gold/50" />
          : tc.isError
            ? <AlertCircle className="w-3 h-3 text-red-400/70" />
            : <CheckCircle2 className="w-3 h-3 text-emerald-400/60" />}
        {typeof tc.duration === 'number' && !tc.running && (
          <span className="text-white/25 text-[10px] font-mono">{tc.duration}ms</span>
        )}
        {open ? <ChevronDown className="w-3 h-3 ml-auto" /> : <ChevronRight className="w-3 h-3 ml-auto" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="px-3 pb-3 space-y-2 border-t border-gold/10">
              <div>
                <p className="text-white/30 uppercase tracking-widest text-[10px] mt-2 mb-1">Input</p>
                <pre className="text-white/50 font-mono bg-black/30 rounded p-2 overflow-x-auto text-[10px] max-h-32">
                  {JSON.stringify(tc.input, null, 2)}
                </pre>
              </div>
              {!tc.running && (
                <div>
                  <p className="text-white/30 uppercase tracking-widest text-[10px] mb-1">Output</p>
                  <pre className={`font-mono bg-black/30 rounded p-2 overflow-x-auto text-[10px] max-h-48 ${tc.isError ? 'text-red-400/70' : 'text-emerald-400/60'}`}>
                    {JSON.stringify(tc.result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1 rounded-lg border border-violet-400/15 bg-violet-400/[0.04] text-xs overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-2 text-violet-300/70 hover:text-violet-300 transition-colors">
        <Brain className="w-3 h-3" />
        <span className="font-mono text-[11px]">Raciocínio</span>
        {open ? <ChevronDown className="w-3 h-3 ml-auto" /> : <ChevronRight className="w-3 h-3 ml-auto" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="px-3 pb-3 border-t border-violet-400/10">
              <div className="whitespace-pre-wrap text-violet-200/40 text-[11px] leading-relaxed mt-2 max-h-64 overflow-y-auto">{text}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function UsageFooter({ usage }: { usage: Usage }) {
  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const cacheHitRate = usage.cache_read + usage.input_tokens > 0
    ? Math.round((usage.cache_read / (usage.cache_read + usage.input_tokens)) * 100)
    : 0;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[10px] text-white/25 font-mono">
      <span title="Tokens de entrada (frescos)">↑ {fmt(usage.input_tokens)}</span>
      <span title="Tokens de saída">↓ {fmt(usage.output_tokens)}</span>
      <span title="Tokens lidos do cache (≈10% do custo)" className="text-emerald-400/40">⚡ cache {fmt(usage.cache_read)} ({cacheHitRate}%)</span>
      <span title="Custo estimado da conversa" className="text-gold/40">≈ ${usage.cost_usd.toFixed(4)}</span>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  const cleanContent = msg.content.trim();

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center ${
        isUser ? 'bg-white/10' : 'bg-gradient-to-br from-gold/30 to-amber-700/30 border border-gold/20'
      }`}>
        {isUser ? <User className="w-4 h-4 text-white/60" /> : <Bot className="w-4 h-4 text-gold/70" />}
      </div>

      <div className={`max-w-[80%] space-y-1 ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        {msg.thinking && msg.thinking.trim() && <ThinkingBlock text={msg.thinking} />}

        {cleanContent && (
          <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser ? 'bg-white/10 text-white rounded-tr-none' : 'bg-white/[0.04] border border-white/5 text-white/80 rounded-tl-none'
          }`}>
            {isUser ? (
              <div className="whitespace-pre-wrap">{cleanContent}</div>
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {cleanContent}
              </ReactMarkdown>
            )}
          </div>
        )}

        {msg.toolCalls?.map((tc) => <ToolCallBlock key={tc.id} tc={tc} />)}

        {msg.usage && <UsageFooter usage={msg.usage} />}

        <span className="text-[10px] text-white/20 px-1">
          {new Date(msg.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          {msg.interrupted && <span className="text-amber-400/60 ml-1.5">· interrompida</span>}
        </span>
      </div>
    </motion.div>
  );
}

const GREETING: Message = {
  role: 'assistant',
  content: 'Olá! Sou o **TWK Database Architect**. Tenho acesso completo ao banco de dados PostgreSQL e posso executar queries, importar restaurantes, enriquecer dados e muito mais. Como posso ajudar?',
  timestamp: new Date().toISOString(),
};

export default function AgentChat({ initialPrompt = null, onConsumed }: { initialPrompt?: string | null; onConsumed?: () => void } = {}) {
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const historyLoaded = useRef(false);

  // Restore persisted conversation once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CHAT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) setMessages(parsed.slice(-50));
      }
    } catch {}
    historyLoaded.current = true;
  }, []);

  // Persist the last 50 messages.
  useEffect(() => {
    if (!historyLoaded.current) return;
    try { localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages.slice(-50))); } catch {}
  }, [messages]);

  // Only auto-scroll when the user was already near the bottom (< 150px away).
  useEffect(() => {
    if (nearBottomRef.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const onScrollContainer = () => {
    const el = containerRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
  };

  const clearConversation = () => {
    abortRef.current?.abort();
    setMessages([{ ...GREETING, timestamp: new Date().toISOString() }]);
    try { localStorage.removeItem(CHAT_STORAGE_KEY); } catch {}
  };

  const stopStreaming = () => abortRef.current?.abort();

  const sendMessage = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;

    setInput('');
    if (inputRef.current) inputRef.current.style.height = '48px';
    const userMsg: Message = { role: 'user', content, timestamp: new Date().toISOString() };
    setMessages((m) => [...m, userMsg]);
    setLoading(true);
    nearBottomRef.current = true;

    const allMessages = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: allMessages }),
        signal: controller.signal,
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';
      let upstreamError: string | null = null;
      const assistantMsg: Message = { role: 'assistant', content: '', timestamp: new Date().toISOString(), toolCalls: [] };
      setMessages((m) => [...m, assistantMsg]);

      // Mutable working copy of the current assistant message; we re-publish it on every event.
      const draft: Message = assistantMsg;
      const publish = () => setMessages((m) => m.map((msg, idx) => (idx === m.length - 1 ? { ...draft } : msg)));

      // SSE frames are delimited by a blank line; buffer across chunk boundaries.
      let buffer = '';
      const handleEvent = (payload: string) => {
        if (payload === '[DONE]') return;
        let parsed: Record<string, unknown>;
        try { parsed = JSON.parse(payload); } catch { return; }

        // Back-compat: a bare {error} or {text} without a type still works.
        if (parsed.error && !parsed.type) { upstreamError = String(parsed.error); return; }

        switch (parsed.type) {
          case 'text':
            assistantText += String(parsed.text ?? '');
            draft.content = assistantText;
            publish();
            break;
          case 'thinking':
            draft.thinking = (draft.thinking ?? '') + String(parsed.thinking ?? '');
            publish();
            break;
          case 'tool_start':
            draft.toolCalls = [...(draft.toolCalls ?? []), {
              id: String(parsed.id), name: String(parsed.name), input: parsed.input, running: true,
            }];
            publish();
            break;
          case 'tool_end':
            draft.toolCalls = (draft.toolCalls ?? []).map((tc) => tc.id === parsed.id
              ? { ...tc, running: false, result: parsed.result, isError: Boolean(parsed.isError), duration: Number(parsed.duration) }
              : tc);
            publish();
            break;
          case 'usage':
            draft.usage = parsed.usage as Usage;
            publish();
            break;
          case 'error':
            upstreamError = String(parsed.error);
            break;
          default:
            // Legacy plain {text}
            if (typeof parsed.text === 'string') { assistantText += parsed.text; draft.content = assistantText; publish(); }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? ''; // keep the trailing partial frame
        for (const frame of frames) {
          const line = frame.split('\n').find((l) => l.startsWith('data: '));
          if (line) handleEvent(line.slice(6));
        }
      }
      if (buffer.startsWith('data: ')) handleEvent(buffer.slice(6).trim());

      // Show backend error inside the chat bubble if streaming returned an error
      if (upstreamError) {
        const friendlyMsg = formatBackendError(upstreamError);
        setMessages((m) => m.map((msg, idx) =>
          idx === m.length - 1
            ? { ...msg, content: (assistantText ? assistantText + '\n\n' : '') + friendlyMsg }
            : msg
        ));
        toast.error(friendlyMsg.split('\n')[0]);
      } else if (!assistantText && !(draft.toolCalls && draft.toolCalls.length)) {
        setMessages((m) => m.map((msg, idx) =>
          idx === m.length - 1
            ? { ...msg, content: '⚠️ A resposta veio vazia. Verifique o console do servidor.' }
            : msg
        ));
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        // User pressed "Parar": keep whatever partial content arrived and mark it.
        setMessages((m) => {
          const last = m[m.length - 1];
          if (last?.role === 'assistant') {
            return m.map((msg, idx) => idx === m.length - 1 ? { ...msg, interrupted: true } : msg);
          }
          return [...m, { role: 'assistant', content: 'Geração interrompida.', interrupted: true, timestamp: new Date().toISOString() }];
        });
      } else {
        setMessages((m) => [...m, { role: 'assistant', content: `Erro: ${String(err)}`, timestamp: new Date().toISOString() }]);
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  };

  // Consume an injected prompt (from the global ⌘K palette "ask the agent") once on mount.
  useEffect(() => {
    if (initialPrompt && initialPrompt.trim()) {
      sendMessage(initialPrompt);
      onConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-gold/60" />
          <span className="text-[10px] uppercase tracking-widest text-white/40 font-medium">TWK Agent</span>
        </div>
        <button
          onClick={clearConversation}
          className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-2.5 py-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-gold/40"
        >
          <RotateCcw className="w-3 h-3" /> Nova conversa
        </button>
      </div>

      {/* Messages */}
      <div ref={containerRef} onScroll={onScrollContainer} className="flex-1 overflow-y-auto p-6 space-y-5">
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
            aria-label="Mensagem para o agente"
            onChange={(e) => {
              setInput(e.target.value);
              // Auto-grow up to ~8 rows.
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 176)}px`;
            }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Pergunte ao agente… (Enter para enviar, Shift+Enter para nova linha)"
            rows={1}
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-gold/30 focus:ring-2 focus:ring-gold/40 placeholder:text-white/20 resize-none transition-colors overflow-y-auto"
            style={{ minHeight: '48px', maxHeight: '176px' }}
          />
          {loading ? (
            <button onClick={stopStreaming} aria-label="Parar geração"
              className="flex items-center gap-2 px-4 py-3 bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 rounded-xl text-red-400 text-sm font-medium transition-all flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-gold/40">
              <Square className="w-4 h-4 fill-current" /> Parar
            </button>
          ) : (
            <button onClick={() => sendMessage()} disabled={!input.trim()} aria-label="Enviar mensagem"
              className="p-3 bg-gold/20 hover:bg-gold/30 border border-gold/30 rounded-xl text-gold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-gold/40">
              <Send className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
