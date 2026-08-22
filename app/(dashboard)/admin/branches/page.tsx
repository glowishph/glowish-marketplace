"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Header } from "@/components/layout/Header";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { Plus, Pencil, Trash2, Loader2, Building2, MapPin, Users, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/providers/confirm-provider";
import { RoleGuard } from "@/components/layout/RoleGuard";
import { AuditTrail } from "@/components/shared/AuditTrail";

interface Branch {
  _id: string;
  name: string;
  code: string;
  address: string;
  phone?: string;
  isHeadOffice: boolean;
  isActive: boolean;
  managerId?: { name: string; email: string };
  organizationId?: { _id: string; name: string } | null;
}

interface Organization {
  _id: string;
  name: string;
  type: string;
}

interface BranchUser {
  _id: string;
  name: string;
  email: string;
  role: string;
}

interface AllUser {
  _id: string;
  name: string;
  email: string;
  role: string;
}

interface BranchForm {
  name: string;
  code: string;
  address: string;
  phone: string;
  isHeadOffice: boolean;
  organizationId: string;
}

const defaultForm: BranchForm = {
  name: "",
  code: "",
  address: "",
  phone: "",
  isHeadOffice: false,
  organizationId: "",
};

async function fetchBranches(page: number): Promise<{ branches: Branch[]; total: number; limit: number }> {
  const res = await fetch(`/api/branches?page=${page}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error ?? `Failed to load branches (${res.status})`);
  return {
    branches: data.data ?? [],
    total: data.meta?.total ?? (data.data ?? []).length,
    limit: data.meta?.limit ?? 20,
  };
}

async function fetchOrganizations(): Promise<Organization[]> {
  const res = await fetch("/api/organizations");
  const data = await res.json();
  return data.data ?? [];
}

async function fetchAllUsers(): Promise<AllUser[]> {
  const res = await fetch("/api/users?limit=200");
  const data = await res.json();
  return data.data ?? [];
}

async function fetchBranchUsers(branchId: string): Promise<BranchUser[]> {
  const res = await fetch(`/api/branches/${branchId}/users`);
  const data = await res.json();
  return data.data ?? [];
}

async function saveBranch(form: BranchForm, id?: string) {
  const url = id ? `/api/branches/${id}` : "/api/branches";
  const method = id ? "PATCH" : "POST";
  const payload = {
    ...form,
    organizationId: form.organizationId || null,
  };
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function deleteBranch(id: string) {
  const res = await fetch(`/api/branches/${id}`, { method: "DELETE" });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
}

async function assignUser(branchId: string, userId: string) {
  const res = await fetch(`/api/branches/${branchId}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
}

async function removeUser(branchId: string, userId: string) {
  const res = await fetch(`/api/branches/${branchId}/users`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
}

export default function BranchesPage() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<BranchForm>(defaultForm);
  const [formError, setFormError] = useState("");

  const [usersDialogBranch, setUsersDialogBranch] = useState<Branch | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [page, setPage] = useState(1);

  const { data: branchesResult, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["branches", page],
    queryFn: () => fetchBranches(page),
  });
  const branches = branchesResult?.branches ?? [];
  const branchesTotal = branchesResult?.total ?? branches.length;
  const branchesTotalPages = Math.max(1, Math.ceil(branchesTotal / (branchesResult?.limit ?? 20)));

  const { data: organizations = [] } = useQuery({
    queryKey: ["organizations"],
    queryFn: fetchOrganizations,
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ["users-all"],
    queryFn: fetchAllUsers,
    enabled: !!usersDialogBranch,
  });

  const { data: branchUsers = [], isLoading: branchUsersLoading } = useQuery({
    queryKey: ["branch-users", usersDialogBranch?._id],
    queryFn: () => fetchBranchUsers(usersDialogBranch!._id),
    enabled: !!usersDialogBranch,
  });

  const saveMutation = useMutation({
    mutationFn: () => saveBranch(form, editId ?? undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      toast({ title: editId ? "Branch updated" : "Branch created", variant: "default" });
      setOpen(false);
      setForm(defaultForm);
      setEditId(null);
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteBranch,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      toast({ title: "Branch deleted" });
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const assignMutation = useMutation({
    mutationFn: ({ userId }: { userId: string }) =>
      assignUser(usersDialogBranch!._id, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branch-users", usersDialogBranch?._id] });
      setSelectedUserId("");
      toast({ title: "User assigned to branch" });
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: ({ userId }: { userId: string }) =>
      removeUser(usersDialogBranch!._id, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branch-users", usersDialogBranch?._id] });
      toast({ title: "User removed from branch" });
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  function openEdit(branch: Branch) {
    setForm({
      name: branch.name,
      code: branch.code,
      address: branch.address,
      phone: branch.phone ?? "",
      isHeadOffice: branch.isHeadOffice,
      organizationId: branch.organizationId?._id ?? "",
    });
    setEditId(branch._id);
    setFormError("");
    setOpen(true);
  }

  function openCreate() {
    setForm(defaultForm);
    setEditId(null);
    setFormError("");
    setOpen(true);
  }

  const assignedUserIds = new Set(branchUsers.map((u) => u._id));
  const unassignedUsers = allUsers.filter((u) => !assignedUserIds.has(u._id));

  const columns = [
    {
      key: "name",
      label: "Branch",
      render: (b: Branch) => (
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="font-medium">{b.name}</p>
            <p className="text-xs text-muted-foreground">{b.code}</p>
          </div>
        </div>
      ),
    },
    {
      key: "organization",
      label: "Organization",
      render: (b: Branch) =>
        b.organizationId ? (
          <span className="text-sm">{b.organizationId.name}</span>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        ),
    },
    {
      key: "address",
      label: "Address",
      render: (b: Branch) => (
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <MapPin className="h-3 w-3" />
          {b.address}
        </div>
      ),
    },
    {
      key: "manager",
      label: "Manager",
      render: (b: Branch) => b.managerId?.name ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (b: Branch) => (
        <div className="flex gap-2">
          {b.isHeadOffice && <Badge variant="secondary">Head Office</Badge>}
          <Badge variant={b.isActive ? "success" : "destructive"}>
            {b.isActive ? "Active" : "Inactive"}
          </Badge>
        </div>
      ),
    },
    {
      key: "actions",
      label: "",
      render: (b: Branch) => (
        <div className="flex gap-2 justify-end">
          <Button
            variant="ghost"
            size="icon"
            title="Manage Users"
            onClick={() => { setUsersDialogBranch(b); setSelectedUserId(""); }}
          >
            <Users className="h-4 w-4" />
          </Button>
          <RoleGuard requiredPermissions={["manage:branches"]}>
            <Button variant="ghost" size="icon" onClick={() => openEdit(b)}>
              <Pencil className="h-4 w-4" />
            </Button>
            {!b.isHeadOffice && (
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive"
                onClick={async () => {
                  const ok = await confirm({
                    title: `Delete "${b.name}"?`,
                    description: "This permanently removes the branch. This cannot be undone.",
                    variant: "destructive",
                  });
                  if (ok) deleteMutation.mutate(b._id);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </RoleGuard>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col">
      <Header title="Branches" subtitle="Manage your organization branches" />
      <div className="flex-1 p-6 space-y-4">
        {isError && (
          <ErrorState error={error} fallback="Unable to load branches." onRetry={() => refetch()} />
        )}
        <div className="flex justify-between items-center">
          <p className="text-sm text-muted-foreground">
            {branchesTotal === 1 ? "1 branch" : `${branchesTotal} branches`}
            {branchesTotalPages > 1 ? ` — page ${page} of ${branchesTotalPages}` : null}
          </p>
          <RoleGuard requiredPermissions={["manage:branches"]}>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Add Branch
            </Button>
          </RoleGuard>
        </div>

        <DataTable
          columns={columns}
          data={branches}
          loading={isLoading}
          keyExtractor={(b) => b._id}
          emptyMessage="No branches found. Add your first branch."
          page={page}
          totalPages={branchesTotalPages}
          onPageChange={setPage}
        />
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Branch" : "Create Branch"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
                <Label>Branch Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Main Branch"
                />
              </div>
              <div className="space-y-2">
                <Label>Branch Code</Label>
                <Input
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="e.g. BR01"
                  maxLength={10}
                />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="+63 xxx xxx xxxx"
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Address</Label>
                <Input
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  placeholder="Complete address"
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Organization</Label>
                <Select
                  value={form.organizationId || "none"}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, organizationId: v === "none" ? "" : v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None (standalone)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (standalone)</SelectItem>
                    {organizations.map((org) => (
                      <SelectItem key={org._id} value={org._id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {editId && (
              <RoleGuard allowedRoles={["ADMIN"]}>
                <AuditTrail targetId={editId} className="border-t pt-4" />
              </RoleGuard>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Users Dialog */}
      <Dialog open={!!usersDialogBranch} onOpenChange={(o) => !o && setUsersDialogBranch(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Manage Users — {usersDialogBranch?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Assign user */}
            <div className="space-y-2">
              <Label>Assign User</Label>
              <div className="flex gap-2">
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select a user…" />
                  </SelectTrigger>
                  <SelectContent>
                    {unassignedUsers.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        No users available
                      </SelectItem>
                    ) : (
                      unassignedUsers.map((u) => (
                        <SelectItem key={u._id} value={u._id}>
                          {u.name} ({u.role})
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={!selectedUserId || assignMutation.isPending}
                  onClick={() => assignMutation.mutate({ userId: selectedUserId })}
                >
                  {assignMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            {/* Assigned users list */}
            <div className="space-y-2">
              <Label>Assigned Users</Label>
              {branchUsersLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : branchUsers.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No users assigned yet.</p>
              ) : (
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {branchUsers.map((u) => (
                    <div
                      key={u._id}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium">{u.name}</p>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                          {u.role}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={async () => {
                            const ok = await confirm({
                              title: `Remove ${u.name} from this branch?`,
                              variant: "default",
                            });
                            if (ok) removeMutation.mutate({ userId: u._id });
                          }}
                          disabled={removeMutation.isPending}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUsersDialogBranch(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
