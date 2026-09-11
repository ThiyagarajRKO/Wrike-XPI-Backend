import { useMemo } from "react";
import type { PortalEnvironmentFull } from "../lib/portalAuthApi";
import { DataTable } from "../components/ui/DataTable";
import { useTable, type ColumnDef } from "../components/ui/useTable";
import { RowMenu } from "../components/ui/RowMenu";
import { ActiveBadge, Badge } from "../components/ui/Badge";
import { EMPTY, dateSortValue, formatDateTime } from "../lib/format";

/* The portal user's "My Environments" table — same useTable/DataTable/RowMenu
 * stack as frontend/src/pages/admin/PortalUsersTable.tsx, replacing the old
 * jQuery + DataTables imperative bridge that built rows as HTML strings.
 * Edit/Delete are per-row menu items rather than inline buttons so this
 * matches the admin console's row-action style, and each item is present
 * only when the portal permission matrix grants that action — mirrors
 * PortalUsersTable's onToggleStatus-style closures, just gated by `can`. */

export interface PortalEnvironmentsTableProps {
  environments: PortalEnvironmentFull[];
  loading: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: (env: PortalEnvironmentFull) => void;
  onDelete: (env: PortalEnvironmentFull) => void;
  onAdd: () => void;
}

function maskSecret(value: string | null | undefined): string {
  if (!value) return EMPTY;
  return value.slice(0, Math.min(6, value.length)) + "••••••";
}

export function PortalEnvironmentsTable({
  environments,
  loading,
  canUpdate,
  canDelete,
  onEdit,
  onDelete,
  onAdd,
}: PortalEnvironmentsTableProps) {
  const columns = useMemo<ColumnDef<PortalEnvironmentFull>[]>(() => {
    const cols: ColumnDef<PortalEnvironmentFull>[] = [
      {
        id: "environment_name",
        header: "Environment",
        accessor: (env) => env.environment_name,
        cell: (env) => <strong>{env.environment_name}</strong>,
      },
      {
        id: "id",
        header: "Env ID",
        accessor: (env) => env.id,
        cell: (env) => <code style={{ fontSize: 11, color: "var(--text-muted)" }}>{env.id}</code>,
      },
      {
        id: "client_id",
        header: "Client ID",
        accessor: (env) => env.client_id,
        cell: (env) => <span className="mval">{maskSecret(env.client_id)}</span>,
        searchable: false,
      },
      {
        id: "created_at",
        header: "Created",
        accessor: (env) => dateSortValue(env.created_at),
        cell: (env) => <span className="pu-muted-cell">{formatDateTime(env.created_at)}</span>,
        searchable: false,
      },
      {
        id: "updated_at",
        header: "Last Updated",
        accessor: (env) => dateSortValue(env.updated_at),
        cell: (env) => <span className="pu-muted-cell">{formatDateTime(env.updated_at)}</span>,
        searchable: false,
      },
      {
        id: "is_visible",
        header: "Visibility",
        accessor: (env) => env.is_visible,
        cell: (env) =>
          env.is_visible ? (
            <Badge tone="success" dot>
              Visible
            </Badge>
          ) : (
            <Badge tone="warning" dot>
              Hidden
            </Badge>
          ),
      },
      {
        id: "is_active",
        header: "Status",
        accessor: (env) => env.is_active,
        cell: (env) => <ActiveBadge active={env.is_active} />,
      },
    ];

    // Actions column only exists at all if there's at least one action this
    // user can take — an empty RowMenu with zero items would just be a
    // trigger that opens nothing.
    if (canUpdate || canDelete) {
      cols.push({
        id: "actions",
        header: "Actions",
        width: "64px",
        align: "center",
        className: "pu-actions-col",
        headerClassName: "pu-actions-col",
        cell: (env) => (
          <RowMenu
            label={`Actions for ${env.environment_name}`}
            items={[
              ...(canUpdate
                ? [
                    {
                      label: "Edit",
                      icon: "fa-solid fa-pen-to-square",
                      onSelect: () => onEdit(env),
                    },
                  ]
                : []),
              ...(canDelete
                ? [
                    {
                      label: "Delete",
                      icon: "fa-solid fa-trash",
                      danger: true,
                      onSelect: () => onDelete(env),
                    },
                  ]
                : []),
            ]}
          />
        ),
      });
    }

    return cols;
  }, [canUpdate, canDelete, onEdit, onDelete]);

  const table = useTable({
    data: environments,
    columns,
    getRowId: (env) => env.id,
    initialSort: { columnId: "environment_name", direction: "asc" },
    initialPageSize: 10,
  });

  return (
    <DataTable
      table={table}
      caption="My environments"
      loading={loading}
      searchPlaceholder="Search environments…"
      empty={
        <div className="dt2-empty">
          <div className="dt2-empty-icon">
            <i className="fa-regular fa-folder-open" aria-hidden="true" />
          </div>
          <h3>No environments yet</h3>
          {canUpdate || canDelete ? (
            <>
              <p>Click Add Environment to create your first one.</p>
              <button type="button" className="btn btn-primary" onClick={onAdd}>
                <i className="fa-solid fa-plus" aria-hidden="true" /> Add Environment
              </button>
            </>
          ) : (
            <p>No environments have been shared with you yet.</p>
          )}
        </div>
      }
    />
  );
}
