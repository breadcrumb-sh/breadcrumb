import { CaretUp, CaretDown } from "@phosphor-icons/react";
import type { ReactNode } from "react";

export type Column<T> = {
  key: string;
  header: string;
  align?: "left" | "right";
  sortable?: boolean;
  render: (row: T) => ReactNode;
};

export type SortState = { key: string; dir: "asc" | "desc" };

export type DataTableProps<T> = {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  sort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
};

export function DataTable<T>({
  columns,
  data,
  rowKey,
  onRowClick,
  sort,
  onSortChange,
}: DataTableProps<T>) {
  const handleHeaderClick = (col: Column<T>) => {
    if (!col.sortable || !onSortChange) return;
    if (sort?.key !== col.key) {
      onSortChange({ key: col.key, dir: "asc" });
    } else if (sort.dir === "asc") {
      onSortChange({ key: col.key, dir: "desc" });
    } else {
      onSortChange(null);
    }
  };

  return (
    <div className="rounded-md border border-zinc-800 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/50">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-2.5 text-xs font-medium text-zinc-500 ${
                  col.align === "right" ? "text-right" : "text-left"
                } ${col.sortable && onSortChange ? "cursor-pointer select-none hover:text-zinc-300" : ""}`}
                onClick={() => handleHeaderClick(col)}
              >
                <span className="inline-flex items-center gap-1">
                  {col.header}
                  {col.sortable && onSortChange && (
                    <span className="inline-flex flex-col items-center -space-y-1 ml-0.5">
                      <CaretUp
                        size={9}
                        weight={sort?.key === col.key && sort.dir === "asc" ? "fill" : "bold"}
                        className={
                          sort?.key === col.key && sort.dir === "asc"
                            ? "text-zinc-100"
                            : "text-zinc-600"
                        }
                      />
                      <CaretDown
                        size={9}
                        weight={sort?.key === col.key && sort.dir === "desc" ? "fill" : "bold"}
                        className={
                          sort?.key === col.key && sort.dir === "desc"
                            ? "text-zinc-100"
                            : "text-zinc-600"
                        }
                      />
                    </span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {data.map((row) => (
            <tr
              key={rowKey(row)}
              className={`hover:bg-zinc-900/50 transition-colors ${onRowClick ? "cursor-pointer" : ""}`}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-4 py-3 ${col.align === "right" ? "text-right" : ""}`}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
