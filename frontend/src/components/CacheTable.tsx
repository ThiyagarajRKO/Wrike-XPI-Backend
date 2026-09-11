import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { DataTable } from "./ui/DataTable";
import { useTable, type ColumnDef } from "./ui/useTable";
import { Badge } from "./ui/Badge";
import { formatBytes } from "../lib/format";

/* The Redis cache table — shared, rather than copied, by the admin console's
 * Cache Settings page (frontend/src/pages/AdminDashboard.tsx) and the portal's
 * (frontend/src/pages/PortalCachePage.tsx). Both render the identical table,
 * so there is one definition of what "the cache table" looks like.
 *
 * It searches on the SERVER: the pattern is a Redis key glob, so filtering
 * client-side would only ever narrow the page already fetched. useTable
 * therefore runs with clientSearch:false and this component debounces the
 * search box into onSearch().
 *
 * That used to be done by reaching into the DataTables-generated search
 * input after init, stripping its ".DT" handlers, rebinding a custom one and
 * re-applying a dozen autocomplete-suppressing attributes by hand.
 *
 * canDelete gates the destructive half: the admin console always has it, a
 * portal user only when their permission matrix grants "cache:delete".
 * Without it the table is a read-only inspector — no selection column, no
 * per-row delete — and the caller should not render a bulk-delete control
 * either.
 */

const SEARCH_DEBOUNCE_MS = 350;

/** The fields this table needs. Both the admin's CacheEntry and the portal's
    PortalCacheEntry satisfy it. */
export interface CacheEntryLike {
  key: string;
  redis_type: string;
  ttl_label: string;
  size_bytes: number;
}

export interface CacheTableProps<T extends CacheEntryLike> {
  entries: T[];
  loading: boolean;
  selectedKeys: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  onView: (key: string) => void;
  onDelete: (key: string) => void;
  onSearch: (pattern: string) => void;
  /** Shows the selection column and each row's Delete button. */
  canDelete?: boolean;
  /** Overrides the default "No cache entries" block — the portal uses it to
      explain that it only lists entries belonging to the caller. */
  empty?: ReactNode;
}

export function CacheTable<T extends CacheEntryLike>({
  entries,
  loading,
  selectedKeys,
  onSelectionChange,
  onView,
  onDelete,
  onSearch,
  canDelete = true,
  empty,
}: CacheTableProps<T>) {
  const allSelected = entries.length > 0 && selectedKeys.size === entries.length;
  const someSelected = selectedKeys.size > 0 && !allSelected;

  const toggleAll = (checked: boolean) => {
    onSelectionChange(checked ? new Set(entries.map((entry) => entry.key)) : new Set());
  };

  const toggleOne = (key: string, checked: boolean) => {
    const next = new Set(selectedKeys);
    if (checked) next.add(key);
    else next.delete(key);
    onSelectionChange(next);
  };

  const columns = useMemo<ColumnDef<T>[]>(() => {
    const cols: ColumnDef<T>[] = [];

    // Selection only means something when there is a destructive action to
    // apply it to.
    if (canDelete) {
      cols.push({
        id: "select",
        width: "42px",
        align: "center",
        header: (
          <input
            type="checkbox"
            checked={allSelected}
            // The tri-state box is a DOM property with no HTML attribute, so
            // it has to be set through a ref callback rather than a prop.
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            onChange={(e) => toggleAll(e.target.checked)}
            aria-label={allSelected ? "Clear selection" : "Select all cache keys"}
          />
        ),
        cell: (entry) => (
          <input
            type="checkbox"
            checked={selectedKeys.has(entry.key)}
            onChange={(e) => toggleOne(entry.key, e.target.checked)}
            aria-label={`Select ${entry.key}`}
          />
        ),
      });
    }

    cols.push(
      {
        id: "key",
        header: "Key",
        accessor: (entry) => entry.key,
        cell: (entry) => (
          <span className="cache-key" title={entry.key}>
            {entry.key}
          </span>
        ),
      },
      {
        id: "redis_type",
        header: "Type",
        accessor: (entry) => entry.redis_type,
        cell: (entry) => <Badge tone="neutral">{entry.redis_type || "unknown"}</Badge>,
      },
      {
        id: "ttl",
        header: "TTL",
        accessor: (entry) => entry.ttl_label,
        cell: (entry) => entry.ttl_label || "Unavailable",
      },
      {
        id: "size_bytes",
        header: "Size",
        accessor: (entry) => entry.size_bytes,
        cell: (entry) => formatBytes(entry.size_bytes),
        searchable: false,
      },
      {
        id: "actions",
        header: "Actions",
        width: canDelete ? "120px" : "64px",
        cell: (entry) => (
          <div className="cache-action-wrap">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              title="View"
              aria-label={`View ${entry.key}`}
              onClick={() => onView(entry.key)}
            >
              <i className="fa-regular fa-eye" aria-hidden="true" />
            </button>
            {canDelete && (
              <button
                type="button"
                className="btn btn-ghost btn-sm cache-delete-btn"
                title="Delete"
                aria-label={`Delete ${entry.key}`}
                onClick={() => onDelete(entry.key)}
              >
                <i className="fa-regular fa-trash-can" aria-hidden="true" />
              </button>
            )}
          </div>
        ),
      },
    );

    return cols;
    // toggleAll/toggleOne close over the current selection, so the columns
    // have to be rebuilt when it changes.
  }, [canDelete, allSelected, someSelected, selectedKeys, entries, onView, onDelete]);

  const table = useTable({
    data: entries,
    columns,
    getRowId: (entry) => entry.key,
    initialPageSize: 10,
    clientSearch: false,
  });

  /* Debounce the search box into the server query. The ref guard keeps the
     first render from firing a redundant fetch for the empty pattern the
     parent has already loaded. */
  const { search } = table;
  const primedRef = useRef(false);

  useEffect(() => {
    if (!primedRef.current) {
      primedRef.current = true;
      return;
    }
    const timer = window.setTimeout(() => onSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search, onSearch]);

  return (
    <DataTable
      table={table}
      caption="Cache keys"
      loading={loading}
      pageSizeOptions={[10, 25, 50, 100]}
      searchPlaceholder="Search cache keys or patterns…"
      empty={
        empty ?? (
          <div className="dt2-empty">
            <div className="dt2-empty-icon">
              <i className="fa-solid fa-database" aria-hidden="true" />
            </div>
            <h3>No cache entries</h3>
            <p>Nothing is cached for this pattern right now.</p>
          </div>
        )
      }
    />
  );
}
