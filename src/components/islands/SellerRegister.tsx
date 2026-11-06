import { useEffect, useState } from "react";
import ShopForm, { emptyShop, valuesToPayload } from "./ShopForm";
import { rpc, supabase } from "../../lib/supabase";
import { loadMe, requireSession } from "../../lib/session";
import type { Me, Plan } from "../../lib/types";

export default function SellerRegister() {
  const [me, setMe] = useState<Me | null>(null);
  const [maxPhotos, setMaxPhotos] = useState(3);

  useEffect(() => {
    requireSession().then(async (s) => {
      if (!s) return;
      setMe(await loadMe());
      const plans = await rpc<Plan[]>(supabase(), "list_plans").catch(() => []);
      setMaxPhotos(plans.find((p) => p.code === "free")?.max_photos ?? 3);
    });
  }, []);

  if (!me) return <div className="h-64 animate-pulse rounded-2xl bg-sand" />;

  const initial = { ...emptyShop(), owner_name: me.full_name ?? "", phone: me.phone ?? "", email: me.email ?? "" };
  return (
    <div className="space-y-5">
      {me.shops.length > 0 && (
        <div className="rounded-2xl border border-line bg-white p-4 text-sm">
          You already have {me.shops.length === 1 ? "a shop" : `${me.shops.length} shops`} registered.{" "}
          <a className="font-semibold text-brand-700 underline" href="/seller">Go to your dashboard</a> — or add another branch below.
        </div>
      )}
      <ShopForm
        initial={initial}
        maxPhotos={maxPhotos}
        submitLabel="Submit for approval"
        onSubmit={async (v) => {
          const r = await rpc<{ id: string }>(supabase(), "create_shop", { p: valuesToPayload(v) });
          window.location.href = `/seller?shop=${r.id}&new=1`;
        }}
      />
    </div>
  );
}
