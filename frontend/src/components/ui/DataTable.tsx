import { memo, useId } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { ColumnDef, TableApi } from "./useTable";
import "./DataTable.css";

/* Renders the state produced by useTable. Deliberately dumb: no fetching, no
 * data shaping, no imperative DOM. The whole table is one React tree, so a
 * row's buttons are ordinary onClick handlers closing over the row object
 * rather than data-attribute lookups through a delegated jQuery listener. */

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100];

export interface DataTableProps<T> {
  table: TableApi<T>;
  /** Shown when the source data is empty (as opposed to filtered to nothing). */
  empty?: ReactNode;
  /** Skipped entirely while the first fetch is in flight. */
  loading?: boolean;
  searchPlaceholder?: string;
  /** Rendered between the search box and the row-count select. */
  toolbar?: ReactNode;
  pageSizeOptions?: number[];
  /** Extra class on the <table>, for page-specific column rules. */
  className?: string;
  /** Stable label for assistive tech, e.g. "Environments". */
  caption: string;
}

function cellContent<T>(column: ColumnDef<T>, row: T): ReactNode {
  if (column.cell) return column.cell(row);
  const value = column.accessor?.(row);
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

/* Memoized so re-rendering the page (a modal opening, an unrelated state
   change) doesn't re-render every cell of every row. */
const TableBodyRow = memo(function TableBodyRow<T>({
  row,
  columns,
  rowIndex,
}: {
  row: T;
  columns: readonly ColumnDef<T>[];
  rowIndex: number;
}) {
  return (
    <tr style={{ "--row-index": rowIndex } as CSSProperties}>
      {columns.map((column) => (
        <td
          key={column.id}
          className={column.className}
          style={column.align ? { textAlign: column.align } : undefined}
        >
          {cellContent(column, row)}
        </td>
      ))}
    </tr>
  );
  // memo() erases the generic, so the cast restores it for callers. React 19
  // dropped the global JSX namespace, hence ReactElement rather than
  // JSX.Element.
}) as <T>(props: { row: T; columns: readonly ColumnDef<T>[]; rowIndex: number }) => ReactElement;

export function DataTable<T>({
  table,
  empty,
  loading = false,
  searchPlaceholder = "Search…",
  toolbar,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  className,
  caption,
}: DataTableProps<T>) {
  const searchId = useId();
  const sizeId = useId();

  const { columns, rows, sort, toggleSort, page, pageCount, range, filteredCount, totalCount } =
    table;

  const showingEmptySource = !loading && totalCount === 0;
  const showingNoMatches = !loading && totalCount > 0 && filteredCount === 0;

  return (
    <div className="dt2">
      <div className="dt2-toolbar">
        <div className="dt2-search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
          <input
            id={searchId}
            type="search"
            value={table.search}
            onChange={(e) => table.setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={`Search ${caption.toLowerCase()}`}
            autoComplete="off"
            spellCheck={false}
            data-lpignore="true"
            data-1p-ignore="true"
          />
          {table.search && (
            <button
              type="button"
              className="dt2-search-clear"
              onClick={() => table.setSearch("")}
              aria-label="Clear search"
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          )}
        </div>

        {toolbar}

        <label className="dt2-pagesize" htmlFor={sizeId}>
          <span>Rows</span>
          <select
            id={sizeId}
            value={table.pageSize}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="dt2-scroll">
        <table className={`dt2-table${className ? ` ${className}` : ""}`}>
          <caption className="dt2-caption">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => {
                const sortable = column.sortable ?? !!column.accessor;
                const active = sort?.columnId === column.id;
                return (
                  <th
                    key={column.id}
                    className={column.headerClassName}
                    style={{
                      width: column.width,
                      textAlign: column.align,
                    }}
                    aria-sort={
                      active ? (sort!.direction === "asc" ? "ascending" : "descending") : undefined
                    }
                  >
                    {sortable ? (
                      <button
                        type="button"
                        className={`dt2-sort${active ? " active" : ""}`}
                        onClick={() => toggleSort(column.id)}
                      >
                        <span>{column.header}</span>
                        <i
                          className={`fa-solid ${
                            active
                              ? sort!.direction === "asc"
                                ? "fa-arrow-up-short-wide"
                                : "fa-arrow-down-wide-short"
                              : "fa-sort"
                          }`}
                          aria-hidden="true"
                        />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className={table.isFiltering ? "dt2-stale" : undefined}>
            {loading &&
              Array.from({ length: 5 }, (_, i) => (
                <tr key={`skeleton-${i}`} className="dt2-skeleton-row">
                  {columns.map((column) => (
                    <td key={column.id}>
                      <span className="dt2-skeleton" />
                    </td>
                  ))}
                </tr>
              ))}

            {showingEmptySource && (
              <tr>
                <td colSpan={columns.length} className="dt2-empty-cell">
                  {empty ?? <div className="dt2-empty">Nothing to show yet.</div>}
                </td>
              </tr>
            )}

            {showingNoMatches && (
              <tr>
                <td colSpan={columns.length} className="dt2-empty-cell">
                  <div className="dt2-empty">
                    <div className="dt2-empty-icon">
                      <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
                    </div>
                    <h3>No matches</h3>
                    <p>Nothing here matches "{table.search}".</p>
                  </div>
                </td>
              </tr>
            )}

            {!loading &&
              rows.map((row, index) => (
                <TableBodyRow
                  key={row.id}
                  row={row.original}
                  columns={columns}
                  rowIndex={index}
                />
              ))}
          </tbody>
        </table>
      </div>

      {!loading && filteredCount > 0 && (
        <div className="dt2-footer">
          <div className="dt2-info">
            Showing {range.start} to {range.end} of {filteredCount}
            {filteredCount !== totalCount && <span className="dt2-info-muted"> (of {totalCount})</span>}
          </div>

          {pageCount > 1 && (
            <nav className="dt2-pager" aria-label={`${caption} pagination`}>
              <button
                type="button"
                onClick={() => table.setPage(page - 1)}
                disabled={page <= 1}
                aria-label="Previous page"
              >
                <i className="fa-solid fa-chevron-left" aria-hidden="true" />
              </button>
              <span className="dt2-pager-status">
                Page {page} of {pageCount}
              </span>
              <button
                type="button"
                onClick={() => table.setPage(page + 1)}
                disabled={page >= pageCount}
                aria-label="Next page"
              >
                <i className="fa-solid fa-chevron-right" aria-hidden="true" />
              </button>
            </nav>
          )}
        </div>
      )}
    </div>
  );
}
