// Writes the built-in placeholder templates to templates/ so the admin can see the placeholders and adapt the Ministry's files.
import fs from "node:fs";
import { defaultLetterTemplate, defaultMemoTemplate, defaultMinutesTemplate } from "../lib/letters/docx.ts";

fs.mkdirSync("templates", { recursive: true });
fs.writeFileSync("templates/letter.docx", defaultLetterTemplate());
fs.writeFileSync("templates/memo.docx", defaultMemoTemplate());
fs.writeFileSync("templates/minutes.docx", defaultMinutesTemplate());
fs.writeFileSync("templates/MoH_Headed_letter_template.docx", defaultLetterTemplate());
console.log("Wrote templates/letter.docx, memo.docx, minutes.docx and the placeholder MoH_Headed_letter_template.docx");
