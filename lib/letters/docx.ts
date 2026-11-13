// .docx generation with docxtemplater + pizzip.
// Templates come from the private `templates` bucket (uploaded by the admin); built-in placeholders are used until then.
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import QRCode from "qrcode";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
type RunOpts = { b?: boolean; u?: boolean; size?: number; caps?: boolean };
const rPr = (o: RunOpts = {}) => `<w:rPr>${o.b ? "<w:b/>" : ""}${o.u ? '<w:u w:val="single"/>' : ""}${o.caps ? "<w:caps/>" : ""}${o.size ? `<w:sz w:val="${o.size * 2}"/><w:szCs w:val="${o.size * 2}"/>` : ""}</w:rPr>`;
export const run = (t: string, o: RunOpts = {}) => `<w:r>${rPr(o)}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
export const para = (runs: string, o: { jc?: "left" | "center" | "right" | "both"; after?: number; keep?: boolean } = {}) =>
  `<w:p><w:pPr>${o.keep ? "<w:keepNext/>" : ""}<w:spacing w:after="${o.after ?? 160}"/><w:jc w:val="${o.jc ?? "both"}"/></w:pPr>${runs}</w:p>`;
const cell = (content: string, w: number, opts: { borders?: boolean } = {}) =>
  `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${opts.borders ? "" : '<w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders>'}</w:tcPr>${content}</w:tc>`;
export const table = (rows: string[][], widths: number[], borders = true) =>
  `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/>${borders ? '<w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders>' : ""}<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${rows.map((r) => `<w:tr>${r.map((c, i) => cell(c, widths[i]!, { borders })).join("")}</w:tr>`).join("")}</w:tbl>`;

const QR_DRAWING = (rid: string, emu = 720000) => `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${emu}" cy="${emu}"/><wp:docPr id="77" name="QR" descr="QR"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="77" name="qr.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu}" cy="${emu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

/** Standard MoH letterhead table: contacts left; Coat of Arms and THE REPUBLIC OF UGANDA centre; Ministry address right. No flag bars. */
export function letterheadXml(withRef = true): string {
  const small = (t: string) => para(run(t, { size: 8 }), { jc: "left", after: 0 });
  const right = (t: string) => para(run(t, { size: 8 }), { jc: "right", after: 0 });
  const coat = table([[para(run("Coat of Arms", { size: 7 }), { jc: "center", after: 0 })]], [1100], true)
    .replace("<w:tr>", '<w:tr><w:trPr><w:trHeight w:val="1050" w:hRule="exact"/><w:jc w:val="center"/></w:trPr>')
    .replace("<w:tblLayout", '<w:jc w:val="center"/><w:tblLayout');
  return table([[
    ["Telephone: General Lines: 340874/231563/9", "Permanent Secretary's Office: 340872", "Fax: 231584", "E-mail: ps@health.go.ug", "Website: www.health.go.ug"].map(small).join(""),
    `${coat}${para(run("THE REPUBLIC OF UGANDA", { b: true, size: 9 }), { jc: "center", after: 0 })}`,
    ["Ministry of Health", "P. O. Box 7272", "Plot 6 Lourdel Road, Wandegeya", "KAMPALA"].map(right).join(""),
  ]], [3400, 2400, 3400], false)
    + para(run("MINISTRY OF HEALTH", { b: true }), { jc: "center", after: 80 })
    + (withRef ? para(run("IN ANY CORRESPONDENCE ON THIS SUBJECT PLEASE QUOTE NO. {ref}", { size: 9 }), { jc: "left", after: 80 }) : "");
}

function pkg(body: string, opts: { qr?: boolean; landscapeTail?: boolean } = {}): Uint8Array {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${opts.qr ? '<Relationship Id="rIdQr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/qr.png"/>' : ""}</Relationships>`);
  zip.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Bookman Old Style" w:hAnsi="Bookman Old Style" w:cs="Bookman Old Style" w:eastAsia="Bookman Old Style"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:jc w:val="both"/><w:spacing w:after="160" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`);
  if (opts.qr) zip.file("word/media/qr.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
  const portrait = '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1200" w:bottom="1000" w:left="1200" w:header="500" w:footer="500" w:gutter="0"/>';
  const landscape = '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000" w:header="500" w:footer="500" w:gutter="0"/>';
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}<w:sectPr>${opts.landscapeTail ? landscape : portrait}</w:sectPr></w:body></w:document>`);
  return zip.generate({ type: "uint8array" });
}
/** A paragraph holding only a loop/condition tag (removed by docxtemplater's paragraphLoop). */
const T = (tag: string) => para(run(tag), { jc: "left", after: 0 });
const sectionBreakPortrait = '<w:p><w:pPr><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1200" w:bottom="1000" w:left="1200" w:header="500" w:footer="500" w:gutter="0"/></w:sectPr></w:pPr></w:p>';

/** Built-in letter template (placeholders documented in README). */
export function defaultLetterTemplate(): Uint8Array {
  const body = letterheadXml(true)
    + para(run("{date}"), { jc: "right" })
    + T("{#to}") + para(run("{line}"), { jc: "left", after: 0 }) + T("{/to}")
    + para("", { after: 120 })
    + para(run("RE: {re}", { b: true, u: true }), { jc: "both" })
    + T("{#paras}") + para(run("{text}")) + T("{/paras}")
    + T("{#hasBold}") + para(run("{bold}", { b: true })) + T("{/hasBold}")
    + T("{#hasClose}") + para(run("{close}")) + T("{/hasClose}")
    + T("{#single}") + para("", { after: 600 }) + para(run("…………………………………"), { jc: "left", after: 0 }) + para(run("{signer}", { b: true }), { jc: "left", after: 0 }) + para(run("{signTitle}", { b: true }), { jc: "left" }) + T("{/single}")
    + T("{#signers2}") + para("", { after: 500 }) + para(run("………………………………  {name}, {title}"), { jc: "left" }) + T("{/signers2}")
    + T("{#hasCc}") + para(run("CC.", { b: true }), { jc: "left", after: 0 }) + T("{#cc}") + para(run("\t{line}"), { jc: "left", after: 0 }) + T("{/cc}") + T("{/hasCc}")
    + T("{#isLetter}") + table([[para(QR_DRAWING("rIdQr"), { jc: "left", after: 0 }), para(run("Verification no. {code}. Scan the code or visit {verifyUrl} to confirm this letter is genuine and to record its receipt.", { size: 8 }), { jc: "left", after: 0 })]], [1300, 7900], false) + T("{/isLetter}");
  return pkg(body, { qr: true });
}

/** Cover internal memo: From / Thru / To, fixed wording. */
export function defaultMemoTemplate(): Uint8Array {
  const body = letterheadXml(false)
    + para(run("INTERNAL MEMO", { b: true, u: true }), { jc: "center" })
    + table([["To:", "{to}"], ["Thru:", "{thru}"], ["From:", "{from}"], ["Date:", "{date}"]].map(([a, b]) => [para(run(a!, { b: true }), { jc: "left", after: 40 }), para(run(b!), { jc: "left", after: 40 })]), [1400, 7800], false)
    + para("", { after: 80 })
    + para(run("RE: {re}", { b: true, u: true }))
    + para(run("The above subject matter refers."))
    + T("{#hasList}") + para(run("{intro}")) + T("{#list}") + para(run("{line}"), { jc: "left", after: 40 }) + T("{/list}") + T("{/hasList}")
    + para(run("The purpose of this memo, therefore, is to request your review and or signature on the attached letter(s)."))
    + para(run("Thank you."))
    + para("", { after: 500 }) + para(run("{from}", { b: true }), { jc: "left" });
  return pkg(body);
}

/** Minutes in the predecessor's format: heading, agenda, attendance, Particulars table per referral, landscape table for retirements. */
export function defaultMinutesTemplate(): Uint8Array {
  const hdr = (t: string) => para(run(t, { b: true, u: true }), { jc: "left", keep: true });
  const kv = (k: string, v: string) => [para(run(k, { b: true }), { jc: "left", after: 0 }), para(run(v), { jc: "left", after: 0 })];
  const partRows = [["Name", "{name}"], ["Age", "{age} years"], ["Gender", "{gender}"], ["Diagnosis", "{diagnosis}"], ["Reason for referral", "{procedure}"],
    ["Referring doctor", "{referring}"], ["Receiving doctor and centre", "{receiving}"], ["Country", "{country}"], ["Cost of treatment", "{cost}"],
    ["Source of funding", "{funding}"], ["Duration of stay", "{duration}"], ["Person accompanying", "{accompanying}"], ["Decision of the Board", "{decision}"]].map(([k, v]) => kv(k!, v!));
  const retHead = ["S/N", "Minute", "Name", "Employer", "Station", "Age", "Decision"].map((t) => para(run(t, { b: true, size: 9 }), { jc: "left", after: 0 }));
  const retRow = ["{#retire}{serial}", "{minute}", "{name}", "{employer}", "{station}", "{age}", "{decision}{/retire}"].map((t) => para(run(t, { size: 9 }), { jc: "left", after: 0 }));
  const body = para(run("{heading}", { b: true }), { jc: "center" })
    + hdr("Agenda") + T("{#agenda}") + para(run("{line}"), { jc: "left", after: 40 }) + T("{/agenda}")
    + hdr("Attendance") + T("{#attendance}") + para(run("{line}"), { jc: "left", after: 40 }) + T("{/attendance}")
    + hdr("{casesMinute}: Presentation and discussion of cases")
    + T("{#hasReferrals}") + para(run("Referral abroad", { b: true }), { jc: "left" }) + T("{/hasReferrals}")
    + T("{#referrals}") + para(run("{minute}", { b: true }), { jc: "left", keep: true }) + table(partRows, [3000, 6200]) + para("", { after: 200 }) + T("{/referrals}")
    + para(run("There being no other business, the meeting was adjourned at …………"), { jc: "left" })
    + para("", { after: 500 })
    + table([[para(run("…………………………"), { jc: "left", after: 0 }) + para(run("{chairName}", { b: true }), { jc: "left", after: 0 }) + para(run("Chairperson"), { jc: "left", after: 0 }),
      para(run("…………………………"), { jc: "left", after: 0 }) + para(run("{secName}", { b: true }), { jc: "left", after: 0 }) + para(run("Secretary"), { jc: "left", after: 0 })]], [4600, 4600], false)
    + sectionBreakPortrait
    + T("{#hasRetire}") + para(run("Retirement on medical grounds", { b: true, u: true }), { jc: "left" })
    + table([retHead, retRow], [700, 2300, 2800, 2600, 2600, 800, 2400]) + T("{/hasRetire}");
  return pkg(body, { landscapeTail: true });
}

/** Fill a template; replace the image whose alt text is "QR" with a QR code for `qrUrl`. */
export async function renderDocx(template: Uint8Array | ArrayBuffer, data: Record<string, unknown>, qrUrl?: string): Promise<Uint8Array> {
  const zip = new PizZip(template);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
  doc.render(data);
  const out = doc.getZip();
  if (qrUrl) {
    const xml = out.file("word/document.xml")?.asText() ?? "";
    const m = xml.match(/<wp:docPr[^>]*descr="QR"[^>]*\/>[\s\S]*?r:embed="([^"]+)"/);
    if (m) {
      const rels = out.file("word/_rels/document.xml.rels")?.asText() ?? "";
      const t = rels.match(new RegExp(`Id="${m[1]}"[^>]*Target="([^"]+)"`)) ?? rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${m[1]}"`));
      if (t) out.file("word/" + t[1]!.replace(/^\/?word\//, ""), await QRCode.toBuffer(qrUrl, { width: 300, margin: 1 }));
    }
  }
  return out.generate({ type: "uint8array", compression: "DEFLATE" });
}
