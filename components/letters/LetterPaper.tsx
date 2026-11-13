"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { LetterView, Memo } from "@/lib/letters/content";

export function Letterhead({ refNo, date }: { refNo?: string; date?: string }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, alignItems: "start", fontSize: 10.5, lineHeight: 1.4 }}>
        <div>Telephone: General Lines: 340874/231563/9<br />Permanent Secretary&apos;s Office: 340872<br />Fax: 231584<br />E-mail: ps@health.go.ug</div>
        <div className="stack" style={{ alignItems: "center", gap: 4 }}>
          <div aria-label="Coat of Arms placeholder" style={{ width: 62, height: 62, border: "1px dashed #9A9BA1", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, textAlign: "center" }}>Coat of Arms</div>
          <b style={{ fontSize: 11 }}>THE REPUBLIC OF UGANDA</b>
        </div>
        <div style={{ textAlign: "right" }}>Ministry of Health<br />P. O. Box 7272<br />Plot 6 Lourdel Road, Wandegeya<br />KAMPALA</div>
      </div>
      <b style={{ textAlign: "center" }}>MINISTRY OF HEALTH</b>
      {refNo && <div style={{ fontSize: 10.5 }}>IN ANY CORRESPONDENCE ON THIS SUBJECT PLEASE QUOTE NO. {refNo}</div>}
      {date && <div style={{ textAlign: "right" }}>{date}</div>}
    </div>
  );
}

export function LetterPaper({ v }: { v: LetterView }) {
  const [qr, setQr] = useState("");
  useEffect(() => { QRCode.toDataURL(v.verifyUrl, { margin: 0, width: 160 }).then(setQr).catch(() => setQr("")); }, [v.verifyUrl]);
  return (
    <article className="letter stack" style={{ gap: 12, background: "#fff", border: "1px solid #E9E9EC", borderRadius: 6, padding: "28px 32px" }}>
      <Letterhead refNo={v.ref} date={v.date} />
      {v.to.length > 0 && <div>{v.to.map((t, i) => <div key={i}>{t}</div>)}</div>}
      <p style={{ fontWeight: 700, textDecoration: "underline" }}>RE: {v.re}</p>
      {v.paras.map((p, i) => <p key={i}>{p}</p>)}
      {v.bold && <p style={{ fontWeight: 700 }}>{v.bold}</p>}
      {v.close && <p>{v.close}</p>}
      {v.signers2.length ? (
        <div className="row" style={{ justifyContent: "space-between", marginTop: 24 }}>
          {v.signers2.map((s) => <div key={s.name} className="stack"><span>…………………………</span><b>{s.name}</b><span>{s.title}</span></div>)}
        </div>
      ) : (
        <div className="stack" style={{ marginTop: 24 }}><span>…………………………</span>{v.signer && <b>{v.signer}</b>}<b>{v.signTitle}</b></div>
      )}
      {v.cc.length > 0 && <div><b>CC.</b>{v.cc.map((c) => <div key={c} style={{ paddingLeft: 30 }}>{c}</div>)}</div>}
      {v.isLetter && (
        <div className="row" style={{ gap: 10, borderTop: "1px solid #ECECEE", paddingTop: 10, flexWrap: "nowrap", fontFamily: "Inter, sans-serif", fontSize: 11, textAlign: "left" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {qr && <img src={qr} alt="QR code for receipt confirmation" width={54} height={54} />}
          <span className="muted">Verification no. {v.code}. The receiving office scans this code, or visits {v.verifyUrl}, to confirm the letter is genuine and record receipt.</span>
        </div>
      )}
    </article>
  );
}

export function MemoPaper({ m }: { m: Memo }) {
  return (
    <article className="letter stack" style={{ gap: 10, background: "#fff", border: "1px solid #E9E9EC", borderRadius: 6, padding: "28px 32px" }}>
      <Letterhead />
      <b style={{ textAlign: "center", textDecoration: "underline" }}>INTERNAL MEMO</b>
      <div style={{ display: "grid", gridTemplateColumns: "70px 1fr", rowGap: 2 }}>
        <b>To:</b><span>{m.to}</span><b>Thru:</b><span>{m.thru}</span><b>From:</b><span>{m.from}</span><b>Date:</b><span>{m.date}</span>
      </div>
      <p style={{ fontWeight: 700, textDecoration: "underline" }}>RE: {m.re}</p>
      {m.paras.slice(0, m.list.length ? 2 : 1).map((p, i) => <p key={i}>{p}</p>)}
      {m.list.length > 0 && <div>{m.list.map((x) => <div key={x}>{x}</div>)}</div>}
      {m.paras.slice(m.list.length ? 2 : 1).map((p, i) => <p key={"b" + i}>{p}</p>)}
    </article>
  );
}
