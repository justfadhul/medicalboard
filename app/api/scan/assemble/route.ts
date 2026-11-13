import { NextResponse } from "next/server";
import { PDFDocument, degrees } from "pdf-lib";
import { guard } from "@/lib/api";

// Combines a document's scanned pages into one PDF (pdf-lib) stored next to the pages.
export async function POST(req: Request) {
  const g = await guard("registry", "secretariat", "commissioner");
  if ("error" in g) return g.error;
  const { documentId, url } = await req.json();
  const { data: doc } = await g.sb.from("case_documents").select("id,case_id,name,pdf_path,document_pages(path,page_no,rotation)").eq("id", documentId).maybeSingle();
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let path = doc.pdf_path as string | null;
  if (!path && doc.document_pages.length && g.role !== "commissioner") {
    const pdf = await PDFDocument.create();
    pdf.setTitle(doc.name); pdf.setLanguage("en-GB"); pdf.setProducer("UMB case system");
    for (const p of [...doc.document_pages].sort((a, b) => a.page_no - b.page_no)) {
      const { data } = await g.sb.storage.from("scans").download(p.path);
      if (!data) continue;
      const bytes = new Uint8Array(await data.arrayBuffer());
      const img = bytes[0] === 0x89 ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      const page = pdf.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      if (p.rotation) page.setRotation(degrees(p.rotation));
    }
    path = `${doc.case_id}/${doc.id}/combined-${Date.now()}.pdf`;
    const up = await g.sb.storage.from("scans").upload(path, await pdf.save(), { contentType: "application/pdf" });
    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });
    await g.sb.rpc("set_document_pdf", { p_doc: doc.id, p_path: path });
  }
  if (!path) return NextResponse.json({ error: "No pages" }, { status: 400 });
  const signed = url ? (await g.sb.storage.from("scans").createSignedUrl(path, 120)).data?.signedUrl : undefined;
  return NextResponse.json({ path, url: signed });
}
