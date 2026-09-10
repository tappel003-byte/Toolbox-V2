export function canvasToPdfBlob(canvas: HTMLCanvasElement) {
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const image = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) image[i] = binary.charCodeAt(i);

  const pageW = 792;
  const pageH = 612;
  const margin = 24;
  const fit = Math.min((pageW - margin * 2) / canvas.width, (pageH - margin * 2) / canvas.height);
  const drawW = canvas.width * fit;
  const drawH = canvas.height * fit;
  const drawX = (pageW - drawW) / 2;
  const drawY = (pageH - drawH) / 2;
  const content = `q\n${drawW.toFixed(3)} 0 0 ${drawH.toFixed(3)} ${drawX.toFixed(3)} ${drawY.toFixed(3)} cm\n/TopoMap Do\nQ\n`;

  const encoder = new TextEncoder();
  const chunks: BlobPart[] = [];
  const offsets: number[] = [0];
  let offset = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    chunks.push(copy.buffer as ArrayBuffer);
    offset += bytes.length;
  };
  const obj = (id: number, body: Array<string | Uint8Array>) => {
    offsets[id] = offset;
    push(`${id} 0 obj\n`);
    for (const part of body) push(part);
    push(`\nendobj\n`);
  };

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"]);
  obj(3, [
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] `,
    `/Resources << /XObject << /TopoMap 4 0 R >> >> /Contents 5 0 R >>`,
  ]);
  obj(4, [
    `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} `,
    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`,
    image,
    "\nendstream",
  ]);
  const contentBytes = encoder.encode(content);
  obj(5, [`<< /Length ${contentBytes.length} >>\nstream\n`, contentBytes, "endstream"]);

  const xrefAt = offset;
  push(`xref\n0 6\n0000000000 65535 f \n`);
  for (let i = 1; i <= 5; i++) push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`);

  return new Blob(chunks, { type: "application/pdf" });
}
