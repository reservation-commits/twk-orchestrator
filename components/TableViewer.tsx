'use client';

import { useEffect, useState, useCallback } from 'react';
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
import { motion } from 'framer-motion';
import { ChevronUp, ChevronDown, ChevronsUpDown, Plus, Trash2, Download, RefreshCw, Search } from 'lucide-react';
import toast from 'react-hot-toast';

interface TableInfo { table_schema: string; table_name: string }

export default function TableViewer() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<ColumnDef<Record<string, unknown>>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; colId: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [schema, setSchema] = useState<{ column_name: string; data_type: string }[]>([]);

  useEffect(() => {
    fetch('/api/db?action=tables')
      .then((r) => r.json())
      .then((d) => {
        setTables(d.tables ?? []);
        if (d.tables?.length) setSelectedTable(`${d.tables[0].table_schema}.${d.tables[0].table_name}`);
      });
  }, []);

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

      const cols: ColumnDef<Record<string, unknown>>[] = Object.keys(rowsRes.rows?.[0] ?? {}).map((key) => ({
        accessorKey: key,
        header: key,
        cell: ({ row, column }) => {
          const val = row.getValue(column.id);
          const isEditing = editingCell?.rowIndex === row.index && editingCell?.colId === column.id;
          if (isEditing) {
            return (
              <input
                autoFocus
                className="w-full bg-gold/10 border border-gold/30 rounded px-1 py-0.5 text-xs text-white outline-none"
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
      setColumns(cols);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTable, page, limit, sorting, editingCell, editValue]);

  useEffect(() => { loadRows(); }, [loadRows]);

  const saveEdit = async (row: Record<string, unknown>, colId: string) => {
    setEditingCell(null);
    const idCol = schema[0]?.column_name ?? 'id';
    const idVal = row[idCol];
    try {
      const res = await fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_cell', table: selectedTable, id_column: idCol, id_value: idVal, column: colId, value: editValue }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast.success(`Updated ${colId}`);
      loadRows();
    } catch (err) {
      toast.error(String(err));
    }
  };

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

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 p-4 border-b border-white/5">
        <select
          value={selectedTable}
          onChange={(e) => { setSelectedTable(e.target.value); setPage(1); }}
          className="bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-gold/40"
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
            placeholder="Filter rows…"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="bg-transparent text-sm text-white outline-none w-48 placeholder:text-white/20"
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-white/30">{total.toLocaleString()} rows</span>
          <button onClick={loadRows} className="p-2 hover:bg-white/5 rounded-lg text-white/40 hover:text-white/70 transition-colors">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={exportCSV} className="p-2 hover:bg-white/5 rounded-lg text-white/40 hover:text-white/70 transition-colors">
            <Download className="w-4 h-4" />
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 bg-gold/15 hover:bg-gold/25 border border-gold/20 rounded-lg text-gold text-xs font-medium transition-colors">
            <Plus className="w-3.5 h-3.5" /> Add Row
          </button>
        </div>
      </div>

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
                <td className="px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button className="p-1 hover:bg-red-500/20 rounded text-red-400/60 hover:text-red-400">
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
        <span className="text-xs text-white/30">Page {page} of {Math.ceil(total / limit)}</span>
        <div className="flex gap-2">
          <button disabled={page === 1} onClick={() => setPage(page - 1)}
            className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            Previous
          </button>
          <button disabled={page >= Math.ceil(total / limit)} onClick={() => setPage(page + 1)}
            className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
