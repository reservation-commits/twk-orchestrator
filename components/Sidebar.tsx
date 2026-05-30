'use client';

import { motion, AnimatePresence } from 'framer-motion';
import {
  Database, Terminal, Download, Sparkles, MessageSquare, Activity,
  BarChart3, Zap, ChevronRight,
} from 'lucide-react';
import { useEffect, useState } from 'react';

const navItems = [
  { id: 'tables', label: 'Tables', icon: Database },
  { id: 'query', label: 'Query Console', icon: Terminal },
  { id: 'import', label: 'Restaurant Builder', icon: Download },
  { id: 'enrich', label: 'Data Enricher', icon: Sparkles },
  { id: 'agent', label: 'Agent Chat', icon: MessageSquare },
  { id: 'logs', label: 'Activity Logs', icon: Activity },
];

interface SidebarProps {
  active: string;
  onChange: (id: string) => void;
}

interface TableCount {
  table_schema: string;
  table_name: string;
  count?: number;
}

export default function Sidebar({ active, onChange }: SidebarProps) {
  const [dbStatus, setDbStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [tables, setTables] = useState<TableCount[]>([]);

  useEffect(() => {
    fetch('/api/db?action=ping')
      .then((r) => r.json())
      .then((d) => setDbStatus(d.ok ? 'online' : 'offline'))
      .catch(() => setDbStatus('offline'));

    fetch('/api/db?action=tables')
      .then((r) => r.json())
      .then((d) => setTables((d.tables ?? []).slice(0, 8)));
  }, []);

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col h-screen bg-black/40 backdrop-blur-xl border-r border-gold/10">
      {/* Logo */}
      <div className="p-6 border-b border-gold/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gold to-amber-700 flex items-center justify-center">
            <Zap className="w-5 h-5 text-black" />
          </div>
          <div>
            <p className="text-gold font-cormorant text-lg font-semibold leading-none">TWK</p>
            <p className="text-white/40 text-xs mt-0.5">DB Architect</p>
          </div>
        </div>

        {/* DB Status */}
        <div className="mt-4 flex items-center gap-2">
          <motion.div
            className={`w-2 h-2 rounded-full ${dbStatus === 'online' ? 'bg-emerald-400' : dbStatus === 'offline' ? 'bg-red-400' : 'bg-yellow-400'}`}
            animate={dbStatus === 'online' ? { opacity: [1, 0.4, 1] } : {}}
            transition={{ repeat: Infinity, duration: 2 }}
          />
          <span className="text-xs text-white/50">
            {dbStatus === 'checking' ? 'Connecting…' : dbStatus === 'online' ? 'PostgreSQL Online' : 'DB Offline'}
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <motion.button
              key={item.id}
              onClick={() => onChange(item.id)}
              whileHover={{ x: 4 }}
              whileTap={{ scale: 0.97 }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 group ${
                isActive
                  ? 'bg-gold/15 text-gold border border-gold/20'
                  : 'text-white/50 hover:text-white/80 hover:bg-white/5'
              }`}
            >
              <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-gold' : 'text-white/30 group-hover:text-white/60'}`} />
              <span className="font-medium">{item.label}</span>
              {isActive && (
                <ChevronRight className="w-3 h-3 ml-auto text-gold/60" />
              )}
            </motion.button>
          );
        })}
      </nav>

      {/* Table counts */}
      <div className="p-4 border-t border-gold/10">
        <p className="text-xs text-white/30 uppercase tracking-widest mb-3 flex items-center gap-2">
          <BarChart3 className="w-3 h-3" /> Tables
        </p>
        <AnimatePresence>
          {tables.map((t) => (
            <motion.div
              key={`${t.table_schema}.${t.table_name}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center justify-between py-1"
            >
              <span className="text-xs text-white/40 truncate max-w-[140px]">
                {t.table_schema !== 'public' ? `${t.table_schema}.` : ''}{t.table_name}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </aside>
  );
}
