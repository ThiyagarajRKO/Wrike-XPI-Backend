import { useCallback, useDeferredValue, useMemo, useState } from "react";
import type { ReactNode } from "react";

/* Headless table state: filtering, sorting, pagination. Knows nothing about
 * markup, which is what lets <DataTable /> render plain JSX and lets this be
 * unit tested on its own.
 *
 * Replaces the DataTables + jQuery bridge the admin pages used to run. That
 * bridge cost us more than a dependency: rows had to be built as HTML
 * strings, every cell needed manual escaping, and React had no idea the table
 * existed, so a single toggle flip needed a hand-written diff to avoid
 * rebuilding the whole thing.
 *
 * Performance shape, for tables that grow:
 *   - Each row's searchable text is joined ONCE per data change into a
 *     haystack, so typing filters over precomputed strings instead of
 *     re-running every column accessor on every keystroke.
 *   - Sorting runs over an index array with precomputed sort keys, so each
 *     row's accessor is called once per sort rather than O(n log n) times.
 *   - The search term is passed through useDeferredValue, so typing stays
 *     responsive on a large list: React keeps the input live and renders the
 *     filtered body at a lower priority.
 */

export type SortDirection = "asc" | "desc";

export interface SortState {
  columnId: string;
  direction: SortDirection;
}

/** A value a column can be sorted or searched by. */
export type CellValue = string | number | boolean | null | undefined;

export interface ColumnDef<T> {
  /** Stable identity, used for sort state and as the React key. */
  id: string;
  header: ReactNode;
  /**
   * The row's underlying value for this column. Drives sorting and search.
   * A column with no accessor is presentational (actions, checkboxes) and is
   * neither sortable nor searchable unless it opts in explicitly.
   */
  accessor?: (row: T) => CellValue;
  /** Rendered cell. Defaults to the accessor's value as text. */
  cell?: (row: T) => ReactNode;
  sortable?: boolean;
  searchable?: boolean;
  /** Fixed column width, e.g. "64px". */
  width?: string;
  align?: "left" | "center" | "right";
  className?: string;
  headerClassName?: string;
}

export interface UseTableOptions<T> {
  data: readonly T[];
  columns: readonly ColumnDef<T>[];
  getRowId: (row: T) => string;
  initialSort?: SortState | null;
  initialPageSize?: number;
  /** Set false when the caller filters server-side (the cache page does). */
  clientSearch?: boolean;
}

export interface TableRow<T> {
  id: string;
  original: T;
}

export interface TableApi<T> {
  columns: readonly ColumnDef<T>[];
  /** The current page's rows, already filtered and sorted. */
  rows: TableRow<T>[];
  sort: SortState | null;
  toggleSort: (columnId: string) => void;
  search: string;
  setSearch: (value: string) => void;
  /** True while a deferred filter render is still catching up with the input. */
  isFiltering: boolean;
  page: number;
  setPage: (page: number) => void;
  pageSize: number;
  setPageSize: (size: number) => void;
  pageCount: number;
  /** Rows matching the current search, before pagination. */
  filteredCount: number;
  /** Rows in the source data, before any filtering. */
  totalCount: number;
  /** 1-based inclusive range shown on this page; both 0 when empty. */
  range: { start: number; end: number };
}

const isSortable = <T,>(column: ColumnDef<T>) => column.sortable ?? !!column.accessor;
const isSearchable = <T,>(column: ColumnDef<T>) => column.searchable ?? !!column.accessor;

/* Numeric-aware and locale-aware, so "env 10" sorts after "env 9" and
 * accented names land where a reader expects. Built once: constructing a
 * collator per comparison is a well-known sorting hot spot. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareValues(a: CellValue, b: CellValue): number {
  // Null and undefined always sort last, whichever direction is active, so a
  // column of mostly-empty values doesn't bury the real ones.
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);

  return collator.compare(String(a), String(b));
}

export function useTable<T>({
  data,
  columns,
  getRowId,
  initialSort = null,
  initialPageSize = 10,
  clientSearch = true,
}: UseTableOptions<T>): TableApi<T> {
  const [sort, setSort] = useState<SortState | null>(initialSort);
  const [search, setSearchRaw] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeRaw] = useState(initialPageSize);

  // Keeps the input responsive while the filtered body renders behind it.
  const deferredSearch = useDeferredValue(search);
  const isFiltering = search !== deferredSearch;

  const searchableColumns = useMemo(
    () => columns.filter((column) => isSearchable(column) && column.accessor),
    [columns],
  );

  /* One haystack per row, rebuilt only when the data or the searchable column
     set changes — not on every keystroke. */
  const haystacks = useMemo(() => {
    if (!clientSearch || searchableColumns.length === 0) return null;
    return data.map((row) =>
      searchableColumns
        .map((column) => {
          const value = column.accessor!(row);
          return value === null || value === undefined ? "" : String(value);
        })
        .join(" ")
        .toLowerCase(),
    );
  }, [data, searchableColumns, clientSearch]);

  const filtered = useMemo(() => {
    const term = deferredSearch.trim().toLowerCase();
    if (!term || !haystacks) return data as T[];
    return (data as T[]).filter((_, index) => haystacks[index].includes(term));
  }, [data, haystacks, deferredSearch]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const column = columns.find((c) => c.id === sort.columnId);
    if (!column?.accessor || !isSortable(column)) return filtered;

    // Decorate-sort-undecorate: the accessor runs once per row, not once per
    // comparison, and the index tiebreak keeps the sort stable.
    const accessor = column.accessor;
    const decorated = filtered.map((row, index) => ({ row, index, key: accessor(row) }));
    const direction = sort.direction === "asc" ? 1 : -1;

    decorated.sort((a, b) => {
      const result = compareValues(a.key, b.key);
      return result !== 0 ? result * direction : a.index - b.index;
    });

    return decorated.map((entry) => entry.row);
  }, [filtered, sort, columns]);

  const filteredCount = sorted.length;
  const pageCount = Math.max(1, Math.ceil(filteredCount / pageSize));

  /* Derived, never stored: if a delete or a filter shrinks the list past the
     current page, clamp during render instead of firing a correcting setState
     from an effect (which would paint an empty page for one frame first). */
  const safePage = Math.min(page, pageCount);

  const rows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sorted
      .slice(start, start + pageSize)
      .map((row) => ({ id: getRowId(row), original: row }));
  }, [sorted, safePage, pageSize, getRowId]);

  const toggleSort = useCallback(
    (columnId: string) => {
      const column = columns.find((c) => c.id === columnId);
      if (!column || !isSortable(column)) return;

      setSort((current) => {
        if (current?.columnId !== columnId) return { columnId, direction: "asc" };
        // asc -> desc -> unsorted, so a user can always get back to the
        // server's original ordering without reloading.
        if (current.direction === "asc") return { columnId, direction: "desc" };
        return null;
      });
      setPage(1);
    },
    [columns],
  );

  const setSearch = useCallback((value: string) => {
    setSearchRaw(value);
    setPage(1);
  }, []);

  const setPageSize = useCallback((size: number) => {
    setPageSizeRaw(size);
    setPage(1);
  }, []);

  const range = useMemo(() => {
    if (filteredCount === 0) return { start: 0, end: 0 };
    const start = (safePage - 1) * pageSize + 1;
    return { start, end: Math.min(start + pageSize - 1, filteredCount) };
  }, [safePage, pageSize, filteredCount]);

  return {
    columns,
    rows,
    sort,
    toggleSort,
    search,
    setSearch,
    isFiltering,
    page: safePage,
    setPage,
    pageSize,
    setPageSize,
    pageCount,
    filteredCount,
    totalCount: data.length,
    range,
  };
}
