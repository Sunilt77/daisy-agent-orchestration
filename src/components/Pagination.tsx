import React from 'react';

type PaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  className?: string;
};

function buildPageItems(current: number, totalPages: number) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

  const items: Array<number | string> = [];
  const windowStart = Math.max(2, current - 1);
  const windowEnd = Math.min(totalPages - 1, current + 1);

  items.push(1);
  if (windowStart > 2) items.push('...');
  for (let i = windowStart; i <= windowEnd; i++) items.push(i);
  if (windowEnd < totalPages - 1) items.push('...');
  items.push(totalPages);
  return items;
}

export default function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50],
  className = '',
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const start = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, total);
  const pageItems = buildPageItems(currentPage, totalPages);

  return (
    <div className={`panel-chrome rounded-2xl px-3 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${className}`}>
      <div className="text-xs text-slate-500">
        Showing <span className="font-semibold text-slate-800">{start}</span>–<span className="font-semibold text-slate-800">{end}</span> of{' '}
        <span className="font-semibold text-slate-800">{total}</span>
      </div>
      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <select
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 shadow-sm"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
          >
            {pageSizeOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}/page
              </option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className="px-2.5 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg disabled:opacity-50 hover:bg-slate-50 text-slate-700"
          >
            Prev
          </button>
          {pageItems.map((item, idx) =>
            item === '...' ? (
              <span key={`ellipsis-${idx}`} className="px-2 text-xs text-slate-400">
                …
              </span>
            ) : (
              <button
                key={item}
                type="button"
                onClick={() => onPageChange(Number(item))}
                className={`px-2.5 py-1.5 text-xs font-semibold border rounded-lg ${
                  item === currentPage
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {item}
              </button>
            )
          )}
          <button
            type="button"
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
            className="px-2.5 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg disabled:opacity-50 hover:bg-slate-50 text-slate-700"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
