"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Header } from "@/components/layout/Header";
import { DataTable } from "@/components/shared/DataTable";
import { RoleGuard } from "@/components/layout/RoleGuard";
import { AuditTrail } from "@/components/shared/AuditTrail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ErrorState } from "@/components/shared/ErrorState";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, MoreHorizontal, Pencil, Trash2, Loader2, Search, UserCheck, UserX, UserCog } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/providers/confirm-provider";

import { useSession } from "next-auth/react";
import type { UserRole } from "@/types";

interface StaffUser {
  _id: string;
  name: string;
  email: string;
  role: UserRole;
  branchIds: string[];
  organizationId?: { _id: string; name: string } | null;
  phone?: string;
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
  permissions?: string[];
}

interface PermissionDefinition {
  key: string;
  label: string;
  description: string;
  group: string;
}

interface Branch {
  _id: string;
  name: string;
  code: string;
}

interface CreateForm {
  name: string;
  email: string;
  password: string;
  role: UserRole | "";
  branchIds: string[];
  organizationId: string;
  phone: string;
}

interface EditForm {
  name: string;
  role: UserRole | "";
  branchIds: string[];
  organizationId: string;
  phone: string;
  isActive: boolean;
  permissions: string[];
}

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "ADMIN", label: "Admin" },
  { value: "ORG_ADMIN", label: "Org Admin" },
  { value: "BRANCH_MANAGER", label: "Branch Manager" },
  { value: "STAFF", label: "Staff" },
  { value: "INVENTORY_MANAGER", label: "Inventory Manager" },
  { value: "MEMBER", label: "Member" },
];

const ROLE_VARIANT: Record<UserRole, "default" | "secondary" | "outline" | "success" | "destructive"> = {
  ADMIN: "default",
  ORG_ADMIN: "secondary",
  BRANCH_MANAGER: "secondary",
  STAFF: "outline",
  INVENTORY_MANAGER: "secondary",
  MEMBER: "outline",
  CUSTOMER: "outline",
};

const defaultCreate: CreateForm = {
  name: "",
  email: "",
  password: "",
  role: "",
  branchIds: [],
  organizationId: "",
  phone: "",
};

const defaultEdit: EditForm = {
  name: "",
  role: "",
  branchIds: [],
  organizationId: "",
  phone: "",
  isActive: true,
  permissions: [],
};

const ORG_ADMIN_ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "BRANCH_MANAGER", label: "Branch Manager" },
  { value: "STAFF", label: "Staff" },
  { value: "INVENTORY_MANAGER", label: "Inventory Manager" },
];

/** Role filter on user list (full admin includes shop-only accounts). */
const ROLE_FILTER_OPTIONS_ADMIN: { value: UserRole; label: string }[] = [
  ...ROLE_OPTIONS,
  { value: "CUSTOMER", label: "Shop customer" },
];

export default function UsersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const isOrgAdmin = session?.user?.role === "ORG_ADMIN";
  const sessionOrgId = session?.user?.organizationId ?? "";

  const availableRoleOptions = isOrgAdmin ? ORG_ADMIN_ROLE_OPTIONS : ROLE_OPTIONS;
  const roleFilterSelectOptions = isOrgAdmin ? ORG_ADMIN_ROLE_OPTIONS : ROLE_FILTER_OPTIONS_ADMIN;

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CreateForm>(defaultCreate);
  const [editForm, setEditForm] = useState<EditForm>(defaultEdit);
  const [formError, setFormError] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [originalPermissions, setOriginalPermissions] = useState<string[]>([]);
  const [originalRole, setOriginalRole] = useState<UserRole | "">("");

  const canManageRoles = session?.user?.role === "ADMIN" || (session?.user?.permissions?.includes("manage:roles") ?? false);

  const { data: permissionCatalog = [] } = useQuery({
    queryKey: ["permission-catalog"],
    queryFn: async () => {
      const res = await fetch("/api/admin/roles");
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Failed to load permissions");
      return (json.data?.catalog ?? []) as PermissionDefinition[];
    },
    enabled: canManageRoles,
    staleTime: 5 * 60_000,
  });

  const permissionsByGroup = useMemo(() => {
    const groups = new Map<string, PermissionDefinition[]>();
    for (const p of permissionCatalog) {
      const list = groups.get(p.group) ?? [];
      list.push(p);
      groups.set(p.group, list);
    }
    return groups;
  }, [permissionCatalog]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, roleFilter]);

  const { data: usersResult, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["users", debouncedSearch, roleFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (roleFilter && roleFilter !== "all") params.set("role", roleFilter);
      params.set("page", String(page));
      const res = await fetch(`/api/users?${params}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? `Failed to load users (${res.status})`);
      return json as {
        data: StaffUser[];
        meta?: { total?: number; page?: number; limit?: number };
      };
    },
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const { data: branches = [] } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => {
      const res = await fetch("/api/branches");
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? `Failed to load branches (${res.status})`);
      return (json.data ?? []) as Branch[];
    },
    staleTime: 5 * 60_000,
  });

  const { data: organizations = [] } = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => {
      const res = await fetch("/api/organizations");
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? `Failed to load organizations (${res.status})`);
      return (json.data ?? []) as { _id: string; name: string; type: string }[];
    },
    enabled: !isOrgAdmin,
    staleTime: 5 * 60_000,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast({ title: "User created successfully" });
      setCreateOpen(false);
      setCreateForm(defaultCreate);
      setFormError("");
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const permissionsDirty =
        editForm.role === originalRole &&
        (editForm.permissions.length !== originalPermissions.length ||
          editForm.permissions.some((p) => !originalPermissions.includes(p)));
      const payload: Record<string, unknown> = { ...editForm };
      if (!permissionsDirty) delete payload.permissions;

      const res = await fetch(`/api/users/${editId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast({ title: "User updated successfully" });
      setEditOpen(false);
      setEditId(null);
      setFormError("");
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast({ title: "User removed" });
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch("/api/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data.data as { deletedIds: string[]; failures: { id: string; reason: string }[] };
    },
    onSuccess: (data, ids) => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setSelectedIds([]);
      setBulkDeleteOpen(false);
      if (data.failures.length > 0) {
        toast({
          title: `${data.deletedIds.length} of ${ids.length} users removed`,
          description: data.failures.map((f) => f.reason).join(", "),
          variant: "destructive",
        });
      } else {
        toast({ title: `${data.deletedIds.length} user${data.deletedIds.length === 1 ? "" : "s"} removed` });
      }
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast({ title: "User status updated" });
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const impersonateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: id }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data.data as { redirectTo: string };
    },
    onSuccess: (data) => {
      window.location.href = data.redirectTo || "/";
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const impersonateUser = useCallback(
    async (user: StaffUser) => {
      const ok = await confirm({
        title: `View as "${user.name}"?`,
        description: "You'll be signed in as this user until you return to your admin session.",
      });
      if (ok) impersonateMutation.mutate(user._id);
    },
    [confirm, impersonateMutation]
  );

  const openEdit = useCallback((user: StaffUser) => {
    setEditId(user._id);
    setEditForm({
      name: user.name,
      role: user.role,
      branchIds: user.branchIds,
      organizationId: user.organizationId?._id ?? "",
      phone: user.phone ?? "",
      isActive: user.isActive,
      permissions: user.permissions ?? [],
    });
    setOriginalPermissions(user.permissions ?? []);
    setOriginalRole(user.role);
    setFormError("");
    setEditOpen(true);
  }, []);

  function togglePermission(key: string) {
    setEditForm((f) => ({
      ...f,
      permissions: f.permissions.includes(key)
        ? f.permissions.filter((p) => p !== key)
        : [...f.permissions, key],
    }));
  }

  function toggleBranch(branchId: string, form: CreateForm | EditForm, setForm: (f: CreateForm | EditForm) => void) {
    const ids = form.branchIds.includes(branchId)
      ? form.branchIds.filter((id) => id !== branchId)
      : [...form.branchIds, branchId];
    setForm({ ...form, branchIds: ids });
  }

  const users = usersResult?.data ?? [];
  const usersTotal = usersResult?.meta?.total ?? users.length;
  const usersLimit = usersResult?.meta?.limit ?? 20;
  const usersTotalPages = Math.max(1, Math.ceil(usersTotal / usersLimit));

  const deleteUser = useCallback(
    async (user: StaffUser) => {
      const ok = await confirm({
        title: `Remove "${user.name}"?`,
        description: "This permanently removes the user account. This cannot be undone.",
        variant: "destructive",
      });
      if (ok) deleteMutation.mutate(user._id);
    },
    [confirm, deleteMutation]
  );

  const toggleActiveUser = useCallback(
    async (user: StaffUser) => {
      const activating = !user.isActive;
      const ok = await confirm({
        title: activating ? `Activate "${user.name}"?` : `Deactivate "${user.name}"?`,
        variant: activating ? "default" : "destructive",
        confirmText: activating ? "Activate" : "Deactivate",
      });
      if (ok) toggleActiveMutation.mutate({ id: user._id, isActive: activating });
    },
    [confirm, toggleActiveMutation]
  );

  const isSelectable = useCallback(
    (u: StaffUser) => u._id !== currentUserId && u.role !== "ADMIN",
    [currentUserId]
  );

  const selectableUsers = useMemo(() => users.filter(isSelectable), [users, isSelectable]);
  const allSelectableSelected =
    selectableUsers.length > 0 && selectableUsers.every((u) => selectedIds.includes(u._id));

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) =>
      allSelectableSelected
        ? prev.filter((id) => !selectableUsers.some((u) => u._id === id))
        : Array.from(new Set([...prev, ...selectableUsers.map((u) => u._id)]))
    );
  }, [allSelectableSelected, selectableUsers]);

  const toggleSelectOne = useCallback((id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const columns = useMemo(() => [
    {
      key: "select",
      label: (
        <Checkbox
          checked={allSelectableSelected}
          onCheckedChange={toggleSelectAll}
          disabled={selectableUsers.length === 0}
          aria-label="Select all users"
        />
      ),
      className: "w-10",
      render: (u: StaffUser) =>
        isSelectable(u) ? (
          <Checkbox
            checked={selectedIds.includes(u._id)}
            onCheckedChange={() => toggleSelectOne(u._id)}
            aria-label={`Select ${u.name}`}
          />
        ) : null,
    },
    {
      key: "user",
      label: "User",
      render: (u: StaffUser) => {
        const initials = (u.name || "?")
          .split(" ")
          .map((n) => n[0])
          .filter(Boolean)
          .slice(0, 2)
          .join("")
          .toUpperCase();
        return (
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium text-sm">{u.name}</p>
              <p className="text-xs text-muted-foreground">{u.email}</p>
            </div>
          </div>
        );
      },
    },
    {
      key: "role",
      label: "Role",
      render: (u: StaffUser) => (
        <Badge variant={ROLE_VARIANT[u.role] ?? "outline"}>
          {(u.role ?? "unknown").replace(/_/g, " ")}
        </Badge>
      ),
    },
    {
      key: "branches",
      label: "Scope",
      render: (u: StaffUser) => {
        if (u.role === "ORG_ADMIN" && u.organizationId) {
          return <span className="text-sm text-muted-foreground">{u.organizationId.name}</span>;
        }
        const count = u.branchIds?.length ?? 0;
        return (
          <span className="text-sm text-muted-foreground">
            {count > 0 ? `${count} branch${count > 1 ? "es" : ""}` : "—"}
          </span>
        );
      },
    },
    {
      key: "status",
      label: "Status",
      render: (u: StaffUser) => (
        <Badge variant={u.isActive ? "success" : "destructive"}>
          {u.isActive ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "actions",
      label: "",
      className: "w-12",
      render: (u: StaffUser) => {
        const isSelf = u._id === currentUserId;
        const isOwner = u.role === "ADMIN";
        const canImpersonate = session?.user?.role === "ADMIN" && !isSelf && u.isActive;

        if (isOwner) {
          return (
            <span className="text-xs text-muted-foreground italic px-2">Protected</span>
          );
        }

        return (
          <RoleGuard requiredPermissions={["manage:users"]}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEdit(u)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </DropdownMenuItem>
                {canImpersonate && (
                  <DropdownMenuItem onClick={() => impersonateUser(u)}>
                    <UserCog className="h-4 w-4 mr-2" />
                    View as this user
                  </DropdownMenuItem>
                )}
                {!isSelf && (
                  <DropdownMenuItem
                    onClick={() => toggleActiveUser(u)}
                  >
                    {u.isActive ? (
                      <><UserX className="h-4 w-4 mr-2" />Deactivate</>
                    ) : (
                      <><UserCheck className="h-4 w-4 mr-2" />Activate</>
                    )}
                  </DropdownMenuItem>
                )}
                {!isSelf && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => deleteUser(u)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Remove
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </RoleGuard>
        );
      },
    },
  ], [
    currentUserId,
    session?.user?.role,
    deleteUser,
    toggleActiveUser,
    impersonateUser,
    openEdit,
    allSelectableSelected,
    selectableUsers,
    selectedIds,
    isSelectable,
    toggleSelectAll,
    toggleSelectOne,
  ]);

  return (
    <div className="flex flex-col">
      <Header
        title="Users"
        subtitle={isOrgAdmin ? "Manage your organization's team members" : "Manage team members and their roles"}
      />
      <div className="flex-1 p-6 space-y-4">
        {isError && (
          <ErrorState error={error} fallback="Unable to load users." onRetry={() => refetch()} />
        )}
        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row gap-3 justify-between">
          <div className="flex gap-2 flex-1">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {roleFilterSelectOptions.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <RoleGuard requiredPermissions={["manage:users"]}>
            <Button onClick={() => { setCreateForm({ ...defaultCreate, organizationId: isOrgAdmin ? sessionOrgId : "" }); setFormError(""); setCreateOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" />
              Add User
            </Button>
          </RoleGuard>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {usersTotal === 1 ? "1 user" : `${usersTotal} users`}
            {usersTotalPages > 1 ? ` — page ${page} of ${usersTotalPages}` : null}
          </p>
          {selectedIds.length > 0 && (
            <RoleGuard requiredPermissions={["manage:users"]}>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {selectedIds.length} selected
                </span>
                <Button variant="outline" size="sm" onClick={() => setSelectedIds([])}>
                  Clear
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setBulkDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Remove selected
                </Button>
              </div>
            </RoleGuard>
          )}
        </div>

        <DataTable
          columns={columns}
          data={users}
          loading={isLoading}
          keyExtractor={(u) => u._id}
          emptyMessage="No users found."
          page={page}
          totalPages={usersTotalPages}
          onPageChange={setPage}
        />
      </div>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
                <Label>Full Name</Label>
                <Input
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Jane Dela Cruz"
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="jane@example.com"
                />
              </div>
              <div className="space-y-2 col-span-2 sm:col-span-1">
                <Label>Password</Label>
                <Input
                  type="password"
                  value={createForm.password}
                  onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="Min. 8 characters"
                />
              </div>
              <div className="space-y-2 col-span-2 sm:col-span-1">
                <Label>Phone</Label>
                <Input
                  value={createForm.phone}
                  onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="+63 9xx xxx xxxx"
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Role</Label>
                <Select
                  value={createForm.role}
                  onValueChange={(v) => setCreateForm((f) => ({ ...f, role: v as UserRole, organizationId: "" }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRoleOptions.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!isOrgAdmin && createForm.role === "ORG_ADMIN" && (
                <div className="space-y-2 col-span-2">
                  <Label>Organization *</Label>
                  <Select
                    value={createForm.organizationId}
                    onValueChange={(v) => setCreateForm((f) => ({ ...f, organizationId: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select organization" />
                    </SelectTrigger>
                    <SelectContent>
                      {organizations.map((o) => (
                        <SelectItem key={o._id} value={o._id}>
                          {o.name} <span className="text-muted-foreground capitalize ml-1">({o.type})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {branches.length > 0 && (
                <div className="space-y-2 col-span-2">
                  <Label>Assign Branches</Label>
                  <div className="flex flex-wrap gap-2">
                    {branches.map((b) => (
                      <button
                        key={b._id}
                        type="button"
                        onClick={() => toggleBranch(b._id, createForm, (f) => setCreateForm(f as CreateForm))}
                        className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                          createForm.branchIds.includes(b._id)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border hover:border-primary"
                        }`}
                      >
                        {b.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setFormError("");
                createMutation.mutate();
              }}
              disabled={
                createMutation.isPending ||
                !createForm.name.trim() ||
                !createForm.email.trim() ||
                createForm.password.length < 8 ||
                !createForm.role ||
                (!isOrgAdmin && createForm.role === "ORG_ADMIN" && !createForm.organizationId.trim())
              }
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Create User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2 sm:col-span-1">
                <Label>Full Name</Label>
                <Input
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2 col-span-2 sm:col-span-1">
                <Label>Phone</Label>
                <Input
                  value={editForm.phone}
                  onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="+63 9xx xxx xxxx"
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Role</Label>
                <Select
                  value={editForm.role}
                  onValueChange={(v) => setEditForm((f) => ({ ...f, role: v as UserRole, organizationId: "" }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRoleOptions.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Changing the role will automatically update this user&apos;s permissions.
                </p>
              </div>
              {!isOrgAdmin && editForm.role === "ORG_ADMIN" && (
                <div className="space-y-2 col-span-2">
                  <Label>Organization *</Label>
                  <Select
                    value={editForm.organizationId}
                    onValueChange={(v) => setEditForm((f) => ({ ...f, organizationId: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select organization" />
                    </SelectTrigger>
                    <SelectContent>
                      {organizations.map((o) => (
                        <SelectItem key={o._id} value={o._id}>
                          {o.name} <span className="text-muted-foreground capitalize ml-1">({o.type})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {branches.length > 0 && (
                <div className="space-y-2 col-span-2">
                  <Label>Assigned Branches</Label>
                  <div className="flex flex-wrap gap-2">
                    {branches.map((b) => (
                      <button
                        key={b._id}
                        type="button"
                        onClick={() => toggleBranch(b._id, editForm, (f) => setEditForm(f as EditForm))}
                        className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                          editForm.branchIds.includes(b._id)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border hover:border-primary"
                        }`}
                      >
                        {b.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {canManageRoles && permissionCatalog.length > 0 && (
              <div className="space-y-3 border-t pt-4">
                <div>
                  <Label>Custom permissions</Label>
                  <p className="text-xs text-muted-foreground">
                    Overrides this user&apos;s permissions independently of their role. Changing the role
                    above resets these to the new role&apos;s defaults instead.
                  </p>
                </div>
                <div className="max-h-56 overflow-y-auto space-y-3 pr-1">
                  {Array.from(permissionsByGroup.entries()).map(([group, perms]) => (
                    <div key={group} className="space-y-1.5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {group}
                      </p>
                      {perms.map((perm) => (
                        <label key={perm.key} className="flex items-start gap-2 cursor-pointer">
                          <Checkbox
                            checked={editForm.permissions.includes(perm.key)}
                            onCheckedChange={() => togglePermission(perm.key)}
                          />
                          <span className="text-sm leading-tight">{perm.label}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {editId && (
              <RoleGuard allowedRoles={["ADMIN"]}>
                <AuditTrail targetId={editId} className="border-t pt-4" />
              </RoleGuard>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setFormError("");
                updateMutation.mutate();
              }}
              disabled={
                updateMutation.isPending ||
                !editForm.name.trim() ||
                !editForm.role ||
                (!isOrgAdmin && editForm.role === "ORG_ADMIN" && !editForm.organizationId.trim())
              }
            >
              {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirm Dialog */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {selectedIds.length} user{selectedIds.length === 1 ? "" : "s"}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will deactivate and remove the selected accounts. This action cannot be undone from this screen.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => bulkDeleteMutation.mutate(selectedIds)}
              disabled={bulkDeleteMutation.isPending}
            >
              {bulkDeleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
