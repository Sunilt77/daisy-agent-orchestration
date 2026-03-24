import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2, X } from 'lucide-react';
import Pagination from '../components/Pagination';

interface PricingRow {
  id: number;
  model: string;
  input_usd: number;
  output_usd: number;
  created_at?: string;
}

export default function PricingPage() {
  const [rows, setRows] = useState<PricingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState({ model: '', input_usd: '', output_usd: '' });
  const [newRow, setNewRow] = useState({ model: '', input_usd: '', output_usd: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/pricing');
    const data = await res.json().catch(() => []);
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [rows.length]);

  const startEdit = (row: PricingRow) => {
    setEditingId(row.id);
    setDraft({ model: row.model, input_usd: String(row.input_usd), output_usd: String(row.output_usd) });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft({ model: '', input_usd: '', output_usd: '' });
  };

  const saveEdit = async (id: number) => {
    await fetch(`/api/pricing/${id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: draft.model,
          input_usd: Number(draft.input_usd),
          output_usd: Number(draft.output_usd),
        })
      }
    );
    setEditingId(null);
    await load();
  };

  const createRow = async () => {
    if (!newRow.model.trim()) return;
    await fetch('/api/pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: newRow.model.trim(),
        input_usd: Number(newRow.input_usd),
        output_usd: Number(newRow.output_usd),
      })
    });
    setNewRow({ model: '', input_usd: '', output_usd: '' });
    await load();
  };

  const deleteRow = async (id: number) => {
    await fetch(`/api/pricing/${id}`, { method: 'DELETE' });
    await load();
  };

  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, page, pageSize]);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Model Pricing</h1>
          <p className="text-slate-500 mt-1">Edit per-model pricing used for usage cost calculations.</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input
              className="ui-input"
              placeholder="Model name"
              value={newRow.model}
              onChange={(e) => setNewRow({ ...newRow, model: e.target.value })}
            />
            <input
              className="ui-input"
              placeholder="Input USD / 1M"
              value={newRow.input_usd}
              onChange={(e) => setNewRow({ ...newRow, input_usd: e.target.value })}
            />
            <input
              className="ui-input"
              placeholder="Output USD / 1M"
              value={newRow.output_usd}
              onChange={(e) => setNewRow({ ...newRow, output_usd: e.target.value })}
            />
            <button
              onClick={createRow}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
            >
              <Plus size={16} /> Add Model
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-slate-500">Loading pricing...</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No pricing configured yet.</div>
        ) : (
          <table className="w-full text-sm text-left text-slate-700">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Model</th>
                <th className="px-4 py-3 text-right">Input USD / 1M</th>
                <th className="px-4 py-3 text-right">Output USD / 1M</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {pagedRows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3">
                    {editingId === row.id ? (
                      <input
                        className="ui-input !py-1 w-full"
                        value={draft.model}
                        onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                      />
                    ) : (
                      <span className="font-medium text-slate-900">{row.model}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editingId === row.id ? (
                      <input
                        className="ui-input !py-1 w-24 text-right"
                        value={draft.input_usd}
                        onChange={(e) => setDraft({ ...draft, input_usd: e.target.value })}
                      />
                    ) : (
                      row.input_usd.toFixed(4)
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editingId === row.id ? (
                      <input
                        className="ui-input !py-1 w-24 text-right"
                        value={draft.output_usd}
                        onChange={(e) => setDraft({ ...draft, output_usd: e.target.value })}
                      />
                    ) : (
                      row.output_usd.toFixed(4)
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editingId === row.id ? (
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => saveEdit(row.id)}
                          className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700"
                        >
                          <Save size={14} /> Save
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-700"
                        >
                          <X size={14} /> Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-3">
                        <button
                          onClick={() => startEdit(row)}
                          className="text-indigo-600 hover:text-indigo-700 font-semibold"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteRow(row.id)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="p-4 border-t border-slate-200">
          <Pagination
            page={page}
            pageSize={pageSize}
            total={rows.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            pageSizeOptions={[10, 20, 50]}
          />
        </div>
      </div>
    </div>
  );
}
