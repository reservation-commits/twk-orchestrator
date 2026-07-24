'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Camera, Search, Check, Star, Loader2, Globe, MapPin, Instagram,
  AlertTriangle, Sparkles, X, CheckCircle2, Images, Facebook, Maximize2, EyeOff, Eye,
} from 'lucide-react';
import { heroUrl } from '@/types/contract';

// ── Types (mirror lib/photo-curator) ─────────────────────────────────────────
type PhotoSource = 'site' | 'places' | 'instagram' | 'facebook' | 'tripadvisor';
interface CuratedPhoto {
  source_url: string; source: PhotoSource; width: number; height: number;
  category: 'ambiente' | 'prato' | 'pessoa' | 'texto' | 'outro'; is_cover: boolean; alt_text: string;
  quality?: 'high' | 'low';
}
interface Restaurant {
  restaurant_id: string; name: string; city?: string; country?: string; slug?: string;
  place_id?: string; site_url?: string; published?: boolean; ready_pending_photo?: boolean; images_json?: Record<string, unknown> | null;
}
interface StorageStatus { configured: boolean; bucket: string | null; publicBase: string; hasCredentials: boolean; reason?: string; }

const SOURCE_META: Record<PhotoSource, { label: string; icon: typeof Globe; color: string }> = {
  site:        { label: 'Site oficial', icon: Globe,     color: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10' },
  places:      { label: 'Google Places', icon: MapPin,   color: 'text-sky-400 border-sky-400/30 bg-sky-400/10' },
  instagram:   { label: 'Instagram',     icon: Instagram, color: 'text-pink-400 border-pink-400/30 bg-pink-400/10' },
  facebook:    { label: 'Facebook',      icon: Facebook,  color: 'text-blue-400 border-blue-400/30 bg-blue-400/10' },
  tripadvisor: { label: 'TripAdvisor',   icon: Sparkles,  color: 'text-lime-400 border-lime-400/30 bg-lime-400/10' },
};

export default function PhotoStudio() {
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Restaurant[]>([]);
  const [missingMode, setMissingMode] = useState(true);
  const [missingCount, setMissingCount] = useState<number | null>(null);
  const [readyCount, setReadyCount] = useState<number | null>(null);
  const [selected, setSelected] = useState<Restaurant | null>(null);

  const [capturing, setCapturing] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<CuratedPhoto[]>([]);
  const [captureMsg, setCaptureMsg] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [settingPublished, setSettingPublished] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ── Initial: storage status + missing queue ────────────────────────────────
  useEffect(() => {
    fetch('/api/photos?action=status').then((r) => r.json()).then((d) => setStorage(d.storage)).catch(() => {});
  }, []);

  const loadMissing = useCallback(() => {
    fetch('/api/photos?action=missing').then((r) => r.json()).then((d) => { setResults(d.rows ?? []); setMissingCount(d.count ?? 0); setReadyCount(d.readyCount ?? 0); }).catch(() => {});
  }, []);
  useEffect(() => { if (missingMode) loadMissing(); }, [missingMode, loadMissing]);

  // ── Search (debounced) ─────────────────────────────────────────────────────
  useEffect(() => {
    if (missingMode) return;
    const t = setTimeout(() => {
      if (!q.trim()) { setResults([]); return; }
      fetch(`/api/photos?action=search&q=${encodeURIComponent(q)}`).then((r) => r.json()).then((d) => setResults(d.rows ?? [])).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [q, missingMode]);

  const resetCapture = () => { setCandidates([]); setProgress([]); setCaptureMsg(null); setChosen(new Set()); setCoverUrl(null); };

  const pickRestaurant = (r: Restaurant) => { setSelected(r); resetCapture(); };

  // ── Capture (SSE) ──────────────────────────────────────────────────────────
  const capture = useCallback(async () => {
    if (!selected) return;
    resetCapture(); setCapturing(true);
    const ac = new AbortController(); abortRef.current = ac;
    try {
      const res = await fetch('/api/photos/capture', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_id: selected.restaurant_id }), signal: ac.signal,
      });
      if (!res.body) throw new Error('Sem stream');
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n'); buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data: ')); if (!line) continue;
          const payload = line.slice(6); if (payload === '[DONE]') continue;
          let ev: Record<string, unknown>; try { ev = JSON.parse(payload); } catch { continue; }
          if (ev.type === 'progress') {
            if (ev.phase === 'source') {
              const m = SOURCE_META[ev.source as PhotoSource];
              if (ev.status === 'start') setProgress((p) => [...p, `🔎 Consultando ${m?.label ?? ev.source}…`]);
              else setProgress((p) => [...p, `✓ ${m?.label ?? ev.source}: ${ev.found ?? 0} candidata(s)`]);
            } else if (ev.phase === 'fetch') {
              setProgress((p) => { const c = [...p]; const txt = `⬇️ Validando imagens ${ev.fetched}/${ev.total}…`; if (c[c.length - 1]?.startsWith('⬇️')) c[c.length - 1] = txt; else c.push(txt); return c; });
            } else if (ev.phase === 'classify') {
              setProgress((p) => [...p, `🧠 Classificando ${ev.count} imagens por visão…`]);
            }
          } else if (ev.type === 'result') {
            const photos = (ev.photos as CuratedPhoto[]) ?? [];
            setCandidates(photos);
            setCaptureMsg(ev.message as string);
            // pre-select all + cover
            setChosen(new Set(photos.map((p) => p.source_url)));
            const cov = photos.find((p) => p.is_cover); setCoverUrl(cov?.source_url ?? photos[0]?.source_url ?? null);
          } else if (ev.type === 'error') {
            toast.error(String(ev.error));
          }
        }
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) toast.error(String(e));
    } finally { setCapturing(false); abortRef.current = null; }
  }, [selected]);

  const toggle = (url: string) => setChosen((s) => { const n = new Set(s); if (n.has(url)) n.delete(url); else n.add(url); return n; });

  // Manual "best source": ask the server for a higher-resolution version of one photo and swap
  // it in (remapping selection + cover pointers, which are keyed by source_url).
  const upgrade = useCallback(async (oldUrl: string) => {
    setUpgrading((s) => new Set(s).add(oldUrl));
    try {
      const res = await fetch('/api/photos/upgrade', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source_url: oldUrl }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Falha ao otimizar');
      if (!d.upgraded) { toast('Já está na maior versão disponível.'); return; }
      setCandidates((cs) => cs.map((c) => {
        if (c.source_url !== oldUrl) return c;
        const bar = c.is_cover ? 1500 : 1100;
        return { ...c, source_url: d.source_url, width: d.width, height: d.height, quality: d.width >= bar ? 'high' : 'low' };
      }));
      setChosen((s) => { if (!s.has(oldUrl)) return s; const n = new Set(s); n.delete(oldUrl); n.add(d.source_url); return n; });
      setCoverUrl((cu) => (cu === oldUrl ? d.source_url : cu));
      toast.success(`Versão maior encontrada: ${d.width}px de largura`);
    } catch (e) { toast.error(String(e)); }
    finally { setUpgrading((s) => { const n = new Set(s); n.delete(oldUrl); return n; }); }
  }, []);

  // Invariant: the cover pointer must always reference a SELECTED photo. If the current
  // cover gets deselected (or none is set yet), move it to the first selected photo. This
  // prevents a "dangling" cover that publishes the wrong image and drops the user's pick.
  useEffect(() => {
    if (!candidates.length) return;
    if (coverUrl && chosen.has(coverUrl)) return;
    const next = candidates.find((c) => chosen.has(c.source_url));
    setCoverUrl(next ? next.source_url : null);
  }, [chosen, candidates, coverUrl]);

  // ── Publish ────────────────────────────────────────────────────────────────
  const publish = useCallback(async () => {
    if (!selected || !storage?.configured) return;
    // The explicitly starred cover is ALWAYS published, even if its checkbox state lagged.
    const pickedSet = new Set(chosen);
    if (coverUrl) pickedSet.add(coverUrl);
    const picked = candidates.filter((c) => pickedSet.has(c.source_url));
    const coverPhoto = picked.find((c) => c.source_url === coverUrl) ?? picked[0] ?? null;
    const gallery = picked.filter((c) => c.source_url !== coverPhoto?.source_url);
    if (!coverPhoto) { toast.error('Selecione ao menos uma foto.'); return; }
    setPublishing(true);
    try {
      const res = await fetch('/api/photos/publish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurant_id: selected.restaurant_id,
          cover: { source_url: coverPhoto.source_url, source: coverPhoto.source, is_cover: true, alt_text: coverPhoto.alt_text, category: coverPhoto.category },
          gallery: gallery.map((g) => ({ source_url: g.source_url, source: g.source, alt_text: g.alt_text, category: g.category })),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Falha ao publicar');
      toast.success(`Publicado: 1 capa + ${d.uploaded.gallery} galeria`);
      if (d.errors?.length) toast(`${d.errors.length} item(ns) falharam`, { icon: '⚠️' });
      resetCapture();
      setSelected((s) => (s ? { ...s, images_json: d.images_json } : s));
      if (missingMode) loadMissing();
    } catch (e) { toast.error(String(e)); } finally { setPublishing(false); }
  }, [selected, storage, candidates, chosen, coverUrl, missingMode, loadMissing]);

  // Publish / unpublish the establishment itself. Publishing clears the "pronto" mark.
  const togglePublished = useCallback(async () => {
    if (!selected) return;
    const next = !selected.published;
    setSettingPublished(true);
    try {
      const res = await fetch('/api/photos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-published', restaurant_id: selected.restaurant_id, published: next }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Falha ao alterar publicação');
      setSelected((s) => (s ? { ...s, published: next, ready_pending_photo: next ? false : s.ready_pending_photo } : s));
      toast.success(next ? 'Estabelecimento publicado' : 'Estabelecimento despublicado');
      if (missingMode) loadMissing();
    } catch (e) { toast.error(String(e)); } finally { setSettingPublished(false); }
  }, [selected, missingMode, loadMissing]);

  const currentCover = heroUrl(selected?.images_json);
  const pickedCount = chosen.size;

  return (
    <div className="h-full flex overflow-hidden">
      {/* ── Left: picker ───────────────────────────────────────────────────── */}
      <div className="w-80 flex-shrink-0 border-r border-white/5 flex flex-col bg-black/20">
        <div className="p-4 border-b border-white/5">
          <div className="flex gap-1 mb-3 p-1 bg-black/30 rounded-lg">
            <button onClick={() => setMissingMode(true)} className={`flex-1 text-xs py-1.5 rounded-md transition ${missingMode ? 'bg-gold/20 text-gold' : 'text-white/40 hover:text-white/70'}`}>
              Sem fotos {missingCount != null && <span className="opacity-60">({missingCount})</span>}
            </button>
            <button onClick={() => { setMissingMode(false); setResults([]); }} className={`flex-1 text-xs py-1.5 rounded-md transition ${!missingMode ? 'bg-gold/20 text-gold' : 'text-white/40 hover:text-white/70'}`}>
              Buscar
            </button>
          </div>
          {missingMode && readyCount != null && readyCount > 0 && (
            <p className="text-[10px] text-white/40 mb-1 px-1"><span className="text-emerald-300 font-medium">{readyCount} prontos</span> (estavam publicados, só falta foto) · os demais ainda faltam dados</p>
          )}
          {!missingMode && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome ou cidade…" autoFocus
                className="w-full bg-black/30 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-gold/40 outline-none" />
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto no-scrollbar p-2 space-y-1">
          {results.map((r) => {
            const hasCover = !!heroUrl(r.images_json);
            return (
              <button key={r.restaurant_id} onClick={() => pickRestaurant(r)}
                className={`w-full text-left px-3 py-2.5 rounded-lg transition group ${selected?.restaurant_id === r.restaurant_id ? 'bg-gold/15 border border-gold/30' : 'hover:bg-white/5 border border-transparent'}`}>
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${hasCover ? 'bg-emerald-400/60' : 'bg-amber-400/70'}`} />
                  <span className="text-sm text-white/80 truncate group-hover:text-white">{r.name}</span>
                  {r.ready_pending_photo
                    ? <span className="ml-auto flex-shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-emerald-400/15 text-emerald-300 border border-emerald-400/25" title="Estava publicado — só falta foto">pronto</span>
                    : r.published === false
                      ? <EyeOff className="w-3 h-3 text-white/25 flex-shrink-0 ml-auto" aria-label="Não publicado — faltam dados" />
                      : null}
                </div>
                <p className="text-[11px] text-white/30 ml-3.5 truncate">{[r.city, r.country].filter(Boolean).join(', ')}</p>
              </button>
            );
          })}
          {missingMode && !results.length && <p className="text-xs text-white/30 text-center py-8">Nenhum restaurante sem foto. 🎉</p>}
          {!missingMode && !results.length && q && <p className="text-xs text-white/30 text-center py-8">Sem resultados.</p>}
        </div>
      </div>

      {/* ── Right: capture + contact sheet ─────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/5 flex items-center gap-4">
          <div className="w-9 h-9 rounded-lg bg-gold/15 flex items-center justify-center flex-shrink-0">
            <Camera className="w-5 h-5 text-gold" />
          </div>
          <div className="min-w-0">
            <p className="text-[9px] uppercase tracking-[0.22em] text-white/30">Curadoria de Fotos</p>
            <h2 className="font-cormorant text-2xl text-white leading-tight truncate">{selected ? selected.name : 'Photo Studio'}</h2>
          </div>
          {selected && (
            <div className="ml-auto flex items-center gap-2">
              <button onClick={togglePublished} disabled={settingPublished}
                title={selected.published ? 'Remover do site' : 'Publicar no site'}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition disabled:opacity-50 ${selected.published ? 'border-white/15 text-white/60 hover:bg-white/5' : 'border-emerald-400/40 text-emerald-300 hover:bg-emerald-400/10'}`}>
                {settingPublished ? <Loader2 className="w-4 h-4 animate-spin" /> : selected.published ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                {selected.published ? 'Despublicar' : 'Publicar'}
              </button>
              <button onClick={capture} disabled={capturing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gold text-black text-sm font-semibold hover:bg-gold/90 disabled:opacity-50 transition">
                {capturing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {capturing ? 'Capturando…' : candidates.length ? 'Recapturar' : 'Capturar fotos'}
              </button>
            </div>
          )}
        </div>

        {/* Storage banner */}
        {storage && !storage.configured && (
          <div className="mx-6 mt-4 flex items-start gap-3 p-3 rounded-lg bg-amber-400/10 border border-amber-400/25 text-amber-200/90 text-xs">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Publicação no bucket desativada — {storage.reason}</p>
              <p className="mt-1 text-amber-200/60">Defina no <code className="font-mono">.env.local</code>: <code className="font-mono">GCS_BUCKET</code> e <code className="font-mono">GCS_SERVICE_ACCOUNT_KEY</code> (JSON da service account). A captura e curadoria já funcionam; só o upload aguarda as credenciais.</p>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto no-scrollbar p-6">
          {!selected && (
            <div className="h-full flex flex-col items-center justify-center text-center text-white/30">
              <Images className="w-12 h-12 mb-4 opacity-40" />
              <p className="text-sm">Selecione um restaurante para capturar fotos.</p>
              <p className="text-xs mt-1 opacity-60">Fontes verificadas: site oficial · Google Places · redes sociais · TripAdvisor</p>
            </div>
          )}

          {selected && !capturing && !candidates.length && (
            <div className="space-y-4">
              {currentCover ? (
                <div>
                  <p className="text-xs text-white/40 mb-2">Capa atual</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={currentCover} alt="capa atual" className="rounded-xl border border-white/10 max-h-64 object-cover" />
                </div>
              ) : (
                <p className="text-sm text-white/40">Este restaurante ainda não tem capa. Clique em <strong className="text-gold">Capturar fotos</strong>.</p>
              )}
            </div>
          )}

          {/* Capture progress */}
          {capturing && (
            <div className="max-w-md mx-auto mt-8 space-y-2">
              {progress.map((p, i) => (
                <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                  className="text-sm text-white/60 font-mono">{p}</motion.div>
              ))}
              <div className="flex items-center gap-2 text-gold/70 text-sm pt-2"><Loader2 className="w-4 h-4 animate-spin" /> trabalhando…</div>
            </div>
          )}

          {/* Contact sheet */}
          {!!candidates.length && (
            <>
              <div className="flex items-center gap-3 mb-4">
                <p className="text-sm text-white/60">{captureMsg}</p>
                <span className="text-xs text-white/30 ml-auto">{pickedCount} selecionada(s) · clique na foto (ou ⭐) p/ definir a capa · ✓ inclui/remove</span>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {candidates.map((c) => {
                  const isChosen = chosen.has(c.source_url);
                  const isCover = coverUrl === c.source_url;
                  const sm = SOURCE_META[c.source];
                  const SIcon = sm?.icon ?? Globe;
                  return (
                    <motion.div key={c.source_url} layout
                      className={`relative rounded-xl overflow-hidden border transition group ${isCover ? 'border-gold ring-2 ring-gold/40' : isChosen ? 'border-emerald-400/40' : 'border-white/10 opacity-60'}`}>
                      {/* Clicking the photo = make it the cover (the intuitive gesture). Use the
                          top-left ✓ to include/remove from the gallery instead. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.source_url} alt={c.alt_text} loading="lazy" className="w-full h-40 object-cover cursor-pointer"
                        title="Clique para definir como capa"
                        onClick={() => { setChosen((s) => new Set(s).add(c.source_url)); setCoverUrl(c.source_url); }} />
                      {/* select check */}
                      <button onClick={(e) => { e.stopPropagation(); toggle(c.source_url); }}
                        className={`absolute top-2 left-2 w-6 h-6 rounded-md flex items-center justify-center border transition ${isChosen ? 'bg-emerald-500 border-emerald-400 text-black' : 'bg-black/50 border-white/30 text-transparent'}`}>
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      {/* cover star — selects the photo AND marks it as cover */}
                      <button onClick={(e) => { e.stopPropagation(); setChosen((s) => new Set(s).add(c.source_url)); setCoverUrl(c.source_url); }} title="Definir como capa"
                        className={`absolute top-2 right-2 w-6 h-6 rounded-md flex items-center justify-center border transition ${isCover ? 'bg-gold border-gold text-black' : 'bg-black/50 border-white/30 text-white/70 hover:text-gold'}`}>
                        <Star className="w-3.5 h-3.5" fill={isCover ? 'currentColor' : 'none'} />
                      </button>
                      {/* meta footer */}
                      <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/85 to-transparent flex items-center gap-1.5">
                        <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${sm?.color ?? 'text-white/60 border-white/20'}`}>
                          <SIcon className="w-2.5 h-2.5" /> {sm?.label ?? c.source}
                        </span>
                        {c.quality === 'low' && (
                          <button onClick={(e) => { e.stopPropagation(); upgrade(c.source_url); }} disabled={upgrading.has(c.source_url)}
                            title="Buscar versão de maior resolução" aria-label="Buscar versão de maior resolução"
                            className="flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded border border-amber-400/40 text-amber-300 hover:bg-amber-400/15 disabled:opacity-50">
                            {upgrading.has(c.source_url) ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Maximize2 className="w-2.5 h-2.5" />} maior
                          </button>
                        )}
                        <span className={`text-[10px] ml-auto ${c.quality === 'low' ? 'text-amber-300' : 'text-white/50'}`}>{c.width}×{c.height}</span>
                        <span className={`text-[10px] px-1 rounded ${c.category === 'ambiente' ? 'text-emerald-300' : 'text-orange-300'}`}>{c.category}</span>
                      </div>
                      {isCover && <span className="absolute top-9 right-2 text-[9px] font-semibold text-gold bg-black/60 px-1.5 py-0.5 rounded">CAPA</span>}
                    </motion.div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer: publish */}
        <AnimatePresence>
          {!!candidates.length && (
            <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
              className="px-6 py-4 border-t border-white/5 bg-black/30 flex items-center gap-4">
              <div className="text-xs text-white/40">
                {pickedCount >= 5 ? <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> meta de 5+ atingida</span>
                  : <span className="text-amber-400 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> {pickedCount} selecionada(s) — meta é 5</span>}
              </div>
              <button onClick={resetCapture} className="ml-auto flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 px-3 py-2"><X className="w-3.5 h-3.5" /> Descartar</button>
              <button onClick={publish} disabled={publishing || !storage?.configured || !pickedCount}
                title={!storage?.configured ? 'Configure o bucket GCS para publicar' : ''}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gold text-black text-sm font-semibold hover:bg-gold/90 disabled:opacity-40 disabled:cursor-not-allowed transition">
                {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {publishing ? 'Publicando…' : `Aprovar e publicar (${pickedCount})`}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
