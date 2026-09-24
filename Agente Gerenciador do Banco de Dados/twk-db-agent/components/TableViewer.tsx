'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, ChevronDown, ChevronsUpDown, Plus, Trash2, Download, RefreshCw, Search, X, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface TableInfo { table_schema: string; table_name: string }

export default function TableViewer() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; colId: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [schema, setSchema] = useState<{ column_name: string; data_type: string }[]>([]);
  const [pkColumn, setPkColumn] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRow, setNewRow] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetch('/api/db?action=tables')
      .then((r) => r.json())
      .then((d) => {
        setTables(d.tables ?? []);
        if (d.tables?.length) setSelectedTable(`${d.tables[0].table_schema}.${d.tables[0].table_name}`);
      });
  }, []);

  // Real primary key of the selected table (never guess schema[0]).
  useEffect(() => {
    if (!selectedTable) return;
    let cancelled = false;
    setPkColumn(null);
    fetch(`/api/db?action=pk&table=${encodeURIComponent(selectedTable)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setPkColumn(d.pk ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedTable]);

  const idColumn = pkColumn ?? (selectedTable.includes('restaurants') ? 'restaurant_id' : 'id');

  // Data loading depends ONLY on table/page/sort — editing state never retriggers it.
  const loadRows = useCallback(async () => {
    if (!selectedTable) return;
    setLoading(true);
    try {
      const sort = sorting[0];
      const params = new URLSearchParams({
        action: 'rows', table: selectedTable,
        page: String(page), limit: String(limit),
        ...(sort ? { orderBy: sort.id, orderDir: sort.desc ? 'desc' : 'asc' } : {}),
      });
      const [rowsRes, schemaRes] = await Promise.all([
        fetch(`/api/db?${params}`).then((r) => r.json()),
        fetch(`/api/db?action=schema&table=${selectedTable}`).then((r) => r.json()),
      ]);
      setRows(rowsRes.rows ?? []);
      setTotal(rowsRes.total ?? 0);
      setSchema(schemaRes.schema ?? []);
    } finally {
      setLoading(false);
    }
  }, [selectedTable, page, limit, sorting]);

  useEffect(() => { loadRows(); }, [loadRows]);

  const saveEdit = useCallback(async (row: Record<string, unknown>, colId: string) => {
    setEditingCell(null);
    const idVal = row[idColumn];
    if (idVal === undefined) {
      toast.error(`Coluna de PK "${idColumn}" não encontrada na linha`);
      return;
    }
    try {
      const res = await fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_cell', table: selectedTable, id_column: idColumn, id_value: idVal, column: colId, value: editValue }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast.success(`${colId} atualizado`);
      loadRows();
    } catch (err) {
      toast.error(String(err));
    }
  }, [idColumn, selectedTable, editValue, loadRows]);

  const deleteRow = useCallback((row: Record<string, unknown>) => {
    const idVal = row[idColumn];
    if (idVal === undefined) {
      toast.error(`Coluna de PK "${idColumn}" não encontrada na linha`);
      return;
    }
    toast((t) => (
      <div>
        <p className="text-sm mb-2">Excluir a linha {idColumn} = {String(idVal)}? Esta ação não pode ser desfeita.</p>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              toast.dismiss(t.id);
              try {
                // Fluxo em 2 passos: o preview devolve o confirm_token (HMAC do SQL)
                // e a execução real só acontece com o token — o usuário já confirmou no toast.
                const payload = {
                  action: 'mutate',
                  sql: `DELETE FROM ${selectedTable} WHERE ${idColumn} = $1`,
                  params: [idVal],
                  table: selectedTable,
                  operation: 'DELETE',
                };
                const preview = await fetch('/api/db', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload),
                }).then((r) => r.json());
                let data = preview;
                if (preview.requiresConfirmation) {
                  data = await fetch('/api/db', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...payload, confirmed: true, confirm_token: preview.confirm_token }),
                  }).then((r) => r.json());
                }
                if (data.error) throw new Error(data.error);
                toast.success('Linha excluída');
                loadRows();
              } catch (err) {
                toast.error(String(err));
              }
            }}
            className="px-3 py-1 bg-red-500 rounded text-xs text-white">Excluir</button>
          <button onClick={() => toast.dismiss(t.id)}
            className="px-3 py-1 bg-gray-600 rounded text-xs text-white">Cancelar</button>
        </div>
      </div>
    ), { duration: 10000 });
  }, [idColumn, selectedTable, loadRows]);

  // Columns rebuild on editing-state change WITHOUT refetching data.
  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
    const keys = Object.keys(rows[0] ?? {});
    return keys.map((key) => ({
      accessorKey: key,
      header: key,
      cell: ({ row, column }) => {
        const val = row.getValue(column.id);
        const isEditing = editingCell?.rowIndex === row.index && editingCell?.colId === column.id;
        if (isEditing) {
          return (
            <input
              autoFocus
              aria-label={`Editar ${column.id}`}
              className="w-full bg-gold/10 border border-gold/30 rounded px-1 py-0.5 text-xs text-white outline-none focus:ring-2 focus:ring-gold/40"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveEdit(row.original, column.id);
                if (e.key === 'Escape') setEditingCell(null);
              }}
              onBlur={() => setEditingCell(null)}
            />
          );
        }
        const display = val === null ? <span className="text-white/20 italic">null</span>
          : typeof val === 'object' ? <span className="text-blue-300/70 text-xs">{JSON.stringify(val).slice(0, 60)}</span>
          : String(val).length > 60 ? <span title={String(val)}>{String(val).slice(0, 60)}…</span>
          : <span>{String(val)}</span>;
        return (
          <div
            className="cursor-pointer hover:bg-gold/5 rounded px-1 py-0.5 text-xs"
            onDoubleClick={() => {
              setEditingCell({ rowIndex: row.index, colId: column.id });
              setEditValue(val === null ? '' : String(val));
            }}
          >
            {display}
          </div>
        );
      },
    }));
  }, [rows, editingCell, editValue, saveEdit]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualPagination: true,
    pageCount: Math.ceil(total / limit),
  });

  const exportCSV = () => {
    if (!rows.length) return;
    const keys = Object.keys(rows[0]);
    const csv = [keys.join(','), ...rows.map((r) => keys.map((k) => JSON.stringify(r[k] ?? '')).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${selectedTable}.csv`;
    a.click();
  };

  const openAddForm = () => {
    setNewRow({});
    setShowAddForm(true);
  };

  const submitNewRow = async () => {
    const rowObj: Record<string, string> = {};
    for (const [k, v] of Object.entries(newRow)) {
      if (v.trim() !== '') rowObj[k] = v;
    }
    if (!Object.keys(rowObj).length) {
      toast.error('Preencha pelo menos um campo');
      return;
    }
    setAdding(true);
    try {
      const res = await fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulk_insert', table: selectedTable, rows: [rowObj] }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.errors?.length) throw new Error(data.errors[0]);
      toast.success('Linha inserida');
      setShowAddForm(false);
      loadRows();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 p-4 border-b border-white/5">
        <select
          value={selectedTable}
          aria-label="Selecionar tabela"
          onChange={(e) => { setSelectedTable(e.target.value); setPage(1); }}
          className="bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-gold/40 focus:ring-2 focus:ring-gold/40"
        >
          {tables.map((t) => (
            <option key={`${t.table_schema}.${t.table_name}`} value={`${t.table_schema}.${t.table_name}`}>
              {t.table_schema !== 'public' ? `${t.table_schema}.` : ''}{t.table_name}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
          <Search className="w-3.5 h-3.5 text-white/30" />
          <input
            placeholder="Filtrar página atual…"
            aria-label="Filtrar linhas da página atual"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="bg-transparent text-sm text-white outline-none w-48 placeholder:text-white/20 focus:ring-2 focus:ring-gold/40 rounded"
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-white/30">{total.toLocaleString()} linhas</span>
          <button onClick={loadRows} aria-label="Recarregar linhas" title="Recarregar"
            className="p-2 hover:bg-white/5 rounded-lg text-white/40 hover:text-white/70 transition-colors focus:outline-none focus:ring-2 focus:ring-gold/40">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={exportCSV} aria-label="Exportar página atual em CSV" title="Exportar página (CSV)"
            className="p-2 hover:bg-white/5 rounded-lg text-white/40 hover:text-white/70 transition-colors focus:outline-none focus:ring-2 focus:ring-gold/40">
            <Download className="w-4 h-4" />
          </button>
          <button onClick={openAddForm}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gold/15 hover:bg-gold/25 border border-gold/20 rounded-lg text-gold text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-gold/40">
            <Plus className="w-3.5 h-3.5" /> Nova linha
          </button>
        </div>
      </div>

      {/* Add-row modal */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6"
            onClick={() => setShowAddForm(false)}
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div
              initial={{ y: 16, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 16, opacity: 0, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => { if (e.key === 'Escape') setShowAddForm(false); }}
              role="dialog" aria-modal="true" aria-label="Nova linha"
              className="relative w-full max-w-lg max-h-[80vh] flex flex-col bg-[#0a0a0f] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
                <h3 className="font-cormorant text-xl text-white">Nova linha em <span className="text-gold">{selectedTable}</span></h3>
                <button onClick={() => setShowAddForm(false)} aria-label="Fechar"
                  className="p-1.5 hover:bg-white/10 rounded-lg text-white/40 hover:text-white/70 transition-colors focus:outline-none focus:ring-2 focus:ring-gold/40">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-3">
                {schema.map((col) => (
                  <div key={col.column_name} className="flex items-center gap-3">
                    <label htmlFor={`newrow-${col.column_name}`} className="text-xs font-mono text-white/50 w-44 flex-shrink-0 truncate" title={col.column_name}>
                      {col.column_name}
                      <span className="text-white/20 ml-1">{col.data_type}</span>
                    </label>
                    <input
                      id={`newrow-${col.column_name}`}
                      value={newRow[col.column_name] ?? ''}
                      onChange={(e) => setNewRow((r) => ({ ...r, [col.column_name]: e.target.value }))}
                      placeholder="deixe vazio para omitir"
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-gold/40 focus:ring-2 focus:ring-gold/40 placeholder:text-white/15"
                    />
                  </div>
                ))}
                {!schema.length && <p className="text-sm text-white/30">Schema não carregado.</p>}
              </div>
              <div className="flex justify-end gap-2 px-5 py-4 border-t border-white/5">
                <button onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 text-sm bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/60 transition-colors focus:outline-none focus:ring-2 focus:ring-gold/40">
                  Cancelar
                </button>
                <button onClick={submitNewRow} disabled={adding}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-gold/15 hover:bg-gold/25 border border-gold/20 rounded-lg text-gold font-medium transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-gold/40">
                  {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Inserir
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="bg-black/60 backdrop-blur border-b border-white/5">
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    className="text-left px-3 py-2.5 text-white/40 font-medium text-xs uppercase tracking-wide cursor-pointer select-none hover:text-white/70 whitespace-nowrap"
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <div className="flex items-center gap-1.5">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() === 'asc' ? <ChevronUp className="w-3 h-3 text-gold" />
                        : header.column.getIsSorted() === 'desc' ? <ChevronDown className="w-3 h-3 text-gold" />
                        : <ChevronsUpDown className="w-3 h-3 opacity-30" />}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row, i) => (
              <motion.tr
                key={row.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.01 }}
                className="border-b border-white/[0.03] hover:bg-white/[0.02] group"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-2 text-white/70 max-w-[200px]">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
                <td className="px-3 py-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button
                    onClick={() => deleteRow(row.original)}
                    aria-label="Excluir linha"
                    title="Excluir linha"
                    className="p-1 hover:bg-red-500/20 rounded text-red-400/60 hover:text-red-400 focus:outline-none focus:ring-2 focus:ring-gold/40">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between p-3 border-t border-white/5">
        <span className="text-xs text-white/30">Página {page} de {Math.max(1, Math.ceil(total / limit))}</span>
        <div className="flex gap-2">
          <button disabled={page === 1} onClick={() => setPage(page - 1)}
            className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-gold/40">
            Anterior
          </button>
          <button disabled={page >= Math.ceil(total / limit)} onClick={() => setPage(page + 1)}
            className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-gold/40">
            Próxima
          </button>
        </div>
      </div>
    </div>
  );
}
