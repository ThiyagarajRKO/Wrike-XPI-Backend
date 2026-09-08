import { useMemo } from "react";
import type { AdminEnvironment } from "../../lib/adminApi";
import { DataTable } from "../../components/ui/DataTable";
import { useTable, type ColumnDef } from "../../components/ui/useTable";
import { RowMenu } from "../../components/ui/RowMenu";
import { CopyButton } from "../../components/ui/CopyButton";
import { Toggle } from "../../components/ui/Toggle";
import { EMPTY, dateSortValue, formatDateTime } from "../../lib/format";

/* The Environments table.
 *
 * Everything here used to be produced by envRowHtml(), a 45-line string
 * concatenation fed to DataTables, with the row's buttons wired through
 * delegated jQuery handlers that read the environment id back out of a
 * data-attribute. The columns below render the same table declaratively, so
 * each button closes over the actual row object. */

export interface EnvironmentsTableProps {
  environments: AdminEnvironment[];
  loading: boolean;
  onEdit: (env: AdminEnvironment) => void;
  onDuplicate: (env: AdminEnvironment) => void;
  onDelete: (env: AdminEnvironment) => void;
  onOpenAccess: (env: AdminEnvironment) => void;
  onToggle: (
    env: AdminEnvironment,
    field: "is_active" | "is_visible",
    next: boolean,
  ) => Promise<void>;
  onAdd: () => void;
}

export function EnvironmentsTable({
  environments,
  loading,
  onEdit,
  onDuplicate,
  onDelete,
  onOpenAccess,
  onToggle,
  onAdd,
}: EnvironmentsTableProps) {
  const columns = useMemo<ColumnDef<AdminEnvironment>[]>(
    () => [
      {
        id: "environment_name",
        header: "Environment",
        accessor: (env) => env.environment_name,
        cell: (env) => (
          <div className="env-name-cell">
            <strong>{env.environment_name}</strong>
            <div className="action-cell env-id-row">
              <code className="env-id-code">{env.id}</code>
              <CopyButton value={env.id} title="Copy ID" />
            </div>
          </div>
        ),
      },
      {
        id: "client_id",
        header: "Client ID",
        accessor: (env) => env.client_id,
      },
      {
        id: "account_id",
        header: "Account ID",
        accessor: (env) => env.account_id,
        cell: (env) =>
          env.account_id ? (
            env.account_id
          ) : (
            <span className="text-muted">{EMPTY}</span>
          ),
      },
      {
        id: "updated_at",
        header: "Last Updated",
        // Sorts on the timestamp, displays the formatted date: sorting the
        // rendered string would order "Apr" before "Jan".
        accessor: (env) => dateSortValue(env.updated_at),
        cell: (env) => formatDateTime(env.updated_at),
        searchable: false,
      },
      {
        id: "is_visible",
        header: "Visibility",
        width: "92px",
        sortable: false,
        cell: (env) => (
          <Toggle
            size="sm"
            checked={env.is_visible}
            title={env.is_visible ? "Visible in the portal" : "Hidden from the portal"}
            ariaLabel={`Visibility for ${env.environment_name}`}
            onToggle={(next) => onToggle(env, "is_visible", next)}
          />
        ),
      },
      {
        id: "is_active",
        header: "Status",
        width: "92px",
        sortable: false,
        cell: (env) => (
          <Toggle
            size="sm"
            checked={env.is_active}
            title={env.is_active ? "Environment enabled" : "Environment disabled"}
            ariaLabel={`Status for ${env.environment_name}`}
            onToggle={(next) => onToggle(env, "is_active", next)}
          />
        ),
      },
      {
        id: "actions",
        header: "Actions",
        width: "64px",
        align: "center",
        className: "env-actions-col",
        headerClassName: "env-actions-col",
        cell: (env) => (
          <RowMenu
            label={`Actions for ${env.environment_name}`}
            items={[
              {
                label: "API access scope",
                icon: "fa-solid fa-shield-halved",
                onSelect: () => onOpenAccess(env),
              },
              {
                label: "Edit",
                icon: "fa-solid fa-pen-to-square",
                onSelect: () => onEdit(env),
              },
              {
                label: "Duplicate",
                icon: "fa-regular fa-clone",
                onSelect: () => onDuplicate(env),
              },
              {
                label: "Delete",
                icon: "fa-solid fa-trash",
                danger: true,
                onSelect: () => onDelete(env),
              },
            ]}
          />
        ),
      },
    ],
    [onEdit, onDuplicate, onDelete, onOpenAccess, onToggle],
  );

  const table = useTable({
    data: environments,
    columns,
    getRowId: (env) => env.id,
    initialPageSize: 10,
  });

  return (
    <DataTable
      table={table}
      caption="Environments"
      loading={loading}
      className="env-table"
      searchPlaceholder="Search environments…"
      empty={
        <div className="dt2-empty">
          <div className="dt2-empty-icon">
            <i className="fa-regular fa-folder-open" aria-hidden="true" />
          </div>
          <h3>No environments yet</h3>
          <p>Add the first environment to start issuing tokens.</p>
          <button type="button" className="btn btn-primary" onClick={onAdd}>
            <i className="fa-solid fa-plus" aria-hidden="true" /> Add Environment
          </button>
        </div>
      }
    />
  );
}
