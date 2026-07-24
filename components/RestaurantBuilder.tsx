'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Star, MapPin, Phone, Globe, ChevronRight, Check, X, Upload, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

type Step = 'config' | 'discovery' | 'enrichment' | 'review' | 'done';

interface RestaurantCandidate {
  place_id: string;
  name: string;
  formatted_address: string;
  rating?: number;
  price_level?: number;
  photos?: { photo_reference: string }[];
  selected: boolean;
  enriched?: Record<string, unknown>;
  enrichStatus?: 'pending' | 'loading' | 'done' | 'error';
  completeness?: number;
}

const PRICE_SYMBOLS = ['', '$', '$$', '$$$', '$$$$'];
const STEP_LABELS: Record<Step, string> = {
  config: 'Configurar',
  discovery: 'Descoberta',
  enrichment: 'Enriquecimento',
  review: 'Revisão',
  done: 'Concluído',
};

function StepIndicator({ current }: { current: Step }) {
  const steps: Step[] = ['config', 'discovery', 'enrichment', 'review', 'done'];
  const idx = steps.indexOf(current);
  return (
    <div className="flex items-center gap-0">
      {steps.slice(0, -1).map((s, i) => (
        <div key={s} className="flex items-center">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium border transition-all ${
            i < idx ? 'bg-gold border-gold text-black' : i === idx ? 'bg-gold/20 border-gold text-gold' : 'bg-white/5 border-white/10 text-white/30'
          }`}>
            {i < idx ? <Check className="w-3.5 h-3.5" /> : i + 1}
          </div>
          <span className={`text-xs mx-2 ${i === idx ? 'text-gold' : 'text-white/30'}`}>{STEP_LABELS[s]}</span>
          {i < 3 && <div className={`w-8 h-px ${i < idx ? 'bg-gold/40' : 'bg-white/10'}`} />}
        </div>
      ))}
    </div>
  );
}

function RestaurantCard({ r, onToggle }: { r: RestaurantCandidate; onToggle: () => void }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`relative rounded-xl border p-4 cursor-pointer transition-all ${
        r.selected ? 'border-gold/40 bg-gold/5' : 'border-white/10 bg-white/[0.02] hover:border-white/20'
      }`}
      onClick={onToggle}
    >
      <div className={`absolute top-3 right-3 w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
        r.selected ? 'bg-gold border-gold' : 'border-white/20'
      }`}>
        {r.selected && <Check className="w-3 h-3 text-black" />}
      </div>

      {r.enriched?.photos && Array.isArray(r.enriched.photos) && (r.enriched.photos as string[]).length > 0 ? (
        <img src={(r.enriched.photos as string[])[0]} alt={r.name} className="w-full h-28 object-cover rounded-lg mb-3 opacity-80" />
      ) : (
        <div className="w-full h-28 bg-gradient-to-br from-gold/10 to-transparent rounded-lg mb-3 flex items-center justify-center">
          <span className="text-white/20 text-3xl">🍽️</span>
        </div>
      )}

      <h3 className="font-medium text-white text-sm truncate pr-6">{r.name}</h3>
      <p className="text-xs text-white/40 truncate mt-0.5 flex items-center gap-1">
        <MapPin className="w-3 h-3 flex-shrink-0" />{r.formatted_address}
      </p>

      <div className="flex items-center gap-3 mt-2">
        {r.rating && (
          <span className="flex items-center gap-1 text-xs text-amber-400">
            <Star className="w-3 h-3 fill-amber-400" />{r.rating.toFixed(1)}
          </span>
        )}
        {r.price_level && (
          <span className="text-xs text-white/40">{PRICE_SYMBOLS[r.price_level]}</span>
        )}
        {Number(r.enriched?.michelin_stars ?? 0) > 0 && (
          <span className="text-xs text-red-400">{'★'.repeat(Number(r.enriched?.michelin_stars ?? 0))} Michelin</span>
        )}
      </div>

      {r.enrichStatus === 'loading' && (
        <div className="absolute inset-0 bg-black/60 rounded-xl flex items-center justify-center">
          <Loader2 className="w-5 h-5 text-gold animate-spin" />
        </div>
      )}
      {r.completeness !== undefined && (
        <div className="mt-2">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-white/30">Completude</span>
            <span className={`text-xs font-medium ${r.completeness >= 80 ? 'text-emerald-400' : r.completeness >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
              {r.completeness}%
            </span>
          </div>
          <div className="h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${r.completeness >= 80 ? 'bg-emerald-400' : r.completeness >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
              style={{ width: `${r.completeness}%` }}
            />
          </div>
        </div>
      )}
    </motion.div>
  );
}

function calcCompleteness(r: Record<string, unknown>): number {
  const fields = ['name', 'address', 'latitude', 'longitude', 'phone', 'website', 'description', 'photos', 'rating', 'michelin_stars'];
  const filled = fields.filter((f) => r[f] !== undefined && r[f] !== null && r[f] !== '' && (!Array.isArray(r[f]) || (r[f] as unknown[]).length > 0)).length;
  return Math.round((filled / fields.length) * 100);
}

export default function RestaurantBuilder() {
  const [step, setStep] = useState<Step>('config');
  const [city, setCity] = useState('');
  const [cuisine, setCuisine] = useState('fine dining');
  const [count, setCount] = useState(20);
  const [restaurants, setRestaurants] = useState<RestaurantCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importResult, setImportResult] = useState<{ inserted: number; errors: string[] } | null>(null);

  const discover = async () => {
    if (!city.trim()) { toast.error('Informe a cidade'); return; }
    setLoading(true);
    setStep('discovery');
    try {
      const res = await fetch('/api/places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'search', city, cuisine, count }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setRestaurants((data.results ?? []).map((r: Record<string, unknown>) => ({
        ...(r as unknown as RestaurantCandidate),
        selected: true,
        enrichStatus: 'pending' as const,
      })));
      toast.success(`${data.results?.length ?? 0} restaurantes encontrados`);
    } catch (err) {
      toast.error(String(err));
      setStep('config');
    } finally {
      setLoading(false);
    }
  };

  const enrich = async () => {
    setStep('enrichment');
    const selected = restaurants.filter((r) => r.selected);
    setProgress(0);

    for (let i = 0; i < selected.length; i++) {
      const r = selected[i];
      setRestaurants((prev) => prev.map((p) => p.place_id === r.place_id ? { ...p, enrichStatus: 'loading' } : p));
      try {
        const res = await fetch('/api/places', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'details', place_id: r.place_id, city, enrich_michelin: true, generate_description: true }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.error || !data.mapped) throw new Error(data.error ?? 'Sem dados');
        const completeness = calcCompleteness(data.mapped);
        setRestaurants((prev) => prev.map((p) =>
          p.place_id === r.place_id
            ? { ...p, enrichStatus: 'done', enriched: data.mapped, completeness }
            : p
        ));
      } catch {
        setRestaurants((prev) => prev.map((p) => p.place_id === r.place_id ? { ...p, enrichStatus: 'error' } : p));
      }
      setProgress(Math.round(((i + 1) / selected.length) * 100));
    }
    setStep('review');
  };

  const importRestaurants = async () => {
    const toInsert = restaurants.filter((r) => r.selected && r.enriched);
    if (!toInsert.length) { toast.error('Nenhum restaurante selecionado com dados'); return; }
    setLoading(true);
    try {
      const rows = toInsert.map((r) => r.enriched);
      const res = await fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulk_insert', table: 'public.db_restaurants', rows }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setImportResult({ inserted: data.inserted ?? 0, errors: data.errors ?? [] });
      setStep('done');
      toast.success(`${data.inserted ?? 0} restaurantes inseridos com sucesso!`);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setStep('config'); setRestaurants([]); setImportResult(null); setProgress(0); };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-6 border-b border-white/5">
        <h2 className="font-cormorant text-2xl text-white mb-4">Restaurant Builder</h2>
        <StepIndicator current={step} />
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <AnimatePresence mode="wait">

          {/* Step 1 — Config */}
          {step === 'config' && (
            <motion.div key="config" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              className="max-w-lg space-y-4">
              <div>
                <label className="text-xs text-white/40 uppercase tracking-widest mb-2 block">Cidade</label>
                <input value={city} onChange={(e) => setCity(e.target.value)}
                  placeholder="ex: Paris, Tokyo, São Paulo"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-gold/40 placeholder:text-white/20 transition-colors" />
              </div>
              <div>
                <label className="text-xs text-white/40 uppercase tracking-widest mb-2 block">Tipo de Culinária</label>
                <input value={cuisine} onChange={(e) => setCuisine(e.target.value)}
                  placeholder="fine dining, sushi, french cuisine…"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-gold/40 placeholder:text-white/20 transition-colors" />
              </div>
              <div>
                <label className="text-xs text-white/40 uppercase tracking-widest mb-2 block">Quantidade (máx. 60)</label>
                <input type="number" min={1} max={60} value={count} onChange={(e) => setCount(Math.min(60, parseInt(e.target.value) || 1))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-gold/40 transition-colors" />
              </div>
              <button onClick={discover} disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-gold/30 to-amber-700/30 hover:from-gold/40 hover:to-amber-700/40 border border-gold/30 rounded-xl text-gold font-medium transition-all disabled:opacity-50">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Descobrir Restaurantes
              </button>
            </motion.div>
          )}

          {/* Step 2 — Discovery */}
          {step === 'discovery' && (
            <motion.div key="discovery" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {loading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                  <div className="w-12 h-12 border-2 border-gold/20 border-t-gold rounded-full animate-spin" />
                  <p className="text-white/50">Buscando restaurantes em {city}…</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-white/60 text-sm">{restaurants.filter((r) => r.selected).length} de {restaurants.length} selecionados</p>
                    <div className="flex gap-2">
                      <button onClick={() => setRestaurants((r) => r.map((x) => ({ ...x, selected: true })))}
                        className="text-xs text-gold/70 hover:text-gold">Selecionar todos</button>
                      <span className="text-white/20">|</span>
                      <button onClick={() => setRestaurants((r) => r.map((x) => ({ ...x, selected: false })))}
                        className="text-xs text-white/40 hover:text-white/70">Desselecionar</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-6">
                    {restaurants.map((r) => (
                      <RestaurantCard key={r.place_id} r={r} onToggle={() => setRestaurants((prev) => prev.map((p) => p.place_id === r.place_id ? { ...p, selected: !p.selected } : p))} />
                    ))}
                  </div>
                  <button onClick={enrich}
                    className="flex items-center gap-2 px-6 py-3 bg-gold/20 hover:bg-gold/30 border border-gold/30 rounded-xl text-gold font-medium transition-all">
                    Enriquecer {restaurants.filter((r) => r.selected).length} restaurantes <ChevronRight className="w-4 h-4" />
                  </button>
                </>
              )}
            </motion.div>
          )}

          {/* Step 3 — Enrichment */}
          {step === 'enrichment' && (
            <motion.div key="enrichment" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-sm text-white/60">Enriquecendo dados…</span>
                  <span className="text-sm text-gold">{progress}%</span>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <motion.div className="h-full bg-gradient-to-r from-gold to-amber-500 rounded-full" animate={{ width: `${progress}%` }} />
                </div>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {restaurants.filter((r) => r.selected).map((r) => (
                  <RestaurantCard key={r.place_id} r={r} onToggle={() => {}} />
                ))}
              </div>
            </motion.div>
          )}

          {/* Step 4 — Review */}
          {step === 'review' && (
            <motion.div key="review" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg text-white font-medium">Revisão Final</h3>
                  <p className="text-sm text-white/40 mt-1">
                    {restaurants.filter((r) => r.selected && r.enrichStatus === 'done').length} prontos,{' '}
                    {restaurants.filter((r) => r.enrichStatus === 'error').length} com erro
                  </p>
                </div>
                <button onClick={importRestaurants} disabled={loading}
                  className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-500/20 to-emerald-600/20 hover:from-emerald-500/30 hover:to-emerald-600/30 border border-emerald-500/30 rounded-xl text-emerald-400 font-medium transition-all disabled:opacity-50">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  Inserir no Banco
                </button>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {restaurants.map((r) => (
                  <RestaurantCard key={r.place_id} r={r} onToggle={() => setRestaurants((prev) => prev.map((p) => p.place_id === r.place_id ? { ...p, selected: !p.selected } : p))} />
                ))}
              </div>
            </motion.div>
          )}

          {/* Step 5 — Done */}
          {step === 'done' && importResult && (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center py-16 gap-6">
              <div className="w-20 h-20 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                <Check className="w-10 h-10 text-emerald-400" />
              </div>
              <div className="text-center">
                <h3 className="text-2xl font-cormorant text-white mb-2">{importResult.inserted} Restaurantes Importados</h3>
                {importResult.errors.length > 0 && (
                  <p className="text-red-400/70 text-sm">{importResult.errors.length} erros ocorreram</p>
                )}
              </div>
              {importResult.errors.length > 0 && (
                <div className="w-full max-w-lg bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                  {importResult.errors.map((e, i) => (
                    <p key={i} className="text-xs text-red-400/70 flex items-start gap-2"><X className="w-3 h-3 mt-0.5 flex-shrink-0" />{e}</p>
                  ))}
                </div>
              )}
              <button onClick={reset} className="px-6 py-3 bg-gold/15 hover:bg-gold/25 border border-gold/20 rounded-xl text-gold font-medium transition-colors">
                Nova Importação
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
