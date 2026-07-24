'use client';

import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Command, CornerDownLeft,
  ShieldCheck, Database, MessageSquare, Activity, Terminal, BarChart3,
  Mail, Phone, Globe2, MapPin, Brain, Zap, LayoutGrid, Camera,
} from 'lucide-react';

interface CommandItem {
  id:       string;
  label:    string;
  subtitle?: string;
  icon:     React.ElementType;
  category: string;
  action:   () => void;
  shortcut?: string;
}

interface Props {
  onNavigate: (moduleId: string) => void;
  onRunAction?: (action: string) => void;
  onAsk?: (text: string) => void;
}

export default function CommandPalette({ onNavigate, onRunAction, onAsk }: Props) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else { setQuery(''); setSelected(0); }
  }, [open]);

  const commands: CommandItem[] = [
    { id: 'nav-cmd',     label: 'Command Center',     subtitle: 'Painel ao vivo',          icon: BarChart3,    category: 'Navegação', shortcut: 'G C', action: () => onNavigate('command') },
    { id: 'nav-crm',     label: 'CRM',                subtitle: 'Visão geral, clientes, reservas', icon: LayoutGrid, category: 'Navegação', shortcut: 'G R', action: () => onNavigate('crm') },
    { id: 'nav-chat',    label: 'Agente IA',          subtitle: 'Conversar com o TWK Agent', icon: MessageSquare,category: 'Navegação', shortcut: 'G A', action: () => onNavigate('agent') },
    { id: 'nav-audit',   label: 'Qualidade',          subtitle: 'Auditoria de dados',      icon: ShieldCheck,  category: 'Navegação', shortcut: 'G Q', action: () => onNavigate('audit') },
    { id: 'nav-query',   label: 'SQL Console',        subtitle: 'Editor de queries',       icon: Terminal,     category: 'Navegação', shortcut: 'G S', action: () => onNavigate('query') },
    { id: 'nav-photos',  label: 'Fotos',              subtitle: 'Photo Studio: capturar e publicar', icon: Camera,    category: 'Navegação', shortcut: 'G P', action: () => onNavigate('photos') },
    { id: 'nav-tables',  label: 'Tabelas',            subtitle: 'Navegar todas as tabelas',icon: Database,     category: 'Navegação', shortcut: 'G T', action: () => onNavigate('tables') },
    { id: 'nav-logs',    label: 'Activity Logs',      subtitle: 'Trilha de auditoria',     icon: Activity,     category: 'Navegação', shortcut: 'G L', action: () => onNavigate('logs') },

    { id: 'ai-emails',   label: 'Preencher e-mails faltantes', subtitle: 'Agente descobre e grava oficiais', icon: Mail,        category: 'Inteligência', action: () => onAsk?.('Encontre e preencha os e-mails de reserva faltantes dos restaurantes publicados. Rode enrich_missing_emails com apply=false primeiro, me mostre o resumo e então aplique os de domínio oficial e alta confiança.') },
    { id: 'ai-health',   label: 'Diagnóstico de saúde do banco', subtitle: 'database_health + recomendações', icon: ShieldCheck, category: 'Inteligência', action: () => onAsk?.('Rode database_health e me dê um diagnóstico completo da qualidade do banco, com recomendações priorizadas.') },

    { id: 'a-audit',     label: 'Auditar db_restaurants',      subtitle: 'Scan completo de qualidade', icon: ShieldCheck, category: 'Ações', action: () => { onNavigate('audit'); onRunAction?.('audit_table'); } },
    { id: 'a-emails',    label: 'Validar e-mails (DNS MX)',    subtitle: 'Verificar domínios reais',   icon: Mail,        category: 'Ações', action: () => { onNavigate('audit'); onRunAction?.('check_emails'); } },
    { id: 'a-phones',    label: 'Normalizar telefones (E.164)',subtitle: 'libphonenumber',             icon: Phone,       category: 'Ações', action: () => { onNavigate('audit'); onRunAction?.('check_phones'); } },
    { id: 'a-urls',      label: 'Verificar sites (HEAD)',      subtitle: 'Detectar 404 e parking',     icon: Globe2,      category: 'Ações', action: () => { onNavigate('audit'); onRunAction?.('check_urls'); } },
    { id: 'a-places',    label: 'Frescor vs Google Places',    subtitle: 'Restaurantes fechados',      icon: MapPin,      category: 'Ações', action: () => { onNavigate('audit'); onRunAction?.('check_places'); } },
    { id: 'a-semantic',  label: 'Análise semântica via IA',    subtitle: 'Claude detecta incoerências',icon: Brain,       category: 'Ações', action: () => { onNavigate('audit'); onRunAction?.('semantic_analysis'); } },
    { id: 'a-autofix',   label: 'Gerar sugestões de auto-fix', subtitle: 'URLs, telefones, slugs',     icon: Zap,         category: 'Ações', action: () => { onNavigate('audit'); onRunAction?.('auto_fix'); } },
  ];

  const q = query.trim();
  const baseFiltered = q
    ? commands.filter((c) =>
        c.label.toLowerCase().includes(q.toLowerCase()) ||
        c.subtitle?.toLowerCase().includes(q.toLowerCase()) ||
        c.category.toLowerCase().includes(q.toLowerCase()))
    : commands;
  // Free-text becomes a question routed straight to the AI agent.
  const askItem: CommandItem | null = q
    ? { id: 'ask', label: `Perguntar ao agente: “${q}”`, subtitle: 'Enviar pergunta ao TWK Agent', icon: Brain, category: 'Inteligência', action: () => onAsk?.(q) }
    : null;
  const filtered = askItem ? [askItem, ...baseFiltered] : baseFiltered;

  const grouped = filtered.reduce<Record<string, CommandItem[]>>((acc, c) => {
    (acc[c.category] ??= []).push(c);
    return acc;
  }, {});

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
    if (e.key === 'Enter')     { e.preventDefault(); filtered[selected]?.action(); setOpen(false); }
  };

  let runningIdx = -1;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4"
          onClick={() => setOpen(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />
          <motion.div
            initial={{ y: -20, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -20, opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-2xl bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden"
            style={{ boxShadow: '0 0 80px rgba(201,169,110,0.15)' }}
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5">
              <Search className="w-4 h-4 text-white/30" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
                onKeyDown={onKeyDown}
                placeholder="Buscar comandos, ações, módulos…"
                className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-white/30"
              />
              <kbd className="flex items-center gap-1 text-[10px] text-white/40 bg-white/5 border border-white/10 rounded px-2 py-1 font-mono">ESC</kbd>
            </div>

            {/* Results */}
            <div className="max-h-[60vh] overflow-y-auto py-2">
              {filtered.length === 0 ? (
                <div className="px-5 py-8 text-center text-white/30 text-sm">
                  Nenhum comando para &quot;{query}&quot;
                </div>
              ) : (
                Object.entries(grouped).map(([cat, items]) => (
                  <div key={cat} className="mb-2">
                    <p className="text-[10px] uppercase tracking-widest text-white/30 px-5 py-1.5 font-medium">{cat}</p>
                    {items.map((c) => {
                      runningIdx++;
                      const Icon = c.icon;
                      const isActive = runningIdx === selected;
                      return (
                        <button
                          key={c.id}
                          onMouseEnter={() => setSelected(runningIdx)}
                          onClick={() => { c.action(); setOpen(false); }}
                          className={`w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors ${
                            isActive ? 'bg-gold/10 border-l-2 border-gold' : 'border-l-2 border-transparent hover:bg-white/[0.02]'
                          }`}
                        >
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            isActive ? 'bg-gold/20' : 'bg-white/5'
                          }`}>
                            <Icon className={`w-4 h-4 ${isActive ? 'text-gold' : 'text-white/50'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm truncate ${isActive ? 'text-white' : 'text-white/70'}`}>{c.label}</p>
                            {c.subtitle && <p className="text-xs text-white/30 truncate">{c.subtitle}</p>}
                          </div>
                          {c.shortcut && !isActive && <kbd className="text-[9px] font-mono text-white/30 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 flex-shrink-0">{c.shortcut}</kbd>}
                          {isActive && <CornerDownLeft className="w-3.5 h-3.5 text-gold flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-2.5 bg-black/40 border-t border-white/5 text-[10px] text-white/30">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1"><kbd className="bg-white/5 px-1.5 py-0.5 rounded">↑↓</kbd> navegar</span>
                <span className="flex items-center gap-1"><kbd className="bg-white/5 px-1.5 py-0.5 rounded">↵</kbd> selecionar</span>
              </div>
              <div className="flex items-center gap-1 text-gold/60">
                <Command className="w-3 h-3" />
                <span>TWK Command Center</span>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
