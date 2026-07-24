'use client';

import { motion } from 'framer-motion';
import {
  Database, Terminal, MessageSquare, Activity,
  Zap, ChevronRight, ShieldCheck, Command, LayoutGrid, Camera, Search,
  Network, UtensilsCrossed, Sparkles,
} from 'lucide-react';
import { useEffect, useState } from 'react';

const navSections = [
  {
    title: 'Controle',
    items: [
      { id: 'command', label: 'Command Center', icon: Command, badge: 'LIVE' as const },
      { id: 'crm', label: 'CRM', icon: LayoutGrid, badge: 'NEW' as const },
    ],
  },
  {
    title: 'Inteligência',
    items: [
      { id: 'agent', label: 'Agente IA', icon: MessageSquare },
      { id: 'audit', label: 'Qualidade', icon: ShieldCheck },
      { id: 'seo', label: 'SEO', icon: Search, badge: 'NEW' as const },
    ],
  },
  {
    title: 'Dados',
    items: [
      { id: 'photos', label: 'Fotos', icon: Camera, badge: 'NEW' as const },
      { id: 'schema', label: 'Schema', icon: Network },
      { id: 'builder', label: 'Restaurant Builder', icon: UtensilsCrossed, badge: 'NEW' as const },
      { id: 'enricher', label: 'Data Enricher', icon: Sparkles },
      { id: 'query', label: 'SQL Console', icon: Terminal },
      { id: 'tables', label: 'Tabelas', icon: Database },
      { id: 'logs', label: 'Activity Logs', icon: Activity },
    ],
  },
];

interface SidebarProps {
  active: string;
  onChange: (id: string) => void;
}

export default function Sidebar({ active, onChange }: SidebarProps) {
  const [dbStatus, setDbStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [latency, setLatency] = useState<number | null>(null);

  useEffect(() => {
    const ping = () => {
      const t0 = performance.now();
      fetch('/api/db?action=ping')
        .then((r) => r.json())
        .then((d) => { setDbStatus(d.ok ? 'online' : 'offline'); setLatency(Math.round(performance.now() - t0)); })
        .catch(() => setDbStatus('offline'));
    };
    ping();
    const i = setInterval(ping, 15000);
    return () => clearInterval(i);
  }, []);

  const openPalette = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col h-screen bg-black/40 backdrop-blur-xl border-r border-gold/10">
      {/* Logo */}
      <div className="p-6 pb-5 border-b border-gold/10">
        <div className="flex items-center gap-3">
          <motion.div
            className="w-10 h-10 rounded-xl bg-gradient-to-br from-gold to-amber-700 flex items-center justify-center"
            animate={{ boxShadow: ['0 0 16px rgba(201,169,110,0.25)', '0 0 28px rgba(201,169,110,0.45)', '0 0 16px rgba(201,169,110,0.25)'] }}
            transition={{ repeat: Infinity, duration: 3.5 }}
          >
            <Zap className="w-5 h-5 text-black" />
          </motion.div>
          <div>
            <p className="text-gold font-cormorant text-lg font-semibold leading-none tracking-wide">TWK</p>
            <p className="text-white/40 text-[10px] uppercase tracking-[0.2em] mt-1">Data Intelligence</p>
          </div>
        </div>
      </div>

      {/* Sectioned navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5 no-scrollbar">
        {navSections.map((section) => (
          <div key={section.title}>
            <p className="text-[9px] uppercase tracking-[0.22em] text-white/25 px-3 mb-1.5">{section.title}</p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = active === item.id;
                const badge = 'badge' in item ? item.badge : undefined;
                return (
                  <motion.button
                    key={item.id}
                    onClick={() => onChange(item.id)}
                    whileHover={{ x: 3 }}
                    whileTap={{ scale: 0.98 }}
                    className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 group ${
                      isActive ? 'bg-gold/15 text-gold' : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                    }`}
                  >
                    {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-gold" />}
                    <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-gold' : 'text-white/30 group-hover:text-white/60'}`} />
                    <span className="font-medium">{item.label}</span>
                    {badge && !isActive && (
                      <span className={`ml-auto text-[9px] rounded px-1.5 py-0.5 font-semibold border ${
                        badge === 'LIVE'
                          ? 'bg-emerald-400/20 text-emerald-400 border-emerald-400/30 animate-pulse'
                          : 'bg-gold/20 text-gold border-gold/30'
                      }`}>{badge}</span>
                    )}
                    {isActive && <ChevronRight className="w-3 h-3 ml-auto text-gold/60" />}
                  </motion.button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer: command launcher + live DB pulse */}
      <div className="p-3 border-t border-gold/10 space-y-2">
        <button
          onClick={openPalette}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/10 hover:border-gold/30 hover:bg-white/5 transition-colors group"
        >
          <Command className="w-3.5 h-3.5 text-white/40 group-hover:text-gold" />
          <span className="text-xs text-white/50 group-hover:text-white/80">Comandos</span>
          <kbd className="ml-auto flex items-center gap-0.5 text-[9px] font-mono text-white/40 bg-white/5 border border-white/10 rounded px-1.5 py-0.5">⌘K</kbd>
        </button>

        <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-2">
            <motion.span
              className={`w-1.5 h-1.5 rounded-full ${dbStatus === 'online' ? 'bg-emerald-400' : dbStatus === 'offline' ? 'bg-red-400' : 'bg-yellow-400'}`}
              animate={dbStatus === 'online' ? { opacity: [1, 0.3, 1] } : {}}
              transition={{ repeat: Infinity, duration: 2 }}
            />
            <span className="text-[10px] text-white/40">{dbStatus === 'online' ? 'PostgreSQL' : dbStatus === 'offline' ? 'Offline' : 'Conectando…'}</span>
          </div>
          {latency != null && dbStatus === 'online' && <span className="text-[10px] font-mono text-white/25">{latency}ms</span>}
        </div>
      </div>
    </aside>
  );
}
