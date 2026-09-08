import { useMemo } from "react";
import type { PortalUser } from "../../lib/adminApi";
import { DataTable } from "../../components/ui/DataTable";
import { useTable, type ColumnDef } from "../../components/ui/useTable";
import { RowMenu } from "../../components/ui/RowMenu";
import { ActiveBadge, Badge } from "../../components/ui/Badge";
import { EMPTY, dateSortValue, formatDate } from "../../lib/format";

/* The Portal Users table. Replaces puRowHtml() plus PU_TABLE_HEAD and the
 * delegated row-menu handler that read the user id, username and active flag
 * back out of data-attributes (and had to coerce data-active from the string
 * "true"). Here the menu closes over the user object directly. */

export interface PortalUsersTableProps {
  users: PortalUser[];
  loading: boolean;
  onPermissions: (user: PortalUser) => void;
  onEdit: (user: PortalUser) => void;
  onResetPassword: (user: PortalUser) => void;
  onMapEnvironment: (user: PortalUser) => void;
  onToggleStatus: (user: PortalUser, nextActive: boolean) => void;
  onAdd: () => void;
}

export function PortalUsersTable({
  users,
  loading,
  onPermissions,
  onEdit,
  onResetPassword,
  onMapEnvironment,
  onToggleStatus,
  onAdd,
}: PortalUsersTableProps) {
  const columns = useMemo<ColumnDef<PortalUser>[]>(
    () => [
      {
        id: "username",
        header: "Username",
        accessor: (user) => user.username,
        cell: (user) => <strong>{user.username}</strong>,
      },
      {
        id: "full_name",
        header: "Full Name",
        accessor: (user) => user.full_name,
        cell: (user) =>
          user.full_name ? user.full_name : <span className="text-muted">{EMPTY}</span>,
      },
      {
        id: "email",
        header: "Email",
        accessor: (user) => user.email,
        className: "pu-email-cell",
        cell: (user) => (user.email ? user.email : <span className="text-muted">{EMPTY}</span>),
      },
      {
        id: "role",
        header: "Role",
        accessor: (user) => user.role,
        cell: (user) =>
          user.role === "admin" ? (
            <Badge tone="info" icon="fa-solid fa-shield-halved">
              Admin
            </Badge>
          ) : (
            <Badge tone="neutral" icon="fa-solid fa-user">
              User
            </Badge>
          ),
      },
      {
        id: "last_login_at",
        header: "Last Login",
        accessor: (user) => dateSortValue(user.last_login_at),
        cell: (user) => <span className="pu-muted-cell">{formatDate(user.last_login_at)}</span>,
        searchable: false,
      },
      {
        id: "is_active",
        header: "Status",
        accessor: (user) => user.is_active,
        cell: (user) => <ActiveBadge active={user.is_active} />,
      },
      {
        id: "must_change_password",
        header: "Must Change Pwd",
        accessor: (user) => user.must_change_password,
        cell: (user) =>
          user.must_change_password ? (
            <Badge tone="warning" icon="fa-solid fa-clock">
              Pending
            </Badge>
          ) : (
            <Badge tone="success" icon="fa-solid fa-check">
              Set
            </Badge>
          ),
      },
      {
        id: "actions",
        header: "Actions",
        width: "64px",
        align: "center",
        className: "pu-actions-col",
        headerClassName: "pu-actions-col",
        cell: (user) => (
          <RowMenu
            label={`Actions for ${user.username}`}
            items={[
              {
                label: "Permissions",
                icon: "fa-solid fa-user-shield",
                onSelect: () => onPermissions(user),
              },
              {
                label: "Edit",
                icon: "fa-solid fa-pen-to-square",
                onSelect: () => onEdit(user),
              },
              {
                label: "Reset Password",
                icon: "fa-solid fa-key",
                onSelect: () => onResetPassword(user),
              },
              {
                label: "Map Environment",
                icon: "fa-solid fa-diagram-project",
                onSelect: () => onMapEnvironment(user),
              },
              user.is_active
                ? {
                    label: "Disable",
                    icon: "fa-solid fa-ban",
                    danger: true,
                    onSelect: () => onToggleStatus(user, false),
                  }
                : {
                    label: "Enable",
                    icon: "fa-solid fa-circle-check",
                    onSelect: () => onToggleStatus(user, true),
                  },
            ]}
          />
        ),
      },
    ],
    [onPermissions, onEdit, onResetPassword, onMapEnvironment, onToggleStatus],
  );

  const table = useTable({
    data: users,
    columns,
    getRowId: (user) => user.id,
    initialSort: { columnId: "username", direction: "asc" },
    initialPageSize: 10,
  });

  return (
    <DataTable
      table={table}
      caption="Portal users"
      loading={loading}
      className="pu-table"
      searchPlaceholder="Search users…"
      empty={
        <div className="dt2-empty">
          <div className="dt2-empty-icon">
            <i className="fa-solid fa-users" aria-hidden="true" />
          </div>
          <h3>No portal users yet</h3>
          <p>Create an account to give someone access to the portal.</p>
          <button type="button" className="btn btn-primary" onClick={onAdd}>
            <i className="fa-solid fa-plus" aria-hidden="true" /> Add User
          </button>
        </div>
      }
    />
  );
}
