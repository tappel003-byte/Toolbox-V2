// Room auto-fill: reads printed room labels off a plan photo and snaps them
// to a canonical room name, the same way Distress Survey's setup screen does
// (field-reporter-pro/public/survey.html, functions ocrScanRoomsForSetup /
// findMoreLabelsForSetup / matchRoomKeyword). Ported here — read-only source,
// Distress Survey itself is untouched — because the room list belongs to the
// cabinet, and re-deriving this matching/scan logic from scratch would just
// be a worse copy of a thing that already works.
//
// Everything below is pure/client-side: canvas preprocessing + Tesseract.js
// (same CDN + version Distress Survey uses) + regex matching. No network
// calls except the one-time Tesseract script/model fetch, and no dependency
// on Distress Survey's storage or service worker.

const RoomOCR = (() => {

  const BUILDING_TYPES = {
    residential: {
      label: 'Residential',
      common: ['W.I.C', 'Kitchen', 'Primary Bedroom', 'Primary Bathroom', 'Bedroom', 'Bathroom', 'Living Room', 'Dining Room', 'Family Room', 'Garage', 'Laundry', 'Hallway', 'Closet', 'Foyer', 'Office'],
      specialty: ['Great Room', 'Breakfast Nook', 'Pantry', 'Butler’s Pantry', 'Mud Room', 'Half Bath', 'Powder Room', 'Primary Closet', 'W.I.C', 'Den', 'Library', 'Study', 'Sunroom', 'Bonus Room', 'Game Room', 'Home Theater', 'Wine Cellar', 'Gym', 'Nursery', 'Guest Room', 'Basement', 'Attic', 'Crawl Space', 'Mechanical', 'Utility Room', 'Server Room', 'Workshop', 'Storage', 'Porch', 'Patio', 'Deck', 'Lanai', 'Pool House', 'Stairs'],
    },
    office: {
      label: 'Office',
      common: ['Reception', 'Waiting Area', 'Conference Room', 'Private Office', 'Open Office', 'Break Room', 'Restroom', 'Kitchen', 'Hallway', 'Storage'],
      specialty: ['Lobby', 'Boardroom', 'Huddle Room', 'Phone Booth', 'Copy Room', 'Mail Room', 'Server Room', 'IT Closet', 'Mechanical', 'Janitor', 'Lounge', 'Training Room', 'Library', 'Stairs'],
    },
    medical: {
      label: 'Medical Office',
      common: ['Reception', 'Waiting Room', 'Exam Room', 'Nurse Station', 'Doctor Office', 'Restroom', 'Lab', 'Hallway', 'Storage'],
      specialty: ['Triage', 'Procedure Room', 'X-Ray', 'Imaging', 'MRI', 'CT Scan', 'Ultrasound', 'Pharmacy', 'Sterilization', 'Recovery', 'Consult Room', 'Break Room', 'Mechanical', 'Janitor', 'Stairs'],
    },
    vet: {
      label: 'Vet Clinic',
      common: ['Reception', 'Waiting Area', 'Exam Room', 'Surgery', 'Kennel', 'Lab', 'Restroom', 'Storage', 'Hallway'],
      specialty: ['Triage', 'Grooming', 'Pharmacy', 'Recovery', 'Isolation', 'Radiology', 'X-Ray', 'Boarding', 'Food Storage', 'Break Room', 'Mechanical', 'Stairs'],
    },
    dental: {
      label: 'Dental',
      common: ['Reception', 'Waiting Room', 'Operatory', 'Sterilization', 'X-Ray', 'Restroom', 'Hallway', 'Storage'],
      specialty: ['Consult Room', 'Lab', 'Doctor Office', 'Break Room', 'Mechanical', 'Stairs'],
    },
    warehouse: {
      label: 'Warehouse',
      common: ['Receiving', 'Shipping', 'Loading Dock', 'Storage', 'Office', 'Restroom', 'Break Room'],
      specialty: ['Cold Storage', 'Freezer', 'Forklift Charging', 'Mechanical', 'Electrical Room', 'Server Room', 'Hallway', 'Stairs', 'Mezzanine'],
    },
  };

  const ROOM_KEYWORD_ALIASES = [
    { rx: /\b(primary|master|mstr)\s*bed\s*(room|rm)?\b|\bmbr\b|\bm\.?bed\b/i, name: 'Primary Bedroom' },
    { rx: /\b(primary|master|mstr)\s*bath\s*(room|rm)?\b|\bmba\b|\bm\.?bath\b/i, name: 'Primary Bathroom' },
    { rx: /\bpowder\b|\bpwdr\b|\bpdr\b/i, name: 'Powder Room' },
    { rx: /\bhalf\s*bath\b|\bhb\b/i, name: 'Half Bath' },
    { rx: /\bbed\s*(room|rm)?\s*\d*\b|\bbr\s*\d*\b|\bbdrm\s*\d*\b/i, name: 'Bedroom' },
    { rx: /\bbath\s*(room|rm)?\s*\d*\b|\bba\s*\d*\b|\bbthrm\s*\d*\b/i, name: 'Bathroom' },
    { rx: /\brest\s*room\b|\brestroom\b|\bwc\b|\btoilet\b/i, name: 'Restroom' },
    { rx: /\bkitchen\b|\bkit\b|\bkitch\b/i, name: 'Kitchen' },
    { rx: /\bdining(\s*room)?\b|\bdin\b|\bdr\b/i, name: 'Dining Room' },
    { rx: /\bliving(\s*room)?\b|\bliv\b|\blr\b/i, name: 'Living Room' },
    { rx: /\bfamily(\s*room)?\b|\bfam\b|\bfr\b/i, name: 'Family Room' },
    { rx: /\bgreat\s*room\b|\bgrt\s*rm\b|\bgr\b/i, name: 'Great Room' },
    { rx: /\bfoyer\b|\bentry\b/i, name: 'Foyer' },
    { rx: /\blobby\b/i, name: 'Lobby' },
    { rx: /\bhall(way)?\b|\bhal\b/i, name: 'Hallway' },
    { rx: /\blaundry\b|\bldry\b|\blau\b|\bw\/d\b/i, name: 'Laundry' },
    { rx: /\butility\s*room\b|\butility\b|\butil\b/i, name: 'Utility Room' },
    { rx: /\bmud\s*room\b|\bmud\s*rm\b|\bmud\b/i, name: 'Mud Room' },
    { rx: /\boffice\b|\boff\b/i, name: 'Office' },
    { rx: /\bstudy\b/i, name: 'Study' },
    { rx: /\bden\b/i, name: 'Den' },
    { rx: /\blibrary\b|\blib\b/i, name: 'Library' },
    { rx: /\bgarage\b|\bgar\b/i, name: 'Garage' },
    { rx: /\bpantry\b|\bpan\b|\bpntry\b/i, name: 'Pantry' },
    { rx: /\bbutler/i, name: 'Butler’s Pantry' },
    { rx: /\bw\.?\s*i\.?\s*c\.?\b|\bwalk[\s-]*in\s*clos(et)?\b/i, name: 'W.I.C' },
    { rx: /\bcloset\b|\bclos\b|\bclo\b|\bcl\b/i, name: 'Closet' },
    { rx: /\bnook\b|\bbreakfast\b|\bbkfst\b/i, name: 'Breakfast Nook' },
    { rx: /\bbonus\b/i, name: 'Bonus Room' },
    { rx: /\bgame\s*room\b/i, name: 'Game Room' },
    { rx: /\b(home\s*)?theater\b|\bmedia\s*room\b/i, name: 'Home Theater' },
    { rx: /\bgym\b|\bfitness\b/i, name: 'Gym' },
    { rx: /\bnursery\b/i, name: 'Nursery' },
    { rx: /\bguest\b/i, name: 'Guest Room' },
    { rx: /\bbasement\b/i, name: 'Basement' },
    { rx: /\battic\b/i, name: 'Attic' },
    { rx: /\bsunroom\b|\bsun\s*room\b/i, name: 'Sunroom' },
    { rx: /\bporch\b/i, name: 'Porch' },
    { rx: /\bpatio\b/i, name: 'Patio' },
    { rx: /\bdeck\b/i, name: 'Deck' },
    { rx: /\blanai\b/i, name: 'Lanai' },
    { rx: /\bstair(s|case)?\b/i, name: 'Stairs' },
    { rx: /\bstorage\b|\bstor\b/i, name: 'Storage' },
    { rx: /\bmech(anical)?\b|\bequip(ment)?\b/i, name: 'Mechanical' },
    { rx: /\bserver\b/i, name: 'Server Room' },
    { rx: /\belectrical\s*room\b|\belec\s*room\b/i, name: 'Electrical Room' },
    { rx: /\bworkshop\b/i, name: 'Workshop' },
    { rx: /\breception\b/i, name: 'Reception' },
    { rx: /\bwaiting\s*(room|area)?\b/i, name: 'Waiting Room' },
    { rx: /\bconference\b/i, name: 'Conference Room' },
    { rx: /\bboard\s*room\b/i, name: 'Boardroom' },
    { rx: /\bbreak\s*room\b|\bbreakroom\b/i, name: 'Break Room' },
    { rx: /\bhuddle\b/i, name: 'Huddle Room' },
    { rx: /\bcopy\s*room\b/i, name: 'Copy Room' },
    { rx: /\bmail\s*room\b/i, name: 'Mail Room' },
    { rx: /\btraining\b/i, name: 'Training Room' },
    { rx: /\bjanitor\b/i, name: 'Janitor' },
    { rx: /\blounge\b/i, name: 'Lounge' },
    { rx: /\bexam\s*(room)?\s*\d*\b/i, name: 'Exam Room' },
    { rx: /\bnurse\b/i, name: 'Nurse Station' },
    { rx: /\bdoctor\b|\bdr\.?\s*office\b/i, name: 'Doctor Office' },
    { rx: /\bconsult\b/i, name: 'Consult Room' },
    { rx: /\btriage\b/i, name: 'Triage' },
    { rx: /\bprocedure\b/i, name: 'Procedure Room' },
    { rx: /\b(x[-\s]*ray|xray)\b/i, name: 'X-Ray' },
    { rx: /\bimaging\b/i, name: 'Imaging' },
    { rx: /\bmri\b/i, name: 'MRI' },
    { rx: /\bct\s*scan\b|\bcat\s*scan\b/i, name: 'CT Scan' },
    { rx: /\bultrasound\b|\bsono\b/i, name: 'Ultrasound' },
    { rx: /\bpharmacy\b/i, name: 'Pharmacy' },
    { rx: /\bster(ilization|ile)\b/i, name: 'Sterilization' },
    { rx: /\brecovery\b/i, name: 'Recovery' },
    { rx: /\blab\b|\blaboratory\b/i, name: 'Lab' },
    { rx: /\boperatory\b|\bop\s*\d+\b/i, name: 'Operatory' },
    { rx: /\bsurgery\b|\bsurgical\b/i, name: 'Surgery' },
    { rx: /\bkennel\b/i, name: 'Kennel' },
    { rx: /\bgrooming\b/i, name: 'Grooming' },
    { rx: /\bisolation\b/i, name: 'Isolation' },
    { rx: /\bradiology\b/i, name: 'Radiology' },
    { rx: /\bboarding\b/i, name: 'Boarding' },
    { rx: /\breceiving\b/i, name: 'Receiving' },
    { rx: /\bshipping\b/i, name: 'Shipping' },
    { rx: /\bloading\s*dock\b|\bdock\b/i, name: 'Loading Dock' },
    { rx: /\bcold\s*storage\b/i, name: 'Cold Storage' },
    { rx: /\bfreezer\b/i, name: 'Freezer' },
    { rx: /\bforklift\b/i, name: 'Forklift Charging' },
    { rx: /\bmezzanine\b/i, name: 'Mezzanine' },
  ];

  function getCommonRooms(type) {
    return (BUILDING_TYPES[type] || BUILDING_TYPES.residential).common.slice();
  }
  function getSpecialtyRooms(type) {
    return (BUILDING_TYPES[type] || BUILDING_TYPES.residential).specialty.slice();
  }
  function getAllPresetRooms(type) {
    return [...getCommonRooms(type), ...getSpecialtyRooms(type)];
  }
  function activeRoomKeywords(type) {
    const pool = new Set(getAllPresetRooms(type).map((s) => s.toLowerCase()));
    return ROOM_KEYWORD_ALIASES.filter((k) => pool.has(k.name.toLowerCase()));
  }

  // Strip CAD dimension strings ("12'-4\" x 11'-0\"", "10' X 12'", "144 SF")
  // before matching — room labels on CAD plans usually sit over a dimension
  // line and OCR often reads them as one token.
  function stripDimensions(text) {
    let t = String(text || '');
    t = t.replace(/\d+\s*['’]\s*[-\s]?\s*\d*\s*["”]?\s*[xX×]\s*\d+\s*['’]\s*[-\s]?\s*\d*\s*["”]?/g, ' ');
    t = t.replace(/\d+\s*['’][-\s]?\d*\s*["”]?/g, ' ');
    t = t.replace(/\b\d{1,3}\s*[xX×]\s*\d{1,3}\b/g, ' ');
    t = t.replace(/\b\d+\s*(sf|sq\s*ft|sqft|s\.f\.)\b/gi, ' ');
    t = t.replace(/["“”’']/g, ' ').replace(/\s+/g, ' ').trim();
    return t;
  }

  // Snap OCR text to a preset name: prefer the active building type's
  // aliases, then fall back to all aliases so close matches still snap.
  function matchRoomKeyword(text, type) {
    const raw = String(text || '').trim();
    if (!raw || raw.length < 2) return null;
    const cleaned = stripDimensions(raw);
    const candidates = cleaned && cleaned !== raw ? [raw, cleaned] : [raw];
    const active = activeRoomKeywords(type);
    for (const t of candidates) {
      for (const k of active) { if (k.rx.test(t)) return k.name; }
    }
    for (const t of candidates) {
      for (const k of ROOM_KEYWORD_ALIASES) { if (k.rx.test(t)) return k.name; }
    }
    return null;
  }

  function cleanRawRoomText(text) {
    let t = stripDimensions(String(text || '')).replace(/\s+/g, ' ').trim();
    if (!t) return null;
    t = t.replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z0-9.)]+$/, '').trim();
    if (t.length < 3 || t.length > 28) return null;
    const letters = (t.match(/[A-Za-z]/g) || []).length;
    if (letters < 3) return null;
    if (letters / t.length < 0.5) return null;
    if (/^\d/.test(t)) return null;
    if (/\b(ft|in|sq|sf|min|max)\b/i.test(t)) return null;
    const small = new Set(['of', 'and', 'the', 'a']);
    const words = t.toLowerCase().split(' ').map((w, i) => {
      if (i > 0 && small.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    });
    return words.join(' ');
  }

  // Numeric room labels ("143", "101A") used on commercial plans. Skipped
  // for residential — house plans don't number rooms this way.
  function cleanRoomNumber(text, type) {
    if (type === 'residential') return null;
    let t = String(text || '').replace(/\s+/g, '').replace(/^[^\w]+|[^\w]+$/g, '').trim();
    if (!t) return null;
    if (/['"\-x×.,/]/.test(t)) return null;
    const m = t.match(/^(\d{2,4})([A-Za-z])?$/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    if (n < 10 || n > 9999) return null;
    return 'Room ' + m[1] + (m[2] ? m[2].toUpperCase() : '');
  }

  function looksNumeric(text) {
    const t = String(text || '').replace(/\s+/g, '').replace(/^[^\w]+|[^\w]+$/g, '');
    return /^\d{2,4}[A-Za-z]?$/.test(t);
  }

  // Upscale + grayscale + threshold. Returns a canvas.
  function preprocessForOcr(img, targetW, maxScale, threshold) {
    const W0 = img.naturalWidth || img.width;
    const H0 = img.naturalHeight || img.height;
    const cap = typeof maxScale === 'number' ? maxScale : 3.5;
    const bwThreshold = typeof threshold === 'number' ? threshold : 160;
    const scale = Math.max(1, Math.min(cap, targetW / W0));
    const W = Math.round(W0 * scale);
    const H = Math.round(H0 * scale);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    try {
      const id = ctx.getImageData(0, 0, W, H);
      const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
        const v = g < bwThreshold ? 0 : 255;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      ctx.putImageData(id, 0, 0);
    } catch (_) {}
    return c;
  }

  // CAD floor-plan apps often render room names as white text inside
  // red/orange pills. A plain black/white threshold turns those into
  // reversed white-on-black labels that Tesseract misses. This isolates
  // the colored pills and converts their white letters to black-on-white.
  function preprocessColorLabelTextForOcr(img, targetW, maxScale) {
    const W0 = img.naturalWidth || img.width;
    const H0 = img.naturalHeight || img.height;
    const cap = typeof maxScale === 'number' ? maxScale : 3.5;
    const scale = Math.max(1, Math.min(cap, targetW / W0));
    const W = Math.round(W0 * scale);
    const H = Math.round(H0 * scale);
    const src = document.createElement('canvas');
    src.width = W; src.height = H;
    const sctx = src.getContext('2d');
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.fillStyle = '#fff';
    sctx.fillRect(0, 0, W, H);
    sctx.drawImage(img, 0, 0, W, H);

    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const octx = out.getContext('2d');
    octx.fillStyle = '#fff';
    octx.fillRect(0, 0, W, H);

    try {
      const srcId = sctx.getImageData(0, 0, W, H);
      const sd = srcId.data;
      const red = new Uint8Array(W * H);
      const nearRed = new Uint8Array(W * H);

      for (let p = 0, i = 0; p < sd.length; p += 4, i++) {
        const r = sd[p], g = sd[p + 1], b = sd[p + 2];
        if (r > 120 && g > 30 && g < 155 && b < 135 && r > g * 1.18 && r > b * 1.35) {
          red[i] = 1;
        }
      }

      const radius = 4;
      for (let y = 0; y < H; y++) {
        const row = y * W;
        for (let x = 0; x < W; x++) {
          const idx = row + x;
          if (!red[idx]) continue;
          for (let dy = -radius; dy <= radius; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= H) continue;
            const rr = yy * W;
            for (let dx = -radius; dx <= radius; dx++) {
              const xx = x + dx;
              if (xx < 0 || xx >= W) continue;
              nearRed[rr + xx] = 1;
            }
          }
        }
      }

      const outId = octx.getImageData(0, 0, W, H);
      const od = outId.data;
      for (let p = 0, i = 0; p < sd.length; p += 4, i++) {
        if (!nearRed[i] || red[i]) continue;
        const r = sd[p], g = sd[p + 1], b = sd[p + 2];
        const bright = (r * 0.299 + g * 0.587 + b * 0.114);
        if (bright > 145) {
          od[p] = od[p + 1] = od[p + 2] = 0;
          od[p + 3] = 255;
        }
      }
      octx.putImageData(outId, 0, 0);
    } catch (_) {}
    return out;
  }

  function rotateCanvas90(src) {
    const c = document.createElement('canvas');
    c.width = src.height; c.height = src.width;
    const ctx = c.getContext('2d');
    ctx.translate(c.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(src, 0, 0);
    return c;
  }

  function rotateCanvasNeg90(src) {
    const c = document.createElement('canvas');
    c.width = src.height; c.height = src.width;
    const ctx = c.getContext('2d');
    ctx.translate(0, c.height);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(src, 0, 0);
    return c;
  }

  let tesseractWorkerPromise = null;
  function loadTesseractWorker() {
    if (tesseractWorkerPromise) return tesseractWorkerPromise;
    tesseractWorkerPromise = (async () => {
      if (!window.Tesseract) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
          s.onload = resolve;
          s.onerror = () => reject(new Error('Could not load the text reader (no connection?).'));
          document.head.appendChild(s);
        });
      }
      return window.Tesseract.createWorker('eng');
    })();
    return tesseractWorkerPromise;
  }

  async function runOcrPass(worker, canvas, psm) {
    try { await worker.setParameters({ tessedit_pageseg_mode: String(psm) }); } catch (_) {}
    const { data } = await worker.recognize(canvas);
    return data || {};
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read the plan image.'));
      img.src = src;
    });
  }

  // First pass: 7 OCR sweeps (color-pill labels, sparse text, blocky text,
  // each rotated both ways) — mirrors Distress Survey's "Read labels".
  async function scan(planImageSrc, buildingType, onProgress) {
    const worker = await loadTesseractWorker();
    const img = await loadImage(planImageSrc);

    if (onProgress) onProgress('Enhancing image…');
    const upright = preprocessForOcr(img, 2400);
    const colorLabels = preprocessColorLabelTextForOcr(img, 2400);
    const rotated = rotateCanvas90(upright);
    const rotatedNeg = rotateCanvasNeg90(upright);
    const colorLabelsRotated = rotateCanvas90(colorLabels);
    const colorLabelsRotatedNeg = rotateCanvasNeg90(colorLabels);
    const W = upright.width, H = upright.height;

    const passes = [
      { canvas: colorLabels, psm: 11, rot: 0, label: 'color room labels' },
      { canvas: colorLabelsRotated, psm: 11, rot: 90, label: 'color labels CW' },
      { canvas: colorLabelsRotatedNeg, psm: 11, rot: -90, label: 'color labels CCW' },
      { canvas: upright, psm: 11, rot: 0, label: 'upright sparse' },
      { canvas: upright, psm: 6, rot: 0, label: 'upright blocks' },
      { canvas: rotated, psm: 11, rot: 90, label: 'sideways CW' },
      { canvas: rotatedNeg, psm: 11, rot: -90, label: 'sideways CCW' },
    ];

    const candidates = [];
    let passNum = 0;
    for (const p of passes) {
      passNum++;
      if (onProgress) onProgress(`Scanning ${passNum}/${passes.length} (${p.label})…`);
      const data = await runOcrPass(worker, p.canvas, p.psm);
      const lines = Array.isArray(data.lines) ? data.lines : [];
      const words = Array.isArray(data.words) ? data.words : [];

      const harvest = (item, minConf) => {
        const text = (item.text || '').replace(/\s+/g, ' ').trim();
        if (!text) return;
        const conf = typeof item.confidence === 'number' ? item.confidence : 100;
        let matched = matchRoomKeyword(text, buildingType);
        let kind = 'preset';
        if (!matched) {
          matched = cleanRoomNumber(text, buildingType);
          if (matched) {
            kind = 'numeric';
          } else {
            matched = cleanRawRoomText(text);
            if (!matched) return;
            kind = 'raw';
          }
        }
        const floor = kind === 'numeric' ? 45 : (kind === 'preset' ? Math.max(58, minConf - 12) : minConf);
        if (conf < floor) return;
        const bb = item.bbox || {};
        let cx = (bb.x0 + bb.x1) / 2;
        let cy = (bb.y0 + bb.y1) / 2;
        if (p.rot === 90) {
          const rw = p.canvas.width;
          const nx = cy, ny = rw - cx;
          cx = nx; cy = ny;
        } else if (p.rot === -90) {
          const rh = p.canvas.height;
          const nx = rh - cy, ny = cx;
          cx = nx; cy = ny;
        }
        const nxr = cx / W, nyr = cy / H;
        if (!isFinite(nxr) || !isFinite(nyr) || nxr < 0 || nxr > 1 || nyr < 0 || nyr > 1) return;
        candidates.push({ name: matched, x: nxr, y: nyr, conf, src: p.label, kind });
      };

      for (const ln of lines) harvest(ln, 70);
      for (const w of words) {
        const t = (w.text || '').trim();
        if (t.length < 2) continue;
        harvest(w, 78);
      }
    }

    const kindRank = (k) => (k === 'preset' ? 0 : (k === 'numeric' ? 1 : 2));
    candidates.sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || (b.conf - a.conf));
    const clusters = [];
    for (const c of candidates) {
      const hit = clusters.find((k) => Math.hypot(k.x - c.x, k.y - c.y) < 0.05);
      if (hit) {
        hit.passes.add(c.src);
        if (kindRank(c.kind) < kindRank(hit.kind)) {
          hit.name = c.name; hit.kind = c.kind; hit.x = c.x; hit.y = c.y; hit.conf = c.conf;
        }
      } else {
        clusters.push({ name: c.name, x: c.x, y: c.y, conf: c.conf, kind: c.kind, passes: new Set([c.src]) });
      }
    }

    const kept = clusters.filter((k) => {
      const votes = k.passes.size;
      if (k.kind === 'raw') return votes >= 2;
      if (k.kind === 'numeric') return votes >= 1;
      return votes >= 2 || k.conf >= 68;
    });

    const totals = {};
    for (const c of kept) totals[c.name] = (totals[c.name] || 0) + 1;
    const seen = {};
    const rooms = kept.map((c) => {
      seen[c.name] = (seen[c.name] || 0) + 1;
      const name = totals[c.name] > 1 ? `${c.name} ${seen[c.name]}` : c.name;
      return { name, x: c.x, y: c.y };
    });

    return { rooms, droppedCount: clusters.length - kept.length };
  }

  // Deep additive pass: higher upscale + 5x5 tiling + a digit-only whitelist
  // pass on non-residential types, for small commercial room numbers. Only
  // adds rooms — never renames or removes what's already there, matching
  // Distress Survey's "Find more".
  async function findMore(planImageSrc, buildingType, existingRooms, onProgress) {
    const worker = await loadTesseractWorker();
    const img = await loadImage(planImageSrc);

    if (onProgress) onProgress('Preparing deep scan…');
    const big = preprocessForOcr(img, 6000, 6, 200);
    const W = big.width, H = big.height;

    const tiles = [{ canvas: big, ox: 0, oy: 0, label: 'full-6k' }];
    const GRID = 5, OVL = 0.06;
    const tw = Math.floor(W / GRID);
    const th = Math.floor(H / GRID);
    const ovx = Math.floor(tw * OVL), ovy = Math.floor(th * OVL);
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const x0 = Math.max(0, gx * tw - ovx);
        const y0 = Math.max(0, gy * th - ovy);
        const x1 = Math.min(W, (gx + 1) * tw + ovx);
        const y1 = Math.min(H, (gy + 1) * th + ovy);
        const cw = x1 - x0, ch = y1 - y0;
        const c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        c.getContext('2d').drawImage(big, x0, y0, cw, ch, 0, 0, cw, ch);
        tiles.push({ canvas: c, ox: x0, oy: y0, label: `tile ${gy * GRID + gx + 1}` });
      }
    }

    const isResidential = buildingType === 'residential';
    const candidates = [];

    function collectFromTile(data, tile, digitsOnly) {
      const words = Array.isArray(data && data.words) ? data.words : [];
      const lines = Array.isArray(data && data.lines) ? data.lines : [];
      for (const it of words.concat(lines)) {
        const text = (it.text || '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const conf = typeof it.confidence === 'number' ? it.confidence : 100;
        const numericCandidate = looksNumeric(text);
        const presetCandidate = matchRoomKeyword(text, buildingType);
        const floor = digitsOnly ? 38 : (numericCandidate ? 42 : (presetCandidate ? 56 : 64));
        if (conf < floor) continue;
        let matched = presetCandidate;
        let kind = 'preset';
        if (!matched) {
          matched = cleanRoomNumber(text, buildingType);
          if (matched) kind = 'numeric';
          else if (!digitsOnly) {
            matched = cleanRawRoomText(text);
            if (!matched) continue;
            kind = 'raw';
          } else continue;
        }
        const bb = it.bbox || {};
        const cx = (bb.x0 + bb.x1) / 2 + tile.ox;
        const cy = (bb.y0 + bb.y1) / 2 + tile.oy;
        const nx = cx / W, ny = cy / H;
        if (!isFinite(nx) || !isFinite(ny) || nx < 0 || nx > 1 || ny < 0 || ny > 1) continue;
        candidates.push({ name: matched, x: nx, y: ny, conf, src: tile.label + (digitsOnly ? ' D' : ' T'), kind });
      }
    }

    let stepNum = 0;
    const totalSteps = tiles.length * (isResidential ? 1 : 2);
    for (const t of tiles) {
      stepNum++;
      if (onProgress) onProgress(`Deep scan ${stepNum}/${totalSteps} (${t.label})…`);
      try { await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' }); } catch (_) {}
      const dataA = await worker.recognize(t.canvas);
      collectFromTile(dataA, t, false);

      if (!isResidential) {
        stepNum++;
        if (onProgress) onProgress(`Deep scan ${stepNum}/${totalSteps} (${t.label} digits)…`);
        try { await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '0123456789ABCD' }); } catch (_) {}
        const dataB = await worker.recognize(t.canvas);
        collectFromTile(dataB, t, true);
      }
    }
    try { await worker.setParameters({ tessedit_char_whitelist: '' }); } catch (_) {}

    const kindRank = (k) => (k === 'preset' ? 0 : (k === 'numeric' ? 1 : 2));
    candidates.sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || (b.conf - a.conf));
    const clusters = [];
    for (const c of candidates) {
      const hit = clusters.find((k) => Math.hypot(k.x - c.x, k.y - c.y) < 0.04);
      if (hit) {
        hit.passes.add(c.src);
        if (kindRank(c.kind) < kindRank(hit.kind)) {
          hit.name = c.name; hit.kind = c.kind; hit.x = c.x; hit.y = c.y; hit.conf = c.conf;
        }
      } else {
        clusters.push({ name: c.name, x: c.x, y: c.y, conf: c.conf, kind: c.kind, passes: new Set([c.src]) });
      }
    }

    const fresh = clusters.filter((k) => {
      if (k.kind === 'raw') return false;
      if (k.kind === 'numeric') return k.conf >= 40;
      return k.passes.size >= 2 || k.conf >= 68;
    });

    const merged = existingRooms.slice();
    const added = [];
    for (const f of fresh) {
      const nearby = merged.find((r) => Math.hypot((r.x || 0) - f.x, (r.y || 0) - f.y) < 0.05);
      if (f.kind === 'numeric') {
        const dup = merged.find((r) => r.name === f.name && Math.hypot((r.x || 0) - f.x, (r.y || 0) - f.y) < 0.015);
        if (dup) continue;
        merged.push({ name: f.name, x: f.x, y: f.y });
        added.push(f);
      } else {
        if (nearby) continue;
        merged.push({ name: f.name, x: f.x, y: f.y });
        added.push(f);
      }
    }

    const totals = {};
    for (const r of merged) {
      const base = r.name.replace(/\s\d+$/, '');
      totals[base] = (totals[base] || 0) + 1;
    }
    const seen = {};
    const rooms = merged.map((r) => {
      const base = r.name.replace(/\s\d+$/, '');
      if (totals[base] > 1) {
        seen[base] = (seen[base] || 0) + 1;
        return { name: `${base} ${seen[base]}`, x: r.x, y: r.y };
      }
      return { name: base, x: r.x, y: r.y };
    });

    return { rooms, addedCount: added.length };
  }

  return { BUILDING_TYPES, getCommonRooms, getSpecialtyRooms, scan, findMore };
})();
