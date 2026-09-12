// Report Builder — first real screens: Floor Survey's High/Low/Δ summary
// and a live Distress Survey pin schedule.
// Strictly read-only. Nothing here ever writes back to a drawer's data; it
// just renders whatever's currently imported. Fix it at the source, it
// shows up here automatically.
// Transition-correction math (normalizeSurfaceForGrouping, transitionDelta,
// correctedPointValue, computeFloorHighLowDelta) lives in
// js/floor-survey-math.js, shared with Diagnostics.

function renderFloorSurveySection(job) {
  const fs = job.floorSurvey;
  if (!fs || !fs.floors || !fs.floors.length) return '';

  const cards = fs.floors.map((floor) => {
    const stats = computeFloorHighLowDelta(floor, fs.points);
    if (!stats) {
      return `<div class="hl-card"><div class="floor-name">${escapeHtml(floor.name || 'Floor')}</div><div class="hint" style="margin:0;">No points on this floor.</div></div>`;
    }
    return `
      <div class="hl-card">
        <div class="floor-name">${escapeHtml(floor.name || 'Floor')}</div>
        <div class="hl-pill">
          <span class="hi">H ${stats.high.toFixed(2)}"</span>
          <span class="lo">L ${stats.low.toFixed(2)}"</span>
          <span>Δ ${stats.delta.toFixed(2)}"</span>
          <span class="hint" style="margin:0;">${stats.count} point${stats.count === 1 ? '' : 's'}</span>
        </div>
      </div>`;
  }).join('');

  const fsDateLabel = fs.updatedAt ? `updated ${formatUpdated(fs.updatedAt)}` : `imported ${formatUpdated(fs.importedAt)}`;
  return `
    <div style="font-weight:700;margin-bottom:8px;">Floor Survey — Elevation Summary</div>
    ${cards}
    <div class="hint" style="margin-top:2px;margin-bottom:18px;">${fsDateLabel}</div>
  `;
}

// Pins can come from the CSV import bridge (photoNumbers, a text range) or
// from native capture (real photos.length) — show whichever this pin has.
function pinPhotoLabel(p) {
  if (p.photoNumbers) return p.photoNumbers;
  const n = (p.photos || []).length;
  return n ? `${n} photo${n === 1 ? '' : 's'}` : '';
}

// A distressSurvey can hold imported pins, natively-captured pins, or both.
// updatedAt (set whenever native capture saves) means "this isn't just an
// old import" — prefer it so fresh field data is never mislabeled as stale.
function distressSurveyDateLabel(ds) {
  return ds.updatedAt ? `updated ${formatUpdated(ds.updatedAt)}` : `imported ${formatUpdated(ds.importedAt)}`;
}

function renderPinScheduleSection(job) {
  const ds = job.distressSurvey;
  if (!ds || !ds.pins || !ds.pins.length) return '';

  const pins = ds.pins.slice().sort((a, b) => a.pin - b.pin);
  const rows = pins.map((p) => {
    const isExterior = (p.type || '').toLowerCase() === 'exterior';
    return `
      <tr>
        <td><span class="pin-badge${isExterior ? ' exterior' : ''}">${escapeHtml(String(p.pin))}</span></td>
        <td>${escapeHtml(pinPhotoLabel(p))}</td>
        <td>${escapeHtml(p.room || '')}</td>
        <td>${escapeHtml(p.direction || '')}</td>
        <td>${escapeHtml(p.description || '')}</td>
      </tr>`;
  }).join('');

  return `
    <div style="font-weight:700;margin-bottom:8px;">Distress Survey — Pin Schedule</div>
    <table class="pin-schedule">
      <thead>
        <tr>
          <th>Pin</th>
          <th>Photo</th>
          <th>Room</th>
          <th>Direction</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="hint" style="margin-top:10px;">${pins.length} pin${pins.length === 1 ? '' : 's'} · ${distressSurveyDateLabel(ds)}</div>
  `;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// jsPDF's addImage() needs an explicit format matching the actual image
// data — pass the wrong one and it can render blank or throw. Camera
// photos are virtually always JPEG; fall back to it for anything jsPDF
// doesn't have a direct format name for rather than guessing wrong.
function jsPdfImageFormat(mimeType) {
  const type = (mimeType || '').toLowerCase();
  if (type.includes('png')) return 'PNG';
  if (type.includes('webp')) return 'WEBP';
  return 'JPEG';
}

async function buildReportPdf(job) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'in', format: [11, 17], orientation: 'landscape' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 0.5;
  const name = (job.people && job.people.primaryName) || 'Customer';

  function drawHeader(pageNum, totalPages) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.setTextColor(20);
    pdf.text(name, margin, margin + 0.1);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(100);
    pdf.text(job.address || '', margin, margin + 0.32);
    pdf.setFontSize(8);
    pdf.text(`Page ${pageNum} of ${totalPages}`, pageW - margin, pageH - 0.15, { align: 'right' });
  }

  let y = margin + 0.65;

  // Floor Survey H/L/Δ summary
  const fs = job.floorSurvey;
  if (fs && fs.floors && fs.floors.length) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.setTextColor(20);
    pdf.text('Floor Survey — Elevation Summary', margin, y);
    y += 0.25;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    fs.floors.forEach((floor) => {
      const stats = computeFloorHighLowDelta(floor, fs.points);
      if (!stats) return;
      pdf.text(
        `${floor.name || 'Floor'} — H ${stats.high.toFixed(2)}"  L ${stats.low.toFixed(2)}"  Δ ${stats.delta.toFixed(2)}"  (${stats.count} points)`,
        margin, y
      );
      y += 0.22;
    });
    y += 0.2;
  }

  // Distress Survey pin schedule
  const ds = job.distressSurvey;
  if (ds && ds.pins && ds.pins.length) {
    const pins = ds.pins.slice().sort((a, b) => a.pin - b.pin);

    const colPin = 0.5, colPhoto = 0.7, colRoom = 1.6, colDir = 0.6;
    const tableX = margin;
    const tableW = pageW - margin * 2;
    const colNotes = tableW - (colPin + colPhoto + colRoom + colDir);
    const colX = [tableX, tableX + colPin, tableX + colPin + colPhoto, tableX + colPin + colPhoto + colRoom, tableX + colPin + colPhoto + colRoom + colDir];
    const headerH = 0.28, rowH = 0.34;

    function drawTableHeader() {
      pdf.setFillColor(235, 230, 222);
      pdf.rect(tableX, y, tableW, headerH, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      pdf.setTextColor(30);
      const hy = y + headerH / 2 + 0.03;
      pdf.text('Pin', colX[0] + 0.06, hy);
      pdf.text('Photo', colX[1] + 0.06, hy);
      pdf.text('Room', colX[2] + 0.06, hy);
      pdf.text('Dir', colX[3] + 0.06, hy);
      pdf.text('Description', colX[4] + 0.06, hy);
      y += headerH;
    }

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.setTextColor(20);
    pdf.text('Distress Survey — Pin Schedule', margin, y);
    y += 0.25;
    drawTableHeader();

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pins.forEach((p) => {
      if (y + rowH > pageH - margin - 0.2) {
        pdf.addPage([11, 17], 'landscape');
        y = margin + 0.65;
        drawTableHeader();
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
      }
      pdf.setDrawColor(200);
      pdf.setLineWidth(0.006);
      pdf.line(tableX, y, tableX + tableW, y);
      const ty = y + rowH / 2 + 0.03;
      pdf.setTextColor(30);
      pdf.text(String(p.pin), colX[0] + 0.06, ty);
      pdf.text(pinPhotoLabel(p), colX[1] + 0.06, ty);
      pdf.text(p.room || '', colX[2] + 0.06, ty);
      pdf.text(p.direction || '', colX[3] + 0.06, ty);
      const noteLines = pdf.splitTextToSize(p.description || '', colNotes - 0.12).slice(0, 2);
      noteLines.forEach((line, i) => pdf.text(line, colX[4] + 0.06, y + 0.13 + i * 0.15));
      y += rowH;
    });
  }

  // Photo appendix — only pins with real attached Blobs have anything to
  // show here. Imported pins carry photoNumbers (a reference to a separate
  // physical photo folder from the old app), never the actual image, so
  // there's nothing to embed for them; that's correct, not a gap.
  const pinsWithPhotos = ds && ds.pins ? ds.pins.filter((p) => p.photos && p.photos.length).sort((a, b) => a.pin - b.pin) : [];
  if (pinsWithPhotos.length) {
    const thumb = 2.3;
    const gap = 0.25;
    const perRow = Math.max(1, Math.floor((pageW - margin * 2 + gap) / (thumb + gap)));
    pdf.addPage([11, 17], 'landscape');
    y = margin + 0.65;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.setTextColor(20);
    pdf.text('Distress Survey — Photos', margin, y);
    y += 0.3;
    let col = 0;
    for (const p of pinsWithPhotos) {
      for (const photo of p.photos) {
        if (y + thumb + 0.3 > pageH - margin) {
          pdf.addPage([11, 17], 'landscape');
          y = margin + 0.65;
          col = 0;
        }
        const x = margin + col * (thumb + gap);
        try {
          const dataUrl = await blobToDataUrl(photo);
          pdf.addImage(dataUrl, jsPdfImageFormat(photo.type), x, y, thumb, thumb, undefined, 'FAST');
        } catch (err) {
          // A malformed or unsupported image shouldn't sink the whole
          // export — draw an empty frame and keep going.
          pdf.setDrawColor(200);
          pdf.rect(x, y, thumb, thumb);
        }
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        pdf.setTextColor(20);
        pdf.text(`Pin #${p.pin}`, x, y + thumb + 0.15);
        col += 1;
        if (col >= perRow) { col = 0; y += thumb + 0.35; }
      }
    }
  }

  // Now that total page count is known, stamp headers on every page.
  const totalPages = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    drawHeader(i, totalPages);
  }

  return pdf;
}

async function loadReport() {
  const params = new URLSearchParams(location.search);
  const key = params.get('job');
  const body = document.getElementById('report-body');

  if (!key) {
    location.href = 'index.html';
    return;
  }
  document.getElementById('back-link').href = `customer.html?job=${encodeURIComponent(key)}`;

  let job;
  try {
    job = await getJob(key);
  } catch (err) {
    body.innerHTML = `<div class="empty-state">Could not open this customer file.<br>${escapeHtml(err.message || String(err))}</div>`;
    return;
  }

  if (!job) {
    location.href = 'index.html';
    return;
  }

  const name = (job.people && job.people.primaryName) || 'Customer';
  document.querySelector('header h1').textContent = `Report Builder — ${name}`;

  const floorSection = renderFloorSurveySection(job);
  const pinSection = renderPinScheduleSection(job);

  if (!floorSection && !pinSection) {
    body.innerHTML = `
      <div class="empty-state">
        No drawer data imported for this customer yet.<br>
        Go to their hub and import a Distress Survey pins.csv or a Floor Survey .floorsurvey.json to see it here.
      </div>`;
    return;
  }

  body.innerHTML = floorSection + pinSection;

  const exportBtn = document.getElementById('btn-export-pdf');
  exportBtn.disabled = false;
  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    try {
      const pdf = await buildReportPdf(job);
      const slug = (name || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      pdf.save(`${slug}-report.pdf`);
    } finally {
      exportBtn.disabled = false;
    }
  });
}

loadReport();
