import { useRef, useState } from "react";
import { uploadPhoto } from "../../lib/image";
import { mediaUrl } from "../../lib/format";

type Props = {
  value: string[];
  onChange: (v: string[]) => void;
  max: number;
  folder: "shops" | "sarees";
  label: string;
  hint?: string;
};

export default function ImageUploader({ value, onChange, max, folder, label, hint }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setErr(null);
    const room = max - valueRef.current.length;
    const list = Array.from(files).slice(0, Math.max(0, room));
    if (files.length > room) setErr(`You can add ${max} photos. Extra ones were skipped.`);
    setBusy((b) => b + list.length);
    for (const f of list) {
      try {
        const path = await uploadPhoto(f, folder);
        onChange([...valueRef.current, path]);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setBusy((b) => b - 1);
      }
    }
    if (input.current) input.current.value = "";
  }

  const move = (i: number, d: number) => {
    const v = [...value];
    const j = i + d;
    if (j < 0 || j >= v.length) return;
    [v[i], v[j]] = [v[j], v[i]];
    onChange(v);
  };

  return (
    <div>
      <p className="label">{label} <span className="normal-case tracking-normal text-muted">({value.length}/{max})</span></p>
      {hint && <p className="-mt-0.5 mb-2 text-xs text-muted">{hint}</p>}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
        {value.map((p, i) => (
          <div key={p} className="group relative aspect-square overflow-hidden rounded-xl border border-line bg-sand">
            <img src={mediaUrl(p, "thumb")!} alt="" className="h-full w-full object-cover" />
            {i === 0 && <span className="badge absolute left-1 top-1 bg-brand-700 text-white">Cover</span>}
            <div className="absolute inset-x-0 bottom-0 flex justify-between bg-gradient-to-t from-black/60 p-1">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded bg-white/90 px-1.5 text-xs disabled:opacity-30" aria-label="Move left">←</button>
              <button type="button" onClick={() => onChange(value.filter((x) => x !== p))} className="rounded bg-white/90 px-1.5 text-xs text-brand-700" aria-label="Remove photo">✕</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === value.length - 1} className="rounded bg-white/90 px-1.5 text-xs disabled:opacity-30" aria-label="Move right">→</button>
            </div>
          </div>
        ))}
        {Array.from({ length: busy }).map((_, i) => (
          <div key={`b${i}`} className="grid aspect-square place-items-center rounded-xl border border-dashed border-line bg-white text-xs text-muted">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-sand border-t-brand-700" />
          </div>
        ))}
        {value.length + busy < max && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="grid aspect-square place-items-center rounded-xl border-2 border-dashed border-line bg-white text-center text-xs font-semibold text-muted hover:border-brand-200 hover:text-brand-700"
          >
            <span>
              <span className="block text-2xl">＋</span>Add photo
            </span>
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />
      {err && <p className="mt-2 text-xs text-brand-700">{err}</p>}
    </div>
  );
}
