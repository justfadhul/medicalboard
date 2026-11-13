"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CADRE_LABEL, type Cadre } from "@/lib/domain";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PageHead, Table } from "@/components/ui";
import { useToast } from "@/components/Toast";

type Item = { id: number; name: string; active: boolean; sort: number; cadre?: Cadre | null; head_title?: string | null };
const TEMPLATE_NAMES = ["letter.docx", "letter-retire.docx", "letter-intro.docx", "letter-funder.docx", "letter-extract.docx", "memo.docx", "minutes.docx", "MoH_Headed_letter_template.docx"];

export function ListsView({ employers, procedures, countries, templates }: { employers: Item[]; procedures: Item[]; countries: Item[]; templates: { name: string; updated: string }[] }) {
  const { toast } = useToast();
  const router = useRouter();
  const sb = supabaseBrowser();
  const done = (error: { message: string } | null, msg: string) => { if (error) toast(error.message, { tone: "error" }); else { toast(msg); router.refresh(); } };
  function ListEditor({ table, items, cadre }: { table: string; items: Item[]; cadre?: boolean }) {
    const [name, setName] = useState("");
    const cols = cadre ? "minmax(200px,2fr) 190px minmax(200px,1.4fr) 90px" : "minmax(200px,2fr) 90px";
    return (
      <div className="stack" style={{ gap: 8 }}>
        <Table cols={cols} head={cadre ? ["Name", "Cadre", "Head (addressee of retirement letters)", ""] : ["Name", ""]} minWidth={cadre ? 700 : 320}>
          {items.map((i) => (
            <div key={i.id} className="tr" style={{ gridTemplateColumns: cols, opacity: i.active ? 1 : 0.55 }} role="row">
              <span>{i.name}</span>
              {cadre && <select aria-label={`Cadre of ${i.name}`} value={i.cadre ?? ""} onChange={async (e) => done((await sb.from(table).update({ cadre: e.target.value || null }).eq("id", i.id)).error, "Saved")}>
                <option value="">None</option>{(Object.keys(CADRE_LABEL) as Cadre[]).filter((c) => c !== "all").map((c) => <option key={c} value={c}>{CADRE_LABEL[c].replace("All ", "")}</option>)}</select>}
              {cadre && <input aria-label={`Head of ${i.name}`} defaultValue={i.head_title ?? ""} placeholder={i.cadre === "police" ? "The Inspector General of Police (fixed)" : "Uses the setting (to confirm)"}
                onBlur={async (e) => { if (e.target.value !== (i.head_title ?? "")) done((await sb.from(table).update({ head_title: e.target.value || null }).eq("id", i.id)).error, "Saved"); }} />}
              <button className="btn sm" onClick={async () => done((await sb.from(table).update({ active: !i.active }).eq("id", i.id)).error, i.active ? "Hidden from new cases" : "Shown again")}>{i.active ? "Hide" : "Show"}</button>
            </div>
          ))}
        </Table>
        <form className="row" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; done((await sb.from(table).insert({ name: name.trim(), sort: items.length + 1 })).error, "Added"); setName(""); }}>
          <input aria-label="New entry" value={name} onChange={(e) => setName(e.target.value)} placeholder="Add an entry" style={{ maxWidth: 320 }} /><button className="btn">Add</button>
        </form>
      </div>
    );
  }
  async function upload(file: File, name: string) {
    const { error } = await sb.storage.from("templates").upload(name, file, { upsert: true, contentType: file.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    done(error, `${name} uploaded`);
  }
  async function download(name: string) {
    const { data } = await sb.storage.from("templates").createSignedUrl(name, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  }
  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead title="Lists and templates" sub="Dropdowns used on the New case form, and the Ministry's Word templates. Hidden entries stay on existing cases." />
      <h2 className="h2">Employers</h2><ListEditor table="employers" items={employers} cadre />
      <h2 className="h2">Procedures</h2><ListEditor table="procedures" items={procedures} />
      <h2 className="h2">Countries</h2><ListEditor table="countries" items={countries} />
      <h2 className="h2">Word templates</h2>
      <p className="muted t12">Upload the Ministry&apos;s templates (private bucket). Until then a placeholder letterhead with a “Coat of Arms” box is used. Placeholders are listed in the README; give the QR image the alt text “QR”.</p>
      <Table cols="minmax(240px,2fr) 180px 260px" head={["Template", "Uploaded", ""]}>
        {TEMPLATE_NAMES.map((n) => {
          const t = templates.find((x) => x.name === n);
          return (
            <div key={n} className="tr" style={{ gridTemplateColumns: "minmax(240px,2fr) 180px 260px" }} role="row">
              <span>{n}</span><span className="t12">{t ? new Date(t.updated).toLocaleString("en-GB") : "Built-in placeholder"}</span>
              <span className="row" style={{ gap: 4 }}>
                <label className="btn sm">Upload<input type="file" accept=".docx" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], n)} /></label>
                {t && <button className="btn sm" onClick={() => download(n)}>Download</button>}
                {t && <button className="btn sm ghost" onClick={async () => done((await sb.storage.from("templates").remove([n])).error, "Removed: the placeholder is used again")}>Remove</button>}
              </span>
            </div>
          );
        })}
      </Table>
    </div>
  );
}
