import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Lock, Sparkles, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cloudinaryTransformedUrl } from "@/lib/utils/cloudinaryTransform";
import { isRemoteUrl } from "./shared";
import { PRODUCT_CATEGORIES } from "@/lib/products/catalog";
import type { FeaturedPromo } from "@/lib/services/coupon.service";

const TRUST_CARDS = [
  {
    title: "Secure Checkout",
    description: "Safe & encrypted payments",
    icon: Lock,
  },
  {
    title: "Fast Delivery",
    description: "Nationwide shipping you can trust",
    icon: Truck,
  },
];

type HomePromoRailProps = {
  imageUrl?: string | null;
  promo?: FeaturedPromo | null;
  impactEnabled?: boolean;
  impactImageUrl?: string | null;
  impactTitle?: string | null;
  impactContent?: string | null;
};

function promoHeadline(promo?: FeaturedPromo | null): string {
  if (!promo) return "20% OFF";
  if (promo.type === "percent") return `${promo.value}% OFF`;
  if (promo.type === "fixed") return `₱${promo.value} OFF`;
  if (promo.type === "free_shipping") return "FREE SHIPPING";
  return "A FREE GIFT";
}

function promoCategoryLabel(promo?: FeaturedPromo | null): string | null {
  if (!promo?.category) return null;
  return PRODUCT_CATEGORIES.find((c) => c.value === promo.category)?.label ?? null;
}

export function HomePromoRail({
  imageUrl,
  promo,
  impactEnabled = true,
  impactImageUrl,
  impactTitle,
  impactContent,
}: HomePromoRailProps) {
  return (
    <aside className="hidden flex-col gap-4 xl:flex" aria-label="Offers and store guarantees">
      {impactEnabled ? (
        <div className="rounded-[10px] border border-[#e6f1d8] bg-[#f3f9ec] p-5 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-white shadow-sm">
            <Image
              src={impactImageUrl?.trim() || "/wise.jpg"}
              alt="WISE Foundation — Women In the Service for Everyone"
              width={56}
              height={56}
              className="h-full w-full object-contain"
            />
          </span>
          <p className="mt-3 text-sm font-semibold text-[#1f2a44]">
            {impactTitle?.trim() || "Your glow gives back"}
          </p>
          <p className="mt-1.5 text-xs leading-5 text-[#64748b]">
            {impactContent?.trim() ||
              "Every order supports the Wise Foundation. Each time you treat yourself, you help brighten someone else's day too — thank you for glowing with purpose."}
          </p>
        </div>
      ) : null}

      <div className="space-y-3 rounded-[10px] border border-[#dde8d4] bg-white p-4 shadow-[0_2px_12px_rgba(70,90,58,0.06)]">
        {TRUST_CARDS.map((card) => (
          <div key={card.title} className="flex items-start gap-3 rounded-[10px] border border-[#f0ecf8] bg-[#f4f8f0] p-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#eef6e4]">
              <card.icon className="h-5 w-5 text-[#477d34]" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold text-[#1f2a44]">{card.title}</p>
              <p className="mt-0.5 text-xs leading-5 text-[#64748b]">{card.description}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="relative overflow-hidden rounded-[10px] border border-[#d9e6cd] bg-gradient-to-b from-[#eef4e8] via-[#f6faf3] to-[#fbfdf9] p-6 text-center shadow-[0_2px_12px_rgba(70,90,58,0.06)]">
        <span className="inline-flex items-center gap-1.5 rounded-[10px] bg-white/80 px-3 py-1 text-xs font-semibold text-[#a24b96]">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          Special Offer
        </span>
        <p className="mt-4 font-[family-name:var(--font-yellowtail)] text-3xl font-normal leading-snug text-[#3c2e60]">
          Glow More,
          <br />
          Save More!
        </p>
        <p className="mt-3 text-sm leading-6 text-[#4a5568]">
          Enjoy up to{" "}
          <span className="block text-2xl font-bold text-[#1f2a44]">{promoHeadline(promo)}</span>
          {promoCategoryLabel(promo) ? `on ${promoCategoryLabel(promo)}.` : "on selected products."}
        </p>
        {promo ? (
          <p className="mt-2 text-xs text-[#4a5568]">
            Use code{" "}
            <span className="rounded bg-white/80 px-2 py-0.5 font-mono font-semibold text-[#1f2a44]">
              {promo.code}
            </span>{" "}
            at checkout
          </p>
        ) : null}
        <Button
          className="mt-5 h-10 w-full rounded-[10px] bg-gradient-to-r from-[#6ea43f] to-[#477d34] text-white shadow-[0_10px_30px_rgba(71,125,52,0.24)] hover:from-[#5f9636] hover:to-[#3f702e]"
          asChild
        >
          <Link href={promo?.category ? `/shop?category=${promo.category}` : "/shop"}>
            Shop deals now
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
        {imageUrl ? (
          <div className="relative mt-5 aspect-[4/5] w-full overflow-hidden rounded-[10px]">
            {isRemoteUrl(imageUrl) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cloudinaryTransformedUrl(imageUrl, { width: 400, crop: "limit" })}
                alt="Featured Glowish products"
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            ) : (
              <Image
                src={imageUrl}
                alt="Featured Glowish products"
                fill
                className="object-cover"
                sizes="280px"
              />
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
