import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicAppSettings } from "@/lib/types/appSettings";
import { absoluteUrl, getSiteUrl, resolveSiteDescription } from "@/lib/seo/site";

const baseSettings: PublicAppSettings = {
  appName: "Test Shop",
  appTagline: "Quality goods",
  appLogoUrl: "",
  seoDefaultDescription: "",
  seoOgImageUrl: "",
  currency: "PHP",
  timezone: "Asia/Manila",
  memberDefaultDiscountPercent: 10,
  defaultLowStockThreshold: 10,
  receiptFooter: "",
  purchaseOrderDiscountByOrgType: {
    distributor: 0,
    franchise: 0,
    partner: 0,
    headquarters: 0,
  },
  imageUploadEnabled: false,
  impactEnabled: true,
  impactImageUrl: "",
  impactTitle: "Your glow gives back",
  impactContent: "Every order supports the Wise Foundation.",
};

describe("getSiteUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses NEXT_PUBLIC_APP_URL without trailing slash", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://shop.example.com/");
    expect(getSiteUrl()).toBe("https://shop.example.com");
  });

  it("falls back to localhost when unset", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(getSiteUrl()).toBe("http://localhost:3000");
  });
});

describe("absoluteUrl", () => {
  it("joins base and path", () => {
    expect(absoluteUrl("/shop", "https://shop.example.com")).toBe(
      "https://shop.example.com/shop"
    );
  });
});

describe("resolveSiteDescription", () => {
  it("prefers seoDefaultDescription over tagline", () => {
    expect(
      resolveSiteDescription({
        ...baseSettings,
        seoDefaultDescription: "Custom meta",
        appTagline: "Tagline",
      })
    ).toBe("Custom meta");
  });

  it("falls back to tagline then generic", () => {
    expect(resolveSiteDescription({ ...baseSettings, appTagline: "Tagline" })).toBe(
      "Tagline"
    );
    expect(resolveSiteDescription({ ...baseSettings, appTagline: "" })).toMatch(
      /Shop online/
    );
  });
});
