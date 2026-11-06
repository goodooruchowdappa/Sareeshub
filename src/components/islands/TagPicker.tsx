import { useEffect, useMemo, useState } from "react";
import { rpc, supabase } from "../../lib/supabase";
import { TAG_CATEGORIES } from "../../lib/config";
import type { TagRef } from "../../lib/types";

let cache: Promise<TagRef[]> | null = null;
const loadTags = () => (cache ??= rpc<TagRef[]>(supabase(), "list_tags"));

type Props = {
  value: TagRef[];
  onChange: (v: TagRef[]) => void;
  max: number;
  label: string;
  hint?: string;
  /** Limit which categories are offered (e.g. shops don't need "occasion"). */
  categories?: string[];
};

export default function TagPicker({ value, onChange, max, label, hint, categories }: Props) {
  const [all, setAll] = useState<TagRef[]>([]);
  const [q, setQ] = useState("");
  const [newCat, setNewCat] = useState("fabric");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    loadTags().then(setAll).catch(() => setErr("Couldn't load tags."));
  }, []);

  const chosen = new Set(value.map((t) => t.id));
  const cats = TAG_CATEGORIES.filter((c) => !categories || categories.includes(c.value));
  const needle = q.trim().toLowerCase();
  const groups = useMemo(
    () =>
      cats
        .map((c) => ({
          ...c,
          tags: all
            .filter((t) => t.category === c.value && (!needle || t.name.toLowerCase().includes(needle)))
            .filter((t) => showAll || needle || t.is_default || chosen.has(t.id))
            .slice(0, needle ? 50 : 40),
        }))
        .filter((g) => g.tags.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, needle, showAll, value, categories],
  );
  const exact = all.some((t) => t.name.toLowerCase() === needle);

  function toggle(t: TagRef) {
    setErr(null);
    if (chosen.has(t.id)) onChange(value.filter((x) => x.id !== t.id));
    else if (value.length >= max) setErr(`You can choose up to ${max} tags.`);
    else onChange([...value, t]);
  }

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const t = await rpc<TagRef & { created: boolean }>(supabase(), "create_tag", { p_name: q, p_category: newCat });
      if (!all.some((x) => x.id === t.id)) {
        const next = [...all, t];
        setAll(next);
        cache = Promise.resolve(next);
      }
      if (!chosen.has(t.id)) toggle(t);
      setQ("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't create tag.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="label">{label} <span className="normal-case tracking-normal text-muted">({value.length}/{max})</span></p>
      {hint && <p className="-mt-0.5 mb-2 text-xs text-muted">{hint}</p>}
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((t) => (
            <button type="button" key={t.id} className="chip chip-active" onClick={() => toggle(t)} aria-label={`Remove ${t.name}`}>
              {t.name} ✕
            </button>
          ))}
        </div>
      )}
      <div className="rounded-2xl border border-line bg-white p-3">
        <input
          className="input"
          placeholder="Search tags, or type a new one (e.g. “Gadwal Pattu”)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const first = groups[0]?.tags[0];
              if (first && !chosen.has(first.id) && first.name.toLowerCase() === needle) toggle(first);
            }
          }}
        />
        {needle.length >= 2 && !exact && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-sand p-2 text-sm">
            <span>
              Create “<strong>{q.trim()}</strong>” as
            </span>
            <select className="input !w-auto !py-1" value={newCat} onChange={(e) => setNewCat(e.target.value)} aria-label="Tag type">
              {TAG_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <button type="button" className="btn-primary !py-1.5" onClick={create} disabled={busy}>
              {busy ? "Adding…" : "Add tag"}
            </button>
          </div>
        )}
        <div className="mt-3 max-h-72 space-y-3 overflow-y-auto pr-1">
          {groups.map((g) => (
            <div key={g.value}>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{g.label}</p>
              <div className="flex flex-wrap gap-1.5">
                {g.tags.map((t) => (
                  <button type="button" key={t.id} onClick={() => toggle(t)} className={`chip ${chosen.has(t.id) ? "chip-active" : ""}`} aria-pressed={chosen.has(t.id)}>
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {groups.length === 0 && <p className="text-sm text-muted">No matching tags — create it above.</p>}
        </div>
        {!needle && (
          <button type="button" className="mt-2 text-xs font-semibold text-brand-700 underline" onClick={() => setShowAll((s) => !s)}>
            {showAll ? "Show common tags only" : "Show tags created by other sellers too"}
          </button>
        )}
      </div>
      {err && <p className="mt-2 text-xs text-brand-700">{err}</p>}
    </div>
  );
}
