'use client';

import { useState, useEffect, useCallback } from 'react';
import { Toaster } from 'react-hot-toast';
import dynamic from 'next/dynamic';
import Sidebar from '@/components/Sidebar';
import CommandPalette from '@/components/command-center/CommandPalette';
import { motion, AnimatePresence } from 'framer-motion';

const CommandCenter = dynamic(() => import('@/components/CommandCenter'), { ssr: false, loading: () => <Loader /> });
const CRM           = dynamic(() => import('@/components/CRM'),           { ssr: false, loading: () => <Loader /> });
const TableViewer   = dynamic(() => import('@/components/TableViewer'),   { ssr: false, loading: () => <Loader /> });
const QueryConsole  = dynamic(() => import('@/components/QueryConsole'),  { ssr: false, loading: () => <Loader /> });
const DataAuditor   = dynamic(() => import('@/components/DataAuditor'),   { ssr: false, loading: () => <Loader /> });
const AgentChat     = dynamic(() => import('@/components/AgentChat'),     { ssr: false, loading: () => <Loader /> });
const ActivityLogs  = dynamic(() => import('@/components/ActivityLogs'),  { ssr: false, loading: () => <Loader /> });
const SeoDashboard  = dynamic(() => import('@/components/SeoDashboard'),  { ssr: false, loading: () => <Loader /> });
const PhotoStudio   = dynamic(() => import('@/components/PhotoStudio'),   { ssr: false, loading: () => <Loader /> });

function Loader() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-2 border-gold/20 border-t-gold rounded-full animate-spin" />
    </div>
  );
}

const MODULE_TITLES: Record<string, string> = {
  command:'Command Center',
  crm:    'CRM',
  tables: 'Table Viewer',
  query:  'Query Console',
  audit:  'Data Quality Auditor',
  agent:  'Agent Chat',
  logs:   'Activity Logs',
  photos: 'Photo Studio',
  seo:    'SEO & Busca Orgânica',
};

// Linear-style "g then key" shortcuts
const GOTO: Record<string, string> = { c: 'command', r: 'crm', a: 'agent', q: 'audit', s: 'query', t: 'tables', l: 'logs', p: 'photos', o: 'seo' };

export default function Home() {
  const [activeModule, setActiveModule] = useState('command');
  const [askPrompt, setAskPrompt] = useState<string | null>(null);
  const [agentKey, setAgentKey] = useState(0);

  const ask = useCallback((text: string) => {
    setAskPrompt(text);
    setAgentKey((k) => k + 1);
    setActiveModule('agent');
  }, []);

  // Global keyboard shortcuts: "g" then a destination key (skips when typing in a field).
  useEffect(() => {
    let pendingGoto = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (pendingGoto) {
        pendingGoto = false;
        if (timer) clearTimeout(timer);
        if (GOTO[key]) { e.preventDefault(); setActiveModule(GOTO[key]); }
        return;
      }
      if (key === 'g') { pendingGoto = true; timer = setTimeout(() => { pendingGoto = false; }, 900); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); if (timer) clearTimeout(timer); };
  }, []);

  return (
    <div className="flex h-screen bg-twk-bg overflow-hidden font-dm-sans">
      {/* Animated background grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(201,169,110,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(201,169,110,0.03) 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
        }}
      />
      {/* Radial glow */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(201,169,110,0.06),transparent)]" />

      <Sidebar active={activeModule} onChange={setActiveModule} />

      <main className="flex-1 flex flex-col min-w-0 relative z-10">
        {/* Top bar — hidden in Command Center and CRM which have their own headers */}
        {activeModule !== 'command' && activeModule !== 'crm' && (
          <header className="flex items-center px-6 py-4 border-b border-white/5 bg-black/20 backdrop-blur">
            <div>
              <h1 className="font-cormorant text-xl text-white">{MODULE_TITLES[activeModule]}</h1>
              <p className="text-xs text-white/30 mt-0.5">The World Keys · Database Management</p>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-white/20 font-mono">TWK DB Architect v2.0</span>
            </div>
          </header>
        )}

        {/* Module area */}
        <div className="flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeModule}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="h-full"
            >
              {activeModule === 'command'&& <CommandCenter onNavigate={setActiveModule} />}
              {activeModule === 'crm'    && <CRM />}
              {activeModule === 'tables' && <TableViewer />}
              {activeModule === 'query'  && <QueryConsole />}
              {activeModule === 'audit'  && <DataAuditor />}
              {activeModule === 'agent'  && <AgentChat key={agentKey} initialPrompt={askPrompt} onConsumed={() => setAskPrompt(null)} />}
              {activeModule === 'logs'   && <ActivityLogs />}
              {activeModule === 'photos' && <PhotoStudio />}
              {activeModule === 'seo'    && <SeoDashboard onNavigate={setActiveModule} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Global ⌘K command palette — available on every module */}
      <CommandPalette onNavigate={setActiveModule} onAsk={ask} />

      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#0f0f14',
            color: '#e5e5e5',
            border: '1px solid rgba(201,169,110,0.2)',
            fontSize: '13px',
          },
          success: { iconTheme: { primary: '#c9a96e', secondary: '#0a0a0f' } },
          error: { iconTheme: { primary: '#f87171', secondary: '#0a0a0f' } },
        }}
      />
    </div>
  );
}
