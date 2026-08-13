"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  User,
  Lock,
  Building2,
  Shield,
  Loader2,
  CheckCircle,
  Globe2,
  RefreshCw,
  Images,
  Upload,
  Trash2,
  WrenchIcon,
  Search,
  HeartHandshake,
} from "lucide-react";
import dynamic from "next/dynamic";
import { AppLogo } from "@/components/branding/AppLogo";
const MediaPickerDialog = dynamic(() =>
  import("@/components/media/MediaPickerDialog").then((m) => m.MediaPickerDialog)
);
import { resolveAppLogoSrc } from "@/lib/constants/branding";
import { IMAGE_UPLOAD_ACCEPT } from "@/lib/constants/gallery";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/providers/confirm-provider";
import type { AdminAppSettings } from "@/lib/types/appSettings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { APP_TIMEZONE_OPTIONS } from "@/lib/constants/timezones";
import { isValidCurrencyCode, isValidIanaTimezone } from "@/lib/utils/intlValidation";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PURCHASE_ORDER_DISCOUNT_BY_ORG_TYPE,
  PO_DISCOUNT_ORG_TYPES,
  type PurchaseOrderDiscountByOrgType,
} from "@/lib/purchaseOrders/orgTypeDiscountDefaults";

const PO_DISCOUNT_ORG_TYPE_LABELS: Record<(typeof PO_DISCOUNT_ORG_TYPES)[number], string> = {
  distributor: "Distributor",
  franchise: "Franchise",
  partner: "Partner",
  headquarters: "Headquarters",
};

interface MeUser {
  name: string;
  email: string;
  phone?: string;
  organizationId?: string | null;
  organizationName?: string | null;
}

interface RoleDefinition {
  name: string;
  displayName: string;
  permissions: string[];
  isSystem?: boolean;
}

interface RolesComparePayload {
  codeDefaults: RoleDefinition[];
  database: RoleDefinition[];
}

interface SyncRolesResult {
  rolesUpserted: number;
  usersUpdated: number;
  roleNames: string[];
}

interface CloudinaryAdminStatus {
  configured: boolean;
  backend: "cloudinary" | "local";
  cloudinary: { configured: boolean; ok: boolean; error?: string };
  mediaLibraryFolder: string;
  productCatalogFolder: string;
  storagePath: string;
  env: {
    hasCloudinaryUrl: boolean;
    hasCloudName: boolean;
    hasApiKey: boolean;
    hasApiSecret: boolean;
    cloudinaryConfigured: boolean;
  };
}

function permissionsKey(perms: string[]): string {
  return [...perms].sort().join("\0");
}

function rolePermissionsInSync(code: RoleDefinition, db: RoleDefinition | undefined): boolean {
  if (!db) return false;
  return permissionsKey(code.permissions) === permissionsKey(db.permissions);
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const { toast } = useToast();
  const confirm = useConfirm();
  const user = session?.user;

  const [profileForm, setProfileForm] = useState({ name: "", phone: "" });

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const [passwordError, setPasswordError] = useState("");

  const isAdmin = user?.role === "ADMIN";
  const canManageRoles =
    isAdmin || (user?.permissions?.includes("manage:roles") ?? false);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: meUser, isLoading: meLoading } = useQuery({
    queryKey: ["me-profile"],
    queryFn: async () => {
      const res = await fetch("/api/users/me");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as MeUser;
    },
    enabled: !!session?.user,
  });

  useEffect(() => {
    if (meUser) {
      queueMicrotask(() => {
        setProfileForm({ name: meUser.name ?? "", phone: meUser.phone ?? "" });
      });
      return;
    }
    if (user?.name) {
      queueMicrotask(() => {
        setProfileForm((prev) => ({ ...prev, name: user.name }));
      });
    }
  }, [meUser, user?.name]);


  const {
    data: cloudinaryStatus,
    isLoading: cloudinaryLoading,
    refetch: refetchCloudinary,
    isFetching: cloudinaryFetching,
  } = useQuery({
    queryKey: ["admin-cloudinary-status"],
    queryFn: async () => {
      const res = await fetch("/api/admin/cloudinary/status");
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Failed to load Cloudinary status");
      return json.data as CloudinaryAdminStatus;
    },
    enabled: isAdmin,
  });

  const { data: appSettings, isLoading: appSettingsLoading } = useQuery({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings/app");
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data.data as AdminAppSettings;
    },
    enabled: !!isAdmin,
  });

  const [syncRolesOption, setSyncRolesOption] = useState(true);
  const [syncUsersOption, setSyncUsersOption] = useState(true);

  const {
    data: rolesCompare,
    isLoading: rolesLoading,
    isError: rolesError,
    error: rolesCompareError,
    refetch: refetchRoles,
  } = useQuery({
    queryKey: ["admin-roles-compare"],
    queryFn: async () => {
      const res = await fetch("/api/admin/roles");
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? `Failed to load roles (${res.status})`);
      return json.data as RolesComparePayload;
    },
    enabled: canManageRoles,
  });

  const rolesSyncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/roles/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          syncRoles: syncRolesOption,
          syncUsers: syncUsersOption,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? `Sync failed (${res.status})`);
      return json.data as SyncRolesResult;
    },
    onSuccess: (result) => {
      void refetchRoles();
      const parts: string[] = [];
      if (syncRolesOption) parts.push(`${result.rolesUpserted} role(s) updated`);
      if (syncUsersOption) parts.push(`${result.usersUpdated} user(s) updated`);
      toast({
        title: "Roles and permissions synced",
        description: parts.length ? parts.join(" · ") : "No changes requested.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  const dbRoleByName = useMemo(() => {
    const map = new Map<string, RoleDefinition>();
    for (const r of rolesCompare?.database ?? []) {
      map.set(r.name, r);
    }
    return map;
  }, [rolesCompare?.database]);

  const rolesDriftCount = useMemo(() => {
    if (!rolesCompare?.codeDefaults) return 0;
    return rolesCompare.codeDefaults.filter((code) => !rolePermissionsInSync(code, dbRoleByName.get(code.name)))
      .length;
  }, [rolesCompare?.codeDefaults, dbRoleByName]);

  const { data: branches = [] } = useQuery({
    queryKey: ["branches-settings"],
    queryFn: async () => {
      const res = await fetch("/api/branches?limit=100");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return (json.data ?? []) as { _id: string; name: string; code?: string }[];
    },
    enabled: !!isAdmin,
  });

  const [appForm, setAppForm] = useState({
    appName: "",
    appTagline: "",
    seoDefaultDescription: "",
    seoOgImageUrl: "",
    currency: "PHP",
    timezone: "Asia/Manila",
    memberDefaultDiscountPercent: 10,
    defaultLowStockThreshold: 10,
    receiptFooter: "",
    marketplaceFulfillmentBranchId: "",
    spinWheelFreeGiftProductId: "",
    purchaseOrderDiscountByOrgType: {
      ...DEFAULT_PURCHASE_ORDER_DISCOUNT_BY_ORG_TYPE,
    } as PurchaseOrderDiscountByOrgType,
    impactEnabled: true,
    impactTitle: "",
    impactContent: "",
  });
  const [spinWheelGiftProductName, setSpinWheelGiftProductName] = useState("");
  const [spinWheelGiftSearch, setSpinWheelGiftSearch] = useState("");
  const [spinWheelGiftResults, setSpinWheelGiftResults] = useState<
    { _id: string; name: string }[]
  >([]);
  const [spinWheelGiftSearchLoading, setSpinWheelGiftSearchLoading] = useState(false);

  useEffect(() => {
    if (!appSettings) return;
    queueMicrotask(() => {
      setAppForm({
        appName: appSettings.appName,
        appTagline: appSettings.appTagline,
        seoDefaultDescription: appSettings.seoDefaultDescription ?? "",
        seoOgImageUrl: appSettings.seoOgImageUrl ?? "",
        currency: appSettings.currency,
        timezone: appSettings.timezone,
        memberDefaultDiscountPercent: appSettings.memberDefaultDiscountPercent,
        defaultLowStockThreshold: appSettings.defaultLowStockThreshold,
        receiptFooter: appSettings.receiptFooter,
        marketplaceFulfillmentBranchId: appSettings.marketplaceFulfillmentBranchId ?? "",
        spinWheelFreeGiftProductId: appSettings.spinWheelFreeGiftProductId ?? "",
        purchaseOrderDiscountByOrgType: {
          ...DEFAULT_PURCHASE_ORDER_DISCOUNT_BY_ORG_TYPE,
          ...appSettings.purchaseOrderDiscountByOrgType,
        },
        impactEnabled: appSettings.impactEnabled ?? true,
        impactTitle: appSettings.impactTitle ?? "",
        impactContent: appSettings.impactContent ?? "",
      });
    });
  }, [appSettings]);

  useEffect(() => {
    const id = appSettings?.spinWheelFreeGiftProductId;
    if (!id) {
      setSpinWheelGiftProductName("");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/products/${id}`);
        const json = await res.json();
        if (!cancelled && json.success) setSpinWheelGiftProductName(json.data?.name ?? "");
      } catch {
        /* ignore — field still shows the raw id state */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appSettings?.spinWheelFreeGiftProductId]);

  async function searchSpinWheelGiftProducts(q: string) {
    if (!q.trim()) {
      setSpinWheelGiftResults([]);
      return;
    }
    setSpinWheelGiftSearchLoading(true);
    try {
      const res = await fetch(`/api/marketplace/products?search=${encodeURIComponent(q)}&limit=8`);
      const json = await res.json();
      setSpinWheelGiftResults(json.data ?? []);
    } finally {
      setSpinWheelGiftSearchLoading(false);
    }
  }

  const appSettingsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appName: appForm.appName.trim(),
          appTagline: appForm.appTagline.trim(),
          seoDefaultDescription: appForm.seoDefaultDescription.trim(),
          seoOgImageUrl: appForm.seoOgImageUrl.trim(),
          currency: appForm.currency.trim().toUpperCase(),
          timezone: appForm.timezone.trim(),
          memberDefaultDiscountPercent: Number(appForm.memberDefaultDiscountPercent),
          defaultLowStockThreshold: Number(appForm.defaultLowStockThreshold),
          receiptFooter: appForm.receiptFooter.trim(),
          marketplaceFulfillmentBranchId: appForm.marketplaceFulfillmentBranchId || "",
          spinWheelFreeGiftProductId: appForm.spinWheelFreeGiftProductId || "",
          purchaseOrderDiscountByOrgType: appForm.purchaseOrderDiscountByOrgType,
          impactEnabled: appForm.impactEnabled,
          impactTitle: appForm.impactTitle.trim(),
          impactContent: appForm.impactContent.trim(),
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data.data as AdminAppSettings;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["app-settings"], {
        ...data,
        marketplaceFulfillmentBranchId: data.marketplaceFulfillmentBranchId ?? "",
        spinWheelFreeGiftProductId: data.spinWheelFreeGiftProductId ?? "",
      });
      toast({ title: "Application settings saved" });
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      router.refresh();
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const {
    data: maintenanceStatus,
    isLoading: maintenanceLoading,
    refetch: refetchMaintenance,
  } = useQuery({
    queryKey: ["maintenance-status"],
    queryFn: async () => {
      const res = await fetch("/api/maintenance/status");
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Failed to load maintenance status");
      return json.data as { maintenanceMode: boolean };
    },
    enabled: isAdmin,
  });

  const maintenanceMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await fetch("/api/maintenance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Failed to update maintenance mode");
      return json.data as { maintenanceMode: boolean };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["maintenance-status"], data);
      toast({
        title: data.maintenanceMode ? "Maintenance mode enabled" : "Maintenance mode disabled",
        description: data.maintenanceMode
          ? "All users are now redirected to the maintenance page."
          : "The app is now accessible to all users.",
      });
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoPickerOpen, setLogoPickerOpen] = useState(false);
  const [ogImagePickerOpen, setOgImagePickerOpen] = useState(false);
  const impactImageInputRef = useRef<HTMLInputElement>(null);
  const [impactImagePickerOpen, setImpactImagePickerOpen] = useState(false);

  const impactImageUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/settings/app/impact-image", { method: "POST", body: form });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Image upload failed");
      return data.data as AdminAppSettings;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["app-settings"], {
        ...data,
        marketplaceFulfillmentBranchId: data.marketplaceFulfillmentBranchId ?? "",
      });
      toast({ title: "Impact block image updated" });
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      router.refresh();
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const impactImageFromLibraryMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await fetch("/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ impactImageUrl: url }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Could not set image");
      return data.data as AdminAppSettings;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["app-settings"], {
        ...data,
        marketplaceFulfillmentBranchId: data.marketplaceFulfillmentBranchId ?? "",
      });
      toast({ title: "Impact block image updated from media library" });
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      router.refresh();
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const featuredProductsRefreshMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/featured-products/refresh", { method: "POST" });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Failed to refresh featured products");
      return data;
    },
    onSuccess: () => {
      toast({ title: "Featured banner products refreshed" });
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const impactImageRemoveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/app/impact-image", { method: "DELETE" });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Could not remove image");
      return data.data as AdminAppSettings;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["app-settings"], {
        ...data,
        marketplaceFulfillmentBranchId: data.marketplaceFulfillmentBranchId ?? "",
      });
      toast({ title: "Impact block image reset to default" });
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      router.refresh();
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const logoUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/settings/app/logo", { method: "POST", body: form });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Logo upload failed");
      return data.data as AdminAppSettings;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["app-settings"], {
        ...data,
        marketplaceFulfillmentBranchId: data.marketplaceFulfillmentBranchId ?? "",
      });
      toast({ title: "Logo updated" });
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      router.refresh();
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const logoFromLibraryMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await fetch("/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appLogoUrl: url }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Could not set logo");
      return data.data as AdminAppSettings;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["app-settings"], {
        ...data,
        marketplaceFulfillmentBranchId: data.marketplaceFulfillmentBranchId ?? "",
      });
      toast({ title: "Logo updated from media library" });
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      router.refresh();
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const logoRemoveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/app/logo", { method: "DELETE" });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Could not remove logo");
      return data.data as AdminAppSettings;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["app-settings"], {
        ...data,
        marketplaceFulfillmentBranchId: data.marketplaceFulfillmentBranchId ?? "",
      });
      toast({ title: "Logo reset to default" });
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      router.refresh();
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const profileMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: profileForm.name, phone: profileForm.phone }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me-profile"] });
      toast({ title: "Profile updated successfully" });
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const passwordMutation = useMutation({
    mutationFn: async () => {
      if (passwordForm.newPassword !== passwordForm.confirmPassword) {
        throw new Error("New passwords do not match");
      }
      const res = await fetch("/api/users/me/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data.data;
    },
    onSuccess: () => {
      toast({ title: "Password changed successfully" });
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setPasswordError("");
    },
    onError: (err: Error) => setPasswordError(err.message),
  });

  function handlePasswordSubmit() {
    setPasswordError("");
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError("New passwords do not match");
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters");
      return;
    }
    passwordMutation.mutate();
  }

  const appIntlValid = useMemo(
    () => ({
      currency: isValidCurrencyCode(appForm.currency),
      timezone: isValidIanaTimezone(appForm.timezone),
    }),
    [appForm.currency, appForm.timezone]
  );

  const displayName = meUser?.name ?? user?.name;
  const displayEmail = meUser?.email ?? user?.email;

  return (
    <div className="flex flex-col">
      <Header title="Settings" subtitle="Manage your account and preferences" />
      <div className="flex-1 p-6 max-w-3xl">
        <Tabs defaultValue="profile">
          <TabsList className="mb-6">
            <TabsTrigger value="profile">
              <User className="h-4 w-4 mr-2" />
              Profile
            </TabsTrigger>
            <TabsTrigger value="security">
              <Lock className="h-4 w-4 mr-2" />
              Security
            </TabsTrigger>
            <TabsTrigger value="account">
              <Building2 className="h-4 w-4 mr-2" />
              Account
            </TabsTrigger>
            {isAdmin ? (
              <TabsTrigger value="application">
                <Globe2 className="h-4 w-4 mr-2" />
                Application
              </TabsTrigger>
            ) : null}
            {canManageRoles ? (
              <TabsTrigger value="roles">
                <Shield className="h-4 w-4 mr-2" />
                Roles
              </TabsTrigger>
            ) : null}
          </TabsList>

          {/* Profile Tab */}
          <TabsContent value="profile" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Personal Information</CardTitle>
                <CardDescription>Update your name and contact details.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4 pb-4">
                  <div className="h-16 w-16 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xl font-bold">
                    {displayName
                      ?.split(" ")
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase() ?? "?"}
                  </div>
                  <div>
                    <p className="font-semibold">{displayName ?? "—"}</p>
                    <p className="text-sm text-muted-foreground">{displayEmail}</p>
                    <Badge variant="secondary" className="mt-1 text-xs">
                      {user?.role?.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </div>

                <Separator />

                {profileMutation.isSuccess && (
                  <Alert variant="success">
                    <CheckCircle className="h-4 w-4" />
                    <AlertDescription>Profile saved.</AlertDescription>
                  </Alert>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2 col-span-2 sm:col-span-1">
                    <Label>Full Name</Label>
                    {meLoading ? (
                      <Skeleton className="h-10 w-full" />
                    ) : (
                      <Input
                        value={profileForm.name}
                        onChange={(e) => {
                          profileMutation.reset();
                          setProfileForm((f) => ({ ...f, name: e.target.value }));
                        }}
                        placeholder="Your full name"
                      />
                    )}
                  </div>
                  <div className="space-y-2 col-span-2 sm:col-span-1">
                    <Label>Phone</Label>
                    {meLoading ? (
                      <Skeleton className="h-10 w-full" />
                    ) : (
                      <Input
                        value={profileForm.phone}
                        onChange={(e) => {
                          profileMutation.reset();
                          setProfileForm((f) => ({ ...f, phone: e.target.value }));
                        }}
                        placeholder="+63 9xx xxx xxxx"
                      />
                    )}
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label>Email</Label>
                    <Input value={displayEmail ?? ""} disabled className="bg-muted" />
                    <p className="text-xs text-muted-foreground">
                      Email cannot be changed. Contact your admin.
                    </p>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    onClick={() => profileMutation.mutate()}
                    disabled={
                      profileMutation.isPending ||
                      meLoading ||
                      profileForm.name.trim().length < 2
                    }
                  >
                    {profileMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : null}
                    Save Changes
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Security Tab */}
          <TabsContent value="security" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Change Password
                </CardTitle>
                <CardDescription>
                  Use a strong password of at least 8 characters.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {passwordError && (
                  <Alert variant="destructive">
                    <AlertDescription>{passwordError}</AlertDescription>
                  </Alert>
                )}

                {passwordMutation.isSuccess && (
                  <Alert variant="success">
                    <CheckCircle className="h-4 w-4" />
                    <AlertDescription>Password changed successfully.</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <Label>Current Password</Label>
                  <Input
                    type="password"
                    value={passwordForm.currentPassword}
                    onChange={(e) => {
                      passwordMutation.reset();
                      setPasswordForm((f) => ({ ...f, currentPassword: e.target.value }));
                    }}
                    placeholder="••••••••"
                  />
                </div>
                <div className="space-y-2">
                  <Label>New Password</Label>
                  <Input
                    type="password"
                    value={passwordForm.newPassword}
                    onChange={(e) => {
                      passwordMutation.reset();
                      setPasswordForm((f) => ({ ...f, newPassword: e.target.value }));
                    }}
                    placeholder="••••••••"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Confirm New Password</Label>
                  <Input
                    type="password"
                    value={passwordForm.confirmPassword}
                    onChange={(e) => {
                      passwordMutation.reset();
                      setPasswordForm((f) => ({ ...f, confirmPassword: e.target.value }));
                    }}
                    placeholder="••••••••"
                  />
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    onClick={handlePasswordSubmit}
                    disabled={
                      passwordMutation.isPending ||
                      !passwordForm.currentPassword ||
                      !passwordForm.newPassword ||
                      !passwordForm.confirmPassword
                    }
                  >
                    {passwordMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : null}
                    Change Password
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Active Session</CardTitle>
                <CardDescription>You are currently signed in.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium">{displayName}</p>
                    <p className="text-muted-foreground">{displayEmail}</p>
                  </div>
                  <Badge variant="success">Active</Badge>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Account Tab */}
          <TabsContent value="account" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Account Details
                </CardTitle>
                <CardDescription>Your role and organization information.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { label: "Role", value: user?.role?.replace(/_/g, " ") },
                  {
                    label: "Organization",
                    value: meLoading ? "…" : meUser?.organizationName?.trim() || "—",
                  },
                  {
                    label: "Organization ID",
                    value: meLoading ? "…" : meUser?.organizationId ?? "—",
                    mono: true,
                  },
                  {
                    label: "Branches",
                    value: user?.branchIds?.length
                      ? `${user.branchIds.length} branch${user.branchIds.length > 1 ? "es" : ""} assigned`
                      : "None",
                  },
                  {
                    label: "Permissions",
                    value: user?.permissions?.length
                      ? `${user.permissions.length} permissions`
                      : "None",
                  },
                ].map(({ label, value, mono }) => (
                  <div key={label} className="flex items-center justify-between gap-4 py-2 border-b last:border-0">
                    <span className="text-sm text-muted-foreground shrink-0">{label}</span>
                    <span
                      className={cn(
                        "text-sm font-medium text-right min-w-0 break-all",
                        mono && "font-mono text-xs"
                      )}
                    >
                      {value ?? "—"}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="application" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <WrenchIcon className="h-4 w-4" />
                    Maintenance mode
                  </CardTitle>
                  <CardDescription>
                    When enabled, all users are redirected to the maintenance page. Admins cannot
                    bypass this — disable it here when done.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {maintenanceLoading ? (
                    <Skeleton className="h-10 w-full" />
                  ) : (
                    <div className="flex items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium">Maintenance mode</p>
                        <p className="text-xs text-muted-foreground">
                          {maintenanceStatus?.maintenanceMode
                            ? "Currently active — users see the maintenance page."
                            : "Currently off — app is accessible normally."}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        {maintenanceMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : null}
                        <Badge variant={maintenanceStatus?.maintenanceMode ? "destructive" : "success"}>
                          {maintenanceStatus?.maintenanceMode ? "Active" : "Off"}
                        </Badge>
                        <Button
                          type="button"
                          variant={maintenanceStatus?.maintenanceMode ? "outline" : "destructive"}
                          size="sm"
                          disabled={maintenanceMutation.isPending || maintenanceLoading}
                          onClick={async () => {
                            const next = !maintenanceStatus?.maintenanceMode;
                            if (next) {
                              const ok = await confirm({
                                title: "Enable maintenance mode?",
                                description:
                                  "All users (including you) will be redirected to the maintenance page. You can disable it here.",
                                variant: "destructive",
                                confirmText: "Enable",
                              });
                              if (!ok) return;
                            }
                            maintenanceMutation.mutate(next);
                          }}
                        >
                          {maintenanceStatus?.maintenanceMode ? "Disable" : "Enable"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void refetchMaintenance()}
                          disabled={maintenanceLoading}
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Images className="h-4 w-4" />
                    Image storage (Cloudinary)
                  </CardTitle>
                  <CardDescription>
                    Product and media library uploads use Cloudinary when configured; otherwise files
                    are stored under <code className="text-xs">public/uploads</code>.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {cloudinaryLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                    </div>
                  ) : cloudinaryStatus ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={cloudinaryStatus.backend === "cloudinary" ? "default" : "secondary"}>
                          Backend: {cloudinaryStatus.backend === "cloudinary" ? "Cloudinary" : "Local disk"}
                        </Badge>
                        {cloudinaryStatus.cloudinary.configured ? (
                          <Badge variant={cloudinaryStatus.cloudinary.ok ? "success" : "destructive"}>
                            {cloudinaryStatus.cloudinary.ok ? "API connected" : "API error"}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Cloudinary not configured</Badge>
                        )}
                      </div>

                      {cloudinaryStatus.cloudinary.error ? (
                        <Alert variant="destructive">
                          <AlertDescription>{cloudinaryStatus.cloudinary.error}</AlertDescription>
                        </Alert>
                      ) : null}

                      {!cloudinaryStatus.cloudinary.configured ? (
                        <p className="text-sm text-muted-foreground">
                          Add{" "}
                          <span className="font-mono text-xs">CLOUDINARY_URL</span> or{" "}
                          <span className="font-mono text-xs">CLOUDINARY_CLOUD_NAME</span>,{" "}
                          <span className="font-mono text-xs">CLOUDINARY_API_KEY</span>, and{" "}
                          <span className="font-mono text-xs">CLOUDINARY_API_SECRET</span> to{" "}
                          <span className="font-mono text-xs">.env.local</span>, then restart the dev
                          server.
                        </p>
                      ) : (
                        <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
                          <li>
                            Media library folder:{" "}
                            <span className="font-mono text-xs text-foreground">
                              {cloudinaryStatus.mediaLibraryFolder}
                            </span>
                          </li>
                          <li>
                            Product catalog folder:{" "}
                            <span className="font-mono text-xs text-foreground">
                              {cloudinaryStatus.productCatalogFolder}
                            </span>
                          </li>
                          <li>Storage path label: {cloudinaryStatus.storagePath}</li>
                        </ul>
                      )}

                      <div className="rounded-lg border bg-muted/40 p-3 text-xs font-mono space-y-1">
                        <p className="font-sans font-medium text-sm mb-2">Environment (set / missing)</p>
                        <p>CLOUDINARY_URL: {cloudinaryStatus.env.hasCloudinaryUrl ? "set" : "—"}</p>
                        <p>CLOUDINARY_CLOUD_NAME: {cloudinaryStatus.env.hasCloudName ? "set" : "—"}</p>
                        <p>CLOUDINARY_API_KEY: {cloudinaryStatus.env.hasApiKey ? "set" : "—"}</p>
                        <p>CLOUDINARY_API_SECRET: {cloudinaryStatus.env.hasApiSecret ? "set" : "—"}</p>
                      </div>
                    </>
                  ) : null}

                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void refetchCloudinary()}
                      disabled={cloudinaryFetching}
                    >
                      <RefreshCw
                        className={cn("h-4 w-4 mr-2", cloudinaryFetching && "animate-spin")}
                      />
                      Test connection
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <RefreshCw className="h-4 w-4" />
                    Featured banner products
                  </CardTitle>
                  <CardDescription>
                    The homepage, shop, categories, about us, reviews, resellers, and contact
                    pages each showcase a random rotating selection of products in their
                    banners. This runs automatically every Monday — use this to force an
                    immediate re-shuffle.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">Weekly automatic rotation</p>
                      <p className="text-xs text-muted-foreground">
                        Randomly re-picks banner products across the storefront.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={featuredProductsRefreshMutation.isPending}
                      onClick={() => featuredProductsRefreshMutation.mutate()}
                    >
                      {featuredProductsRefreshMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-2" />
                      )}
                      Refresh now
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <HeartHandshake className="h-4 w-4" />
                    Impact block
                  </CardTitle>
                  <CardDescription>
                    The charity/foundation callout shown on the storefront home page sidebar.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {appSettingsLoading ? (
                    <Skeleton className="h-10 w-full" />
                  ) : (
                    <>
                      <div className="flex items-center justify-between rounded-lg border p-4">
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium">Show impact block</p>
                          <p className="text-xs text-muted-foreground">
                            {appForm.impactEnabled
                              ? "Currently visible on the storefront home page."
                              : "Currently hidden from the storefront home page."}
                          </p>
                        </div>
                        <Checkbox
                          checked={appForm.impactEnabled}
                          onCheckedChange={(v) =>
                            setAppForm((f) => ({ ...f, impactEnabled: v === true }))
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Image</Label>
                        <div className="flex flex-wrap items-center gap-4">
                          <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border bg-white shadow-sm">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={appSettings?.impactImageUrl?.trim() || "/wise.jpg"}
                              alt="Impact block preview"
                              className="h-full w-full object-contain"
                            />
                          </span>
                          <div className="flex flex-col gap-2">
                            <input
                              ref={impactImageInputRef}
                              type="file"
                              accept={IMAGE_UPLOAD_ACCEPT}
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                e.target.value = "";
                                if (file) impactImageUploadMutation.mutate(file);
                              }}
                            />
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              disabled={
                                !appSettings?.imageUploadEnabled ||
                                impactImageUploadMutation.isPending ||
                                impactImageFromLibraryMutation.isPending ||
                                impactImageRemoveMutation.isPending
                              }
                              onClick={() => impactImageInputRef.current?.click()}
                            >
                              {impactImageUploadMutation.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <Upload className="h-4 w-4 mr-2" />
                              )}
                              Upload image
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              disabled={
                                impactImageUploadMutation.isPending ||
                                impactImageFromLibraryMutation.isPending ||
                                impactImageRemoveMutation.isPending
                              }
                              onClick={() => setImpactImagePickerOpen(true)}
                            >
                              {impactImageFromLibraryMutation.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <Images className="h-4 w-4 mr-2" />
                              )}
                              Media library
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={
                                impactImageUploadMutation.isPending ||
                                impactImageFromLibraryMutation.isPending ||
                                impactImageRemoveMutation.isPending ||
                                !appSettings?.impactImageUrl?.trim()
                              }
                              onClick={() => impactImageRemoveMutation.mutate()}
                            >
                              {impactImageRemoveMutation.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4 mr-2" />
                              )}
                              Use default image
                            </Button>
                            {!appSettings?.imageUploadEnabled ? (
                              <p className="text-xs text-destructive max-w-xs">
                                Image upload is not configured. Set up Cloudinary or local uploads
                                first.
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <MediaPickerDialog
                          open={impactImagePickerOpen}
                          onOpenChange={setImpactImagePickerOpen}
                          selectedUrls={[]}
                          maxPick={1}
                          title="Choose impact block image"
                          confirmLabel="Use image"
                          emptyMessage="No media yet. Upload images on the Media page, then return here."
                          onConfirm={(urls) => {
                            const url = urls[0]?.trim();
                            if (url) impactImageFromLibraryMutation.mutate(url);
                          }}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="impactTitle">Heading</Label>
                        <Input
                          id="impactTitle"
                          value={appForm.impactTitle}
                          onChange={(e) => setAppForm((f) => ({ ...f, impactTitle: e.target.value }))}
                          placeholder="Your glow gives back"
                          maxLength={120}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="impactContent">Body copy</Label>
                        <textarea
                          id="impactContent"
                          value={appForm.impactContent}
                          onChange={(e) =>
                            setAppForm((f) => ({ ...f, impactContent: e.target.value }))
                          }
                          placeholder="Every order supports the Wise Foundation..."
                          rows={3}
                          maxLength={500}
                          className={cn(
                            "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm",
                            "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                            "disabled:cursor-not-allowed disabled:opacity-50"
                          )}
                        />
                        <p className="text-xs text-muted-foreground">
                          {appForm.impactContent.length}/500
                        </p>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Globe2 className="h-4 w-4" />
                    Application
                  </CardTitle>
                  <CardDescription>
                    Store name, currency, timezone, and defaults for POS, members, inventory, and reports.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {appSettingsLoading ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Skeleton className="h-10 sm:col-span-2" />
                      <Skeleton className="h-10 sm:col-span-2" />
                      <Skeleton className="h-10" />
                      <Skeleton className="h-10" />
                      <Skeleton className="h-10" />
                      <Skeleton className="h-10" />
                      <Skeleton className="h-24 sm:col-span-2" />
                    </div>
                  ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-3 sm:col-span-2 rounded-lg border bg-muted/30 p-4">
                      <div>
                        <Label>Application logo</Label>
                        <p className="text-xs text-muted-foreground mt-1">
                          Shown in the sidebar, login, marketplace header, receipts, and across the
                          app. Upload a file or pick an image from the media library (PNG or JPEG
                          recommended, square, at least 256×256).
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-4">
                        <AppLogo
                          size="lg"
                          logoSrc={resolveAppLogoSrc(appSettings?.appLogoUrl)}
                        />
                        <div className="flex flex-col gap-2">
                          <input
                            ref={logoInputRef}
                            type="file"
                            accept={IMAGE_UPLOAD_ACCEPT}
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = "";
                              if (file) logoUploadMutation.mutate(file);
                            }}
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={
                              !appSettings?.imageUploadEnabled ||
                              logoUploadMutation.isPending ||
                              logoFromLibraryMutation.isPending ||
                              logoRemoveMutation.isPending
                            }
                            onClick={() => logoInputRef.current?.click()}
                          >
                            {logoUploadMutation.isPending ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <Upload className="h-4 w-4 mr-2" />
                            )}
                            Upload logo
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={
                              logoUploadMutation.isPending ||
                              logoFromLibraryMutation.isPending ||
                              logoRemoveMutation.isPending
                            }
                            onClick={() => setLogoPickerOpen(true)}
                          >
                            {logoFromLibraryMutation.isPending ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <Images className="h-4 w-4 mr-2" />
                            )}
                            Media library
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={
                              logoUploadMutation.isPending ||
                              logoFromLibraryMutation.isPending ||
                              logoRemoveMutation.isPending ||
                              !appSettings?.appLogoUrl?.trim()
                            }
                            onClick={() => logoRemoveMutation.mutate()}
                          >
                            {logoRemoveMutation.isPending ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4 mr-2" />
                            )}
                            Use default logo
                          </Button>
                          {!appSettings?.imageUploadEnabled ? (
                            <p className="text-xs text-destructive max-w-xs">
                              Image upload is not configured. Set up Cloudinary or local uploads
                              first.
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <MediaPickerDialog
                        open={logoPickerOpen}
                        onOpenChange={setLogoPickerOpen}
                        selectedUrls={[]}
                        maxPick={1}
                        title="Choose application logo"
                        confirmLabel="Use as logo"
                        emptyMessage="No media yet. Upload images on the Media page, then return here."
                        onConfirm={(urls) => {
                          const url = urls[0]?.trim();
                          if (url) logoFromLibraryMutation.mutate(url);
                        }}
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="appName">Application name</Label>
                      <Input
                        id="appName"
                        value={appForm.appName}
                        onChange={(e) => setAppForm((f) => ({ ...f, appName: e.target.value }))}
                        placeholder="Glowish"
                      />
                      <p className="text-xs text-muted-foreground">Shown in the sidebar and printed receipts.</p>
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="appTagline">Tagline</Label>
                      <Input
                        id="appTagline"
                        value={appForm.appTagline}
                        onChange={(e) => setAppForm((f) => ({ ...f, appTagline: e.target.value }))}
                        placeholder="POS & online store"
                      />
                    </div>
                    <div className="space-y-3 sm:col-span-2 rounded-lg border bg-muted/40 p-4">
                      <div>
                        <p className="text-sm font-medium">Storefront SEO</p>
                        <p className="text-xs text-muted-foreground">
                          Default meta description and social preview image for the public shop.
                          Product pages can override with per-product SEO fields.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="seoDefaultDescription">Default meta description</Label>
                        <Input
                          id="seoDefaultDescription"
                          value={appForm.seoDefaultDescription}
                          onChange={(e) =>
                            setAppForm((f) => ({ ...f, seoDefaultDescription: e.target.value }))
                          }
                          placeholder="Short description for search results and social sharing"
                          maxLength={160}
                        />
                        <p className="text-xs text-muted-foreground">
                          {appForm.seoDefaultDescription.length}/160 · Falls back to tagline when empty.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label>Default social image (Open Graph)</Label>
                        <div className="flex flex-wrap items-start gap-4">
                          {appForm.seoOgImageUrl.trim() ? (
                            <div className="relative h-20 w-32 overflow-hidden rounded-md border bg-background">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={appForm.seoOgImageUrl}
                                alt="OG preview"
                                className="h-full w-full object-cover"
                              />
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground py-2">
                              No image set — uses application logo.
                            </p>
                          )}
                          <div className="flex flex-col gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              disabled={!appSettings?.imageUploadEnabled}
                              onClick={() => setOgImagePickerOpen(true)}
                            >
                              <Images className="h-4 w-4 mr-2" />
                              Choose from media
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={!appForm.seoOgImageUrl.trim()}
                              onClick={() => setAppForm((f) => ({ ...f, seoOgImageUrl: "" }))}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Clear image
                            </Button>
                          </div>
                        </div>
                      </div>
                      <MediaPickerDialog
                        open={ogImagePickerOpen}
                        onOpenChange={setOgImagePickerOpen}
                        selectedUrls={appForm.seoOgImageUrl.trim() ? [appForm.seoOgImageUrl] : []}
                        maxPick={1}
                        title="Choose default social image"
                        confirmLabel="Use image"
                        emptyMessage="No media yet. Upload images on the Media page, then return here."
                        onConfirm={(urls) => {
                          const url = urls[0]?.trim();
                          if (url) setAppForm((f) => ({ ...f, seoOgImageUrl: url }));
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="currency">Currency (ISO 4217)</Label>
                      <Input
                        id="currency"
                        value={appForm.currency}
                        onChange={(e) => setAppForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
                        placeholder="PHP"
                        maxLength={10}
                        className={cn(
                          "font-mono text-sm max-w-xs",
                          !appIntlValid.currency && appForm.currency.trim() && "border-destructive"
                        )}
                      />
                      <p className="text-xs text-muted-foreground">Examples: PHP, USD, SGD. Used for amounts and reports across the app.</p>
                      {!appIntlValid.currency && appForm.currency.trim() ? (
                        <p className="text-xs text-destructive">Enter a valid ISO 4217 currency code.</p>
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="tz">Timezone (IANA)</Label>
                      <Input
                        id="tz"
                        list="tz-suggestions"
                        value={appForm.timezone}
                        onChange={(e) => setAppForm((f) => ({ ...f, timezone: e.target.value }))}
                        placeholder="Asia/Manila"
                        className={cn(
                          "font-mono text-sm",
                          !appIntlValid.timezone && appForm.timezone.trim() && "border-destructive"
                        )}
                      />
                      <datalist id="tz-suggestions">
                        {APP_TIMEZONE_OPTIONS.map((t) => (
                          <option key={t.value} value={t.value} label={t.label} />
                        ))}
                      </datalist>
                      <p className="text-xs text-muted-foreground">
                        Used for receipts, POS, and dashboard dates.
                      </p>
                      {!appIntlValid.timezone && appForm.timezone.trim() ? (
                        <p className="text-xs text-destructive">Enter a valid IANA timezone (e.g. Asia/Manila).</p>
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="memberDisc">Default member discount %</Label>
                      <Input
                        id="memberDisc"
                        type="number"
                        min={0}
                        max={100}
                        value={appForm.memberDefaultDiscountPercent}
                        onChange={(e) =>
                          setAppForm((f) => ({
                            ...f,
                            memberDefaultDiscountPercent: parseInt(e.target.value, 10) || 0,
                          }))
                        }
                      />
                      <p className="text-xs text-muted-foreground">Pre-filled when registering a new member.</p>
                    </div>
                    <div className="space-y-3 sm:col-span-2">
                      <div>
                        <p className="text-sm font-medium">Purchase order discounts by organization type</p>
                        <p className="text-xs text-muted-foreground">
                          Auto-applied when a purchase order organization is selected. Only administrators
                          can override on individual orders.
                        </p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {PO_DISCOUNT_ORG_TYPES.map((orgType) => (
                          <div key={orgType} className="space-y-2">
                            <Label htmlFor={`po-disc-${orgType}`}>
                              {PO_DISCOUNT_ORG_TYPE_LABELS[orgType]} %
                            </Label>
                            <Input
                              id={`po-disc-${orgType}`}
                              type="number"
                              min={0}
                              max={100}
                              step={0.01}
                              value={appForm.purchaseOrderDiscountByOrgType[orgType]}
                              onChange={(e) => {
                                const n = parseFloat(e.target.value);
                                setAppForm((f) => ({
                                  ...f,
                                  purchaseOrderDiscountByOrgType: {
                                    ...f.purchaseOrderDiscountByOrgType,
                                    [orgType]: Number.isFinite(n)
                                      ? Math.min(100, Math.max(0, n))
                                      : 0,
                                  },
                                }));
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lowStock">Default low-stock threshold</Label>
                      <Input
                        id="lowStock"
                        type="number"
                        min={1}
                        value={appForm.defaultLowStockThreshold}
                        onChange={(e) =>
                          setAppForm((f) => ({
                            ...f,
                            defaultLowStockThreshold: parseInt(e.target.value, 10) || 1,
                          }))
                        }
                      />
                      <p className="text-xs text-muted-foreground">Used when new branch inventory rows are created.</p>
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Marketplace fulfillment branch</Label>
                      <Select
                        value={appForm.marketplaceFulfillmentBranchId || "__default__"}
                        onValueChange={(v) =>
                          setAppForm((f) => ({
                            ...f,
                            marketplaceFulfillmentBranchId: v === "__default__" ? "" : v,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Head office (default)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__default__">Head office (default)</SelectItem>
                          {branches.map((b) => (
                            <SelectItem key={b._id} value={b._id}>
                              {b.name}
                              {b.code ? ` (${b.code})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Branch inventory used when customers place online orders. Leave as head office if unset.
                      </p>
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Spin wheel "Free Perfume" gift product</Label>
                      {appForm.spinWheelFreeGiftProductId ? (
                        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                          <span className="flex-1 font-medium">
                            {spinWheelGiftProductName || appForm.spinWheelFreeGiftProductId}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-6 text-xs text-muted-foreground"
                            onClick={() =>
                              setAppForm((f) => ({ ...f, spinWheelFreeGiftProductId: "" }))
                            }
                          >
                            Change
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              className="pl-9"
                              placeholder="Search product name..."
                              value={spinWheelGiftSearch}
                              onChange={(e) => {
                                const v = e.target.value;
                                setSpinWheelGiftSearch(v);
                                void searchSpinWheelGiftProducts(v);
                              }}
                            />
                            {spinWheelGiftSearchLoading && (
                              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                            )}
                          </div>
                          {spinWheelGiftResults.length > 0 && (
                            <div className="max-h-40 overflow-y-auto rounded-md border bg-popover shadow-sm">
                              {spinWheelGiftResults.map((p) => (
                                <button
                                  key={p._id}
                                  type="button"
                                  className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                                  onClick={() => {
                                    setAppForm((f) => ({ ...f, spinWheelFreeGiftProductId: p._id }));
                                    setSpinWheelGiftProductName(p.name);
                                    setSpinWheelGiftResults([]);
                                    setSpinWheelGiftSearch("");
                                  }}
                                >
                                  {p.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Awarded by the storefront spin wheel. Leave unset to exclude "Free Perfume" from the prize pool.
                      </p>
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="receiptFooter">Receipt footer</Label>
                      <textarea
                        id="receiptFooter"
                        value={appForm.receiptFooter}
                        onChange={(e) => setAppForm((f) => ({ ...f, receiptFooter: e.target.value }))}
                        placeholder="Optional message on printed receipts (e.g. return policy, TIN)."
                        rows={3}
                        className={cn(
                          "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm",
                          "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                          "disabled:cursor-not-allowed disabled:opacity-50"
                        )}
                      />
                    </div>
                  </div>
                  )}
                  <div className="flex justify-end pt-2">
                    <Button
                      onClick={() => appSettingsMutation.mutate()}
                      disabled={
                        appSettingsMutation.isPending ||
                        appSettingsLoading ||
                        !appForm.appName.trim() ||
                        !appIntlValid.currency ||
                        !appIntlValid.timezone ||
                        !Number.isFinite(Number(appForm.memberDefaultDiscountPercent)) ||
                        Number(appForm.memberDefaultDiscountPercent) < 0 ||
                        Number(appForm.memberDefaultDiscountPercent) > 100 ||
                        !Number.isFinite(Number(appForm.defaultLowStockThreshold)) ||
                        Number(appForm.defaultLowStockThreshold) < 1
                      }
                    >
                      {appSettingsMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : null}
                      Save application settings
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

          <TabsContent value="roles" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Roles &amp; permissions
                  </CardTitle>
                  <CardDescription>
                    Sync MongoDB role documents and user permission arrays from{" "}
                    <code className="text-xs">lib/permissions.ts</code>. Run after changing role defaults in code.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {rolesError ? (
                    <Alert variant="destructive">
                      <AlertDescription>
                        {rolesCompareError instanceof Error
                          ? rolesCompareError.message
                          : "Unable to load roles."}
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  {!rolesLoading && rolesDriftCount > 0 ? (
                    <Alert>
                      <AlertDescription>
                        {rolesDriftCount} role{rolesDriftCount === 1 ? "" : "s"} out of sync with code defaults.
                        Sync to align the database.
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  {!rolesLoading && rolesCompare && rolesDriftCount === 0 ? (
                    <Alert variant="success">
                      <CheckCircle className="h-4 w-4" />
                      <AlertDescription>All roles match code defaults.</AlertDescription>
                    </Alert>
                  ) : null}

                  {rolesLoading ? (
                    <div className="space-y-2">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full" />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/60">
                          <tr>
                            <th className="text-left px-3 py-2 font-medium">Role</th>
                            <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">
                              Code
                            </th>
                            <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">
                              Database
                            </th>
                            <th className="text-right px-3 py-2 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {(rolesCompare?.codeDefaults ?? []).map((code) => {
                            const db = dbRoleByName.get(code.name);
                            const inSync = rolePermissionsInSync(code, db);
                            return (
                              <tr key={code.name} className="hover:bg-muted/30">
                                <td className="px-3 py-2.5">
                                  <p className="font-medium">{code.displayName}</p>
                                  <p className="text-xs text-muted-foreground font-mono">{code.name}</p>
                                </td>
                                <td className="px-3 py-2.5 hidden sm:table-cell text-muted-foreground">
                                  {code.permissions.length} permissions
                                </td>
                                <td className="px-3 py-2.5 hidden sm:table-cell text-muted-foreground">
                                  {db ? `${db.permissions.length} permissions` : "Missing"}
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                  <Badge variant={inSync ? "success" : "warning"}>
                                    {inSync ? "In sync" : db ? "Drift" : "Missing"}
                                  </Badge>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                    <p className="text-sm font-medium">Sync options</p>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <Checkbox
                        checked={syncRolesOption}
                        onCheckedChange={(v) => setSyncRolesOption(v === true)}
                      />
                      <span className="text-sm leading-tight">
                        <span className="font-medium">Role documents</span>
                        <span className="block text-muted-foreground text-xs mt-0.5">
                          Upsert system roles in MongoDB from code.
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <Checkbox
                        checked={syncUsersOption}
                        onCheckedChange={(v) => setSyncUsersOption(v === true)}
                      />
                      <span className="text-sm leading-tight">
                        <span className="font-medium">User permissions</span>
                        <span className="block text-muted-foreground text-xs mt-0.5">
                          Reset each active user&apos;s stored permissions to their role defaults.
                          Users should sign in again to refresh sessions.
                        </span>
                      </span>
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void refetchRoles()}
                      disabled={rolesLoading || rolesSyncMutation.isPending}
                    >
                      <RefreshCw className={cn("h-4 w-4 mr-2", rolesLoading && "animate-spin")} />
                      Refresh
                    </Button>
                    <Button
                      type="button"
                      onClick={async () => {
                        if (syncUsersOption) {
                          const ok = await confirm({
                            title: "Update permission arrays for all active users?",
                            description:
                              "This updates permission arrays for all active users matching their roles. Users may need to sign in again.",
                            variant: "destructive",
                            confirmText: "Sync",
                          });
                          if (!ok) return;
                        }
                        rolesSyncMutation.mutate();
                      }}
                      disabled={
                        rolesSyncMutation.isPending ||
                        rolesLoading ||
                        (!syncRolesOption && !syncUsersOption)
                      }
                    >
                      {rolesSyncMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-2" />
                      )}
                      Sync now
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

        </Tabs>
      </div>
    </div>
  );
}
