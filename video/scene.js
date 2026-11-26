/* tally launch film: every pixel is a pure function of t (seconds).  window.seek(t) renders it.  */
(function () {
  const T = window.TIMELINE;
  const stage = document.getElementById('stage');

  /* ---------- helpers ---------- */
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, f) => a + (b - a) * f;
  const P = (t, a, b) => clamp((t - a) / (b - a));
  const E = {
    lin: (x) => x,
    out2: (x) => 1 - (1 - x) ** 2,
    out3: (x) => 1 - (1 - x) ** 3,
    out4: (x) => 1 - (1 - x) ** 4,
    in2: (x) => x * x,
    in3: (x) => x * x * x,
    io3: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - ((-2 * x + 2) ** 3) / 2),
    back: (x) => { const c1 = 1.2, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; },
    thump: (x) => (x < 0.55 ? E.in2(x / 0.55) * 0 + 1 - E.out3(x / 0.55) : 0) // 1 -> 0
  };
  const inr = (p, sign) => {
    const a = Math.abs(p), r = Math.floor(a / 100), q = String(a % 100).padStart(2, '0');
    const s = p < 0 ? '−' : sign && p > 0 ? '+' : '';
    return `${s}₹${new Intl.NumberFormat('en-IN').format(r)}.${q}`;
  };
  function el(cls, html, parent, tag = 'div') {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    (parent || stage).appendChild(e);
    return e;
  }
  const tf = (e, x = 0, y = 0, r = 0, s = 1) => { e.style.transform = `translate(${x}px,${y}px) rotate(${r}deg) scale(${s})`; };
  const show = (e, on) => { const d = on ? 'block' : 'none'; if (e.style.display !== d) e.style.display = d; };
  const svgNS = 'http://www.w3.org/2000/svg';
  function svg(w, h, parent, cls) {
    const s = document.createElementNS(svgNS, 'svg');
    s.setAttribute('width', w); s.setAttribute('height', h); s.setAttribute('viewBox', `0 0 ${w} ${h}`);
    if (cls) s.setAttribute('class', cls);
    s.style.position = 'absolute'; s.style.left = '0'; s.style.top = '0'; s.style.overflow = 'visible';
    (parent || stage).appendChild(s);
    return s;
  }
  function sv(tag, attrs, parent) {
    const n = document.createElementNS(svgNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  const S = T.scenes;
  const scenes = [];
  function makeScene(i) {
    const root = el('scene');
    root.dataset.i = i;
    scenes.push({ root, i, start: S[i], end: S[i + 1], upd: null });
    return root;
  }

  /* ---------- chrome (folio + page counter) ---------- */
  const chrome = el('', '');
  chrome.style.cssText = 'position:absolute;inset:0;z-index:6';
  el('folio', '<b>tally</b><span>hisaab</span><span class="deva" style="letter-spacing:.05em;font-size:26px;text-transform:none">हिसाब</span>', chrome);
  const pages = el('pages', '', chrome);
  el('hairline', '', chrome);

  /* ---------- captions ---------- */
  const caps = [];
  function addCap(t0, t1, text, big) {
    const c = el('cap' + (big ? ' big' : ''), '', chrome);
    const words = [];
    text.split(/(\s+)/).forEach((tok) => {
      if (!tok) return;
      if (tok === '|') { c.appendChild(document.createElement('br')); c.dataset.skip = '1'; return; }
      if (c.dataset.skip && !tok.trim()) { c.dataset.skip = ''; return; }
      const w = el('w', tok.replace(/\*\*(.+?)\*\*/g, '$1'), c, 'span');
      if (/^\*\*/.test(tok) || tok.startsWith('~')) { /* noop */ }
      if (tok.trim()) words.push(w);
    });
    // emphasis marker: words wrapped in { } become vermilion
    words.forEach((w) => { if (/^\{.*\}[.,]?$/.test(w.textContent)) { w.innerHTML = w.textContent.replace(/[{}]/g, ''); w.style.color = 'var(--verm-text)'; } });
    c.style.position = 'absolute';
    c.style.left = '96px'; c.style.bottom = '64px';
    caps.push({ c, words, t0, t1 });
  }
  function updCaps(t) {
    for (const k of caps) {
      const on = t >= k.t0 - 0.01 && t <= k.t1 + 0.4;
      show(k.c, on);
      if (!on) continue;
      k.words.forEach((w, i) => {
        const a = E.out3(P(t, k.t0 + i * 0.07, k.t0 + i * 0.07 + 0.4));
        const o = 1 - E.in2(P(t, k.t1 - 0.05, k.t1 + 0.35));
        w.style.opacity = (a * o).toFixed(3);
        w.style.transform = `translateY(${((1 - a) * 22 - (1 - o) * 10).toFixed(2)}px)`;
      });
    }
  }
  // remove the stray .caps containers created above
  /* captions text: {braces} = vermilion */
  addCap(2.2, 4.0, 'GOA. 4 people. 1 ledger.', true);
  addCap(5.0, 9.9, 'Split it four ways. {Literally.}');
  addCap(10.4, 15.9, 'Exact paise. The odd paisa lands on a named member, the payer. | No rounding fights.');
  addCap(17.0, 23.9, 'Untangled into the fewest sensible transfers. | Every one explains itself.');
  addCap(24.6, 29.9, 'Settle over UPI. tally never touches your money.');
  addCap(30.2, 35.8, 'Plus the small things that make a ledger last.');

  /* =========================================================
     SCENE 1: railway ticket + punch + tally
  ========================================================= */
  (function () {
    const root = makeScene(0);
    const tk = el('ticket', '', root);
    el('', '<div class="band"><span>TRIP LEDGER SLIP</span><span>SL 01</span></div>', tk);
    const main = el('main', '', tk);
    main.innerHTML = `
      <div class="lab">To</div><div class="big-to">GOA</div>
      <div class="from"><div class="lab">From</div><div class="v">HOME</div>
        <svg width="120" height="30" viewBox="0 0 120 30" style="margin-top:14px"><path d="M2 15H108M92 3l16 12-16 12" fill="none" stroke="#191817" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <div class="fields">
        <div><div class="lab">Members</div><div class="v">Sam · Asha · Ravi · Meera</div></div>
        <div><div class="lab">Ledgers</div><div class="v">1</div></div></div>`;
    const stub = el('stub', `<div class="lab">Admit</div><div class="stubnote">Four members<br>One ledger</div>`, tk);
    // tally strokes on stub
    const ts = svg(240, 150, stub);
    ts.style.left = '10px'; ts.style.top = '122px';
    const strokes = [];
    for (let i = 0; i < 4; i++) {
      const x = 28 + i * 44;
      strokes.push(sv('path', { d: `M${x} 10V110`, stroke: '#191817', 'stroke-width': 10, 'stroke-linecap': 'round', fill: 'none', 'stroke-dasharray': 100, 'stroke-dashoffset': 100 }, ts));
    }
    const diag = sv('path', { d: 'M6 98L196 22', stroke: '#D9412A', 'stroke-width': 10, 'stroke-linecap': 'round', fill: 'none', 'stroke-dasharray': 205, 'stroke-dashoffset': 205 }, ts);
    // notches at the perforation
    const n1 = el('notch', '', tk); n1.style.left = '760px'; n1.style.top = '48px';
    const n2 = el('notch', '', tk); n2.style.left = '760px'; n2.style.top = '388px';
    // barcode
    const bc = svg(240, 56, stub); bc.style.left = '10px'; bc.style.top = '300px';
    seed = 11; let bx = 0;
    while (bx < 232) { const w = 2 + Math.floor(rnd() * 6); sv('rect', { x: bx, y: 0, width: w, height: 56, fill: '#191817' }, bc); bx += w + 2 + Math.floor(rnd() * 5); }
    // punch hole + ring + chads
    const hole = el('hole', '', tk); hole.style.left = '480px'; hole.style.top = '190px';
    const ring = el('', '', tk);
    ring.style.cssText = 'position:absolute;left:480px;top:190px;width:52px;height:52px;border-radius:50%;border:4px solid #D9412A';
    const chads = [];
    seed = 5;
    for (let i = 0; i < 7; i++) {
      const c = el('', '', tk);
      c.style.cssText = 'position:absolute;left:500px;top:210px;width:14px;height:14px;border-radius:50%;background:#FBF8F0;border:2px solid #191817';
      chads.push({ c, vx: (rnd() - 0.3) * 520, vy: -260 - rnd() * 260 });
    }
    // punch tool
    const tool = svg(120, 400, tk);
    tool.style.left = '460px'; tool.style.top = '-470px';
    sv('rect', { x: 34, y: 0, width: 52, height: 300, rx: 10, fill: '#191817' }, tool);
    sv('rect', { x: 18, y: 190, width: 84, height: 40, rx: 6, fill: '#D9412A' }, tool);
    sv('rect', { x: 40, y: 300, width: 40, height: 56, rx: 4, fill: '#4E4A42' }, tool);
    sv('circle', { cx: 60, cy: 360, r: 22, fill: 'none', stroke: '#191817', 'stroke-width': 8 }, tool);

    scenes[0].upd = (t) => {
      const slide = E.out4(P(t, T.ticketIn, 1.35));
      const exit = E.in3(P(t, 3.55, 4.15));
      let x = lerp(-1500, 0, slide) , y = -exit * 900;
      let r = lerp(-8, -2, slide) + exit * 6;
      const k = t - T.punch;
      if (k > 0 && k < 0.5) { y += Math.sin(k * 60) * 7 * Math.exp(-k * 12); }
      tf(tk, x, y, r);
      // punch tool
      const down = E.in3(P(t, T.punch - 0.38, T.punch));
      const up = E.out3(P(t, T.punch + 0.1, T.punch + 0.6));
      tf(tool, 0, lerp(0, 470, down) - 470 * 0 - up * 470 + 0, 0, 1);
      tool.style.opacity = t > T.punch - 0.4 && t < T.punch + 0.65 ? 1 : 0;
      hole.style.opacity = t >= T.punch ? 1 : 0;
      tf(hole, 0, 0, 0, E.back(P(t, T.punch, T.punch + 0.18)));
      const rp = P(t, T.punch, T.punch + 0.5);
      ring.style.opacity = rp > 0 && rp < 1 ? (1 - rp) : 0;
      tf(ring, 0, 0, 0, lerp(0.6, 3.0, E.out3(rp)));
      chads.forEach((ch, i) => {
        const q = t - T.punch;
        if (q < 0 || q > 0.9) { ch.c.style.opacity = 0; return; }
        ch.c.style.opacity = 1 - E.in2(P(q, 0.4, 0.9));
        tf(ch.c, ch.vx * q, ch.vy * q + 900 * q * q, q * 300 * (i % 2 ? 1 : -1), 1);
      });
      // tally strokes
      strokes.forEach((s, i) => { s.setAttribute('stroke-dashoffset', 100 * (1 - E.out3(P(t, T.tally[i], T.tally[i] + 0.22)))); });
      diag.setAttribute('stroke-dashoffset', 205 * (1 - E.out3(P(t, T.tally[4], T.tally[4] + 0.3))));
    };
  })();

  /* =========================================================
     SCENE 2: kirana bills with split-mode stamps
  ========================================================= */
  (function () {
    const root = makeScene(1);
    const bills = [
      { nm: 'Beach villa', by: 'Asha', top: ['Kirana parchi', 'No. 01'], total: 2400000, label: 'Total', mode: 'Equal', sub: '÷ 4', ind: false,
        lines: [['Sam', 600000], ['Asha', 600000], ['Ravi', 600000], ['Meera', 600000]], rot: -1.6 },
      { nm: 'Scooter rental', by: 'Ravi', top: ['Kirana parchi', 'No. 02'], total: 180000, label: 'Total', mode: 'Shares', sub: '2 : 1 : 1', ind: true,
        lines: [['Sam ×2', 90000], ['Ravi ×1', 45000], ['Meera ×1', 45000]], rot: 1.2 },
      { nm: 'Seafood thali', by: 'Ravi', top: ['Kirana parchi', 'No. 03'], total: 620000, label: 'Total', mode: 'Exact', sub: 'to the paisa', ind: false,
        lines: [['Sam', 180000], ['Asha', 130000], ['Ravi', 155000], ['Meera', 155000]], rot: -0.8 },
      { nm: 'Villa deposit back', by: 'Asha', top: ['Kirana parchi', 'No. 04'], total: -200000, label: 'Refund', mode: 'Percent', sub: '40 · 30 · 30', ind: true,
        lines: [['Sam 40%', -80000], ['Asha 30%', -60000], ['Meera 30%', -60000]], rot: 1.5 }
    ];
    const gap = 72, w = 384, left = (1920 - (4 * w + 3 * gap)) / 2;
    const items = bills.map((b, i) => {
      const e = el('bill', '', root);
      e.style.left = left + i * (w + gap) + 'px'; e.style.top = '168px';
      const neg = b.total < 0;
      e.innerHTML = `<div class="top"><span>${b.top[0]}</span><span>${b.top[1]}</span></div>
        <div class="nm" style="${b.nm.length > 16 ? 'font-size:35px' : ''}">${b.nm}</div><div class="by">Paid by ${b.by}</div><div class="rl"></div>
        ${b.lines.map(([n, a]) => `<div class="ln${a < 0 ? ' neg' : ''}"><span>${n}</span><span>${inr(a)}</span></div>`).join('')}
        <div class="tot${neg ? ' neg' : ''}"><span>${b.label}</span><b>${inr(b.total)}</b></div><div class="tz"></div>`;
      const st = el('stamp' + (b.ind ? ' ind' : ''), `${b.mode}<small>${b.sub}</small>`, e);
      st.style.right = '-14px'; st.style.bottom = '22px';
      return { e, st, b, i, rot: b.rot, srot: [-9, 7, -6, 8][i] };
    });
    // legend
    const lg = [['Equal', 0], ['Exact', 0], ['Shares', 0], ['Percent', 0]];
    const lgEls = lg.map(([n], i) => {
      const p = el('pill', n, root); return p;
    });
    const lgLab = el('', '<span style="font-size:26px;letter-spacing:.2em;font-weight:600;font-stretch:75%;text-transform:uppercase;color:#4E4A42">4 split modes. Resolved to paise, stored as resolved.</span>', root);
    lgLab.style.cssText += 'position:absolute;left:0;right:0;top:828px;text-align:center';
    const pw = [190, 190, 200, 220], pg = 28, tw = pw.reduce((a, b) => a + b, 0) + pg * 3;
    let px = (1920 - tw) / 2;
    lgEls.forEach((p, i) => { p.style.left = px + 'px'; p.style.top = '746px'; p.style.width = pw[i] + 'px'; p.style.justifyContent = 'center'; px += pw[i] + pg; });

    scenes[1].upd = (t) => {
      items.forEach((it) => {
        const a = E.out3(P(t, T.billLand[it.i] - 0.65, T.billLand[it.i]));
        const fall = 1 - a;
        const y = -(fall * 900);
        const r = it.rot + fall * (it.i % 2 ? 9 : -9);
        const settle = t > T.billLand[it.i] ? Math.exp(-(t - T.billLand[it.i]) * 9) * Math.sin((t - T.billLand[it.i]) * 38) * 5 : 0;
        // gentle float after settling
        const fl = Math.sin(t * 1.3 + it.i) * 2 * E.out2(P(t, 8, 9));
        tf(it.e, 0, y + settle + fl, r);
        it.e.style.opacity = t >= T.billLand[it.i] - 0.7 ? 1 : 0;
        const sp = P(t, T.billStamp[it.i], T.billStamp[it.i] + 0.22);
        it.st.style.opacity = sp > 0 ? 1 : 0;
        tf(it.st, 0, 0, it.srot, lerp(2.4, 1, E.out4(sp)));
        if (sp > 0 && sp < 1) it.st.style.opacity = E.out2(sp * 1.5 > 1 ? 1 : sp * 1.5);
      });
      lgEls.forEach((p, i) => {
        const a = E.out3(P(t, T.legend + i * 0.12, T.legend + i * 0.12 + 0.4));
        p.style.opacity = a; tf(p, 0, (1 - a) * 26);
        // sweep highlight
        const on = ((t - (T.legend + 0.9)) / 0.55) | 0;
        p.classList.toggle('on', t > T.legend + 0.9 && on % 4 === i && t < 9.6);
      });
      const la = E.out3(P(t, T.legend + 0.5, T.legend + 1.0));
      lgLab.style.opacity = la;
    };
  })();

  /* =========================================================
     SCENE 3: chai bill, one split in paise
  ========================================================= */
  (function () {
    const root = makeScene(2);
    const bill = el('bill', '', root);
    bill.style.cssText += ';left:150px;top:150px;width:560px;padding:32px 34px 44px;min-height:0;font-size:30px';
    bill.innerHTML = `<div class="top" style="font-size:20px"><span>Kirana parchi</span><span>Day 2</span></div>
      <div class="nm" style="font-size:54px;margin-top:10px">Chai &amp; bun maska</div><div class="by" style="font-size:30px">Paid by Asha</div><div class="rl"></div>
      <div class="ln"><span>Equal ÷ 4 members</span></div>
      <div class="tot" style="margin-top:22px"><span style="font-size:24px">Total</span><b style="font-size:58px">₹250.01</b></div>
      <div class="ln" style="margin-top:8px"><span>= 25,001 paise</span></div>
      <div class="ln" style="margin-top:16px;border-top:2px dashed #4E4A42;padding-top:14px"><span>25,001 ÷ 4</span><span>6,250 each</span></div>
      <div class="ln"><span>left over</span><span id="lo" style="color:#B8321C;font-weight:700">1 paisa</span></div><div class="tz"></div>`;
    const lo = bill.querySelector('#lo');
    const names = ['Sam', 'Asha', 'Ravi', 'Meera'];
    const rowY = [150, 300, 450, 600];
    const rows = names.map((n, i) => {
      const r = el('row', `<div class="who">${n}</div><div class="shr">Share</div><div class="amt">₹62.50</div>`, root);
      r.style.top = rowY[i] + 'px';
      return { r, amt: r.querySelector('.amt'), i };
    });
    // connector rails + chits
    const rails = svg(1920, 1080, root);
    rows.forEach((o, i) => sv('path', { d: `M700 ${rowY[i] + 64} H940`, stroke: '#4E4A42', 'stroke-width': 3, 'stroke-dasharray': '3 10', 'stroke-linecap': 'round', fill: 'none', opacity: .55 }, rails));
    const chits = rows.map((o, i) => el('chit', '₹62.50', root));
    const coin = el('coin', '₹0.01', root);
    
    const rec = el('', 'Shares add up to ₹250.01. To the paisa.', root);
    rec.style.cssText = 'position:absolute;left:940px;top:760px;width:840px;font-size:40px;font-weight:600;font-stretch:90%;color:#191817';
    rec.style.top = '790px'; rec.style.display = 'none';

    scenes[2].upd = (t) => {
      const a0 = E.out4(P(t, 10.15, 10.9));
      tf(bill, 0, (1 - a0) * 60); bill.style.opacity = a0;
      const lo0 = P(t, T.leftover - 0.3, T.leftover + 0.2);
      lo.style.opacity = t > T.leftover - 0.2 ? 1 : 0.0;
      bill.querySelectorAll('.ln')[2].style.opacity = t > T.leftover - 0.8 ? 1 : 0; bill.querySelectorAll('.ln')[1].style.opacity = 1;
      bill.querySelectorAll('.ln')[3].style.opacity = t > T.leftover - 0.3 ? 1 : 0;
      rows.forEach((o, i) => {
        const a = E.out3(P(t, 10.55 + i * 0.1, 11.05 + i * 0.1));
        o.r.style.opacity = a; tf(o.r, (1 - a) * 90, 0);
        const landed = t >= T.chits[i] + 0.55;
        o.amt.style.opacity = landed ? 1 : 0.0;
        // asha amount flips when coin lands
        if (i === 1) {
          const f = P(t, T.coinFly[1], T.coinFly[1] + 0.3);
          o.amt.textContent = f > 0.5 ? '₹62.51' : '₹62.50';
          o.amt.style.color = f > 0.5 ? '#B8321C' : '#191817';
          o.amt.style.transform = `scale(${1 + 0.18 * Math.sin(f * Math.PI)})`;
          o.amt.style.transformOrigin = 'right center';
          o.r.style.background = f > 0.5 ? '#FBE9E2' : '#FBF8F0';
          const sh = o.r.querySelector('.shr');
          sh.textContent = f > 0.5 ? 'Payer takes the odd paisa' : 'Share';
          sh.style.color = f > 0.5 ? '#B8321C' : '';
          sh.style.fontWeight = f > 0.5 ? 800 : '';
        }
      });
      chits.forEach((c, i) => {
        const q = P(t, T.chits[i], T.chits[i] + 0.55);
        const e = E.io3(q);
        c.style.opacity = q > 0 && q < 1 ? 1 : 0;
        // travels from the bill's total edge to the row
        tf(c, lerp(580, 1560, e), lerp(470, rowY[i] + 41, e), 0, 1);
        c.style.left = '0px'; c.style.top = '0px';
      });
      // coin: leftover appears on bill, then arcs to Asha
      const appear = E.back(P(t, T.leftover, T.leftover + 0.35));
      const fly = E.io3(P(t, T.coinFly[0], T.coinFly[1]));
      const sx = 640, sy = 650, ex = 1250, ey = rowY[1] + 32;
      const x = lerp(sx, ex, fly), y = lerp(sy, ey, fly) - Math.sin(fly * Math.PI) * 190;
      const gone = t > T.coinFly[1] + 0.05;
      coin.style.opacity = t >= T.leftover && !gone ? 1 : 0;
      tf(coin, x, y, fly * 360, appear * (1 - 0.15 * fly));
      coin.style.left = '0px'; coin.style.top = '0px';
            
      
      const ra = E.out3(P(t, T.reconcile, T.reconcile + 0.5));
      rec.style.display = ra > 0 ? 'block' : 'none'; rec.style.opacity = ra; tf(rec, 0, (1 - ra) * 20);
      rec.style.top = '752px';
    };
  })();

  /* =========================================================
     SCENE 4: kolam, tangle -> transfer plan, with trail
  ========================================================= */
  (function () {
    const root = makeScene(3);
    const pos = { Sam: [560, 450], Asha: [960, 210], Meera: [1360, 450], Ravi: [960, 710] };
    const svgEl = svg(1920, 1080, root);
    // pulli lattice (diamond grid of faint dots)
    const lat = sv('g', {}, svgEl);
    for (let gy = 0; gy < 11; gy++) for (let gx = 0; gx < 22; gx++) {
      const x = 96 + gx * 80 + (gy % 2 ? 40 : 0), y = 170 + gy * 62;
      if (x > 1830 || y > 800) continue;
      sv('circle', { cx: x, cy: y, r: 4, fill: '#23306B', opacity: 0.16 }, lat);
    }
    const N = 320;
    const cr = (a, b, c, d, f) => 0.5 * ((2 * b) + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (-a + 3 * b - 3 * c + d) * f * f * f);
    function spline(pts, n) {
      const out = [], segs = pts.length - 1;
      for (let i = 0; i < n; i++) {
        const u = (i / (n - 1)) * segs, k = Math.min(segs - 1, Math.floor(u)), f = u - k;
        const p0 = pts[Math.max(0, k - 1)], p1 = pts[k], p2 = pts[k + 1], p3 = pts[Math.min(pts.length - 1, k + 2)];
        out.push([cr(p0[0], p1[0], p2[0], p3[0], f), cr(p0[1], p1[1], p2[1], p3[1], f)]);
      }
      return out;
    }
    const sam = pos.Sam, asha = pos.Asha, meera = pos.Meera, ravi = pos.Ravi;
    const tangle = spline([
      sam, [520, 330], [700, 215], asha, [1180, 190], [1420, 330], meera, [1300, 590], [1130, 650], ravi,
      [760, 700], [600, 560], [630, 400], [820, 300], [1000, 330], [1110, 520], [930, 600], [820, 470], [900, 300], asha,
      [1060, 330], [1200, 560], [1010, 690], [900, 560], [1080, 400], [1260, 300], meera], N);
    // target: Sam -> Asha -> Meera, uniform by arc length
    const poly = [sam, asha, meera];
    const L1 = Math.hypot(asha[0] - sam[0], asha[1] - sam[1]), L2 = Math.hypot(meera[0] - asha[0], meera[1] - asha[1]);
    const target = [];
    for (let i = 0; i < N; i++) {
      const d = (i / (N - 1)) * (L1 + L2);
      if (d <= L1) { const f = d / L1; target.push([lerp(sam[0], asha[0], f), lerp(sam[1], asha[1], f)]); }
      else { const f = (d - L1) / L2; target.push([lerp(asha[0], meera[0], f), lerp(asha[1], meera[1], f)]); }
    }
    const pathShadow = sv('polyline', { fill: 'none', stroke: '#D9412A', 'stroke-width': 7, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: .55 }, svgEl);
    const pathInk = sv('polyline', { fill: 'none', stroke: '#23306B', 'stroke-width': 8, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svgEl);
    // Ravi's closed loop
    const rl = sv('circle', { cx: ravi[0], cy: ravi[1], r: 46, fill: 'none', stroke: '#23306B', 'stroke-width': 8, 'stroke-dasharray': 290, 'stroke-dashoffset': 290, transform: `rotate(-90 ${ravi[0]} ${ravi[1]})` }, svgEl);
    // arrowheads for the 2 transfers (point at Asha)
    function arrow(from, to, f) {
      const a = Math.atan2(to[1] - from[1], to[0] - from[0]);
      const x = lerp(from[0], to[0], f), y = lerp(from[1], to[1], f);
      const g = sv('path', { d: 'M-22 -20L10 0L-22 20', fill: 'none', stroke: '#D9412A', 'stroke-width': 9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svgEl);
      g.setAttribute('transform', `translate(${x} ${y}) rotate(${a * 180 / Math.PI})`);
      return g;
    }
    const ar1 = arrow(sam, asha, 0.8), ar2 = arrow(meera, asha, 0.8);
    // dots + labels
    const dots = {};
    for (const k in pos) {
      const [x, y] = pos[k];
      const g = sv('g', {}, svgEl);
      sv('circle', { cx: x, cy: y, r: 30, fill: '#F3EEE2', stroke: '#191817', 'stroke-width': 4 }, g);
      sv('circle', { cx: x, cy: y, r: 14, fill: k === 'Ravi' ? '#191817' : '#D9412A' }, g);
      dots[k] = g;
    }
    const labels = {};
    const net = { Sam: ['−₹7,900.00', 'owes', 'neg'], Asha: ['+₹15,300.00', 'is owed', 'pos'], Meera: ['−₹7,400.00', 'owes', 'neg'], Ravi: ['₹0.00', 'square', 'zero'] };
    for (const k in pos) {
      const [x, y] = pos[k];
      const e = el('', `<div style="font-size:48px;font-weight:700;font-stretch:80%;line-height:1">${k}</div>
        <div style="font-size:30px;font-weight:600;font-stretch:100%;margin-top:4px;color:${net[k][2] === 'neg' ? '#B8321C' : net[k][2] === 'pos' ? '#23306B' : '#4E4A42'}">${net[k][0]} <span style="font-weight:500;color:#4E4A42;font-size:26px;letter-spacing:.06em;text-transform:uppercase;font-stretch:80%">${net[k][1]}</span></div>`, root);
      e.style.position = 'absolute'; e.style.whiteSpace = 'nowrap'; e.style.textShadow = '0 0 6px #F3EEE2,0 0 6px #F3EEE2,0 0 10px #F3EEE2,0 0 10px #F3EEE2';
      if (k === 'Sam') { e.style.left = x - 52 + 'px'; e.style.top = y - 30 + 'px'; e.style.transform = 'translateX(-100%)'; e.style.textAlign = 'right'; }
      else if (k === 'Asha') { e.style.left = x + 56 + 'px'; e.style.top = y - 74 + 'px'; }
      else if (k === 'Ravi') { e.style.left = x + 'px'; e.style.top = y + 50 + 'px'; e.style.transform = 'translateX(-50%)'; e.style.textAlign = 'center'; }
      else { e.style.left = x + 56 + 'px'; e.style.top = y - 34 + 'px'; }
      labels[k] = e;
    }
    // tangle tags
    const tagSpec = [
      ['Sam owes Asha ₹6,000.00', 760, 322], ['Meera owes Asha ₹6,000.00', 1160, 322],
      ['Sam owes Ravi ₹900.00', 740, 590], ['Meera owes Ravi ₹450.00', 1170, 590], ['Ravi owes Asha ₹6,000.00', 960, 455]];
    const tags = tagSpec.map(([txt, x, y], i) => {
      const e = el('', txt, root);
      e.style.cssText += `;position:absolute;left:${x}px;top:${y}px;font-size:25px;font-weight:600;font-stretch:88%;background:#FBF8F0;border:2px solid #191817;padding:5px 12px;white-space:nowrap;margin-left:-50%`;
      e.dataset.x = x; e.dataset.y = y;
      return e;
    });
    // kicker
    const kick = el('', '', root);
    kick.style.cssText = 'position:absolute;left:96px;top:146px;font-size:26px;font-weight:700;font-stretch:78%;letter-spacing:.2em;text-transform:uppercase;color:#4E4A42';
    // transfer labels
    const tl1 = el('', 'Sam pays Asha<br><b style="font-size:46px;font-weight:800;font-stretch:108%">₹7,900.00</b>', root);
    tl1.style.cssText = 'position:absolute;right:' + (1920 - 685) + 'px;top:252px;text-align:right;font-size:32px;font-weight:600;font-stretch:90%;line-height:1.2';
    const tl2 = el('', 'Meera pays Asha<br><b style="font-size:46px;font-weight:800;font-stretch:108%">₹7,400.00</b>', root);
    tl2.style.cssText = 'position:absolute;left:1220px;top:252px;font-size:32px;font-weight:600;font-stretch:90%;line-height:1.2';
    // why tag and trail card
    const why = el('', 'why?', root);
    why.style.cssText = 'position:absolute;left:0;top:0;background:#D9412A;color:#FBF8F0;font-weight:800;font-stretch:80%;font-size:34px;letter-spacing:.06em;padding:8px 22px;border-radius:30px;box-shadow:3px 3px 0 #191817';
    const wx = lerp(sam[0], asha[0], 0.5) - 52, wy = lerp(sam[1], asha[1], 0.5) - 28;
    const card = el('', `<div style="font-size:22px;letter-spacing:.2em;font-weight:700;font-stretch:75%;text-transform:uppercase;color:#B8321C">Trail · Sam pays Asha</div>
      <div style="border-top:3px solid #191817;margin:10px 0 8px"></div>
      ${[['Beach villa', -600000], ['Scooter rental', -90000], ['Seafood thali', -180000], ['Villa deposit back', 80000]].map(([n, a]) => `<div class="ln" style="display:flex;justify-content:space-between;font-size:28px;line-height:1.4;font-weight:500"><span style="color:#4E4A42">${n}</span><span style="${a > 0 ? 'color:#23306B' : ''}">${inr(a, true)}</span></div>`).join('')}
      <div style="border-top:3px solid #191817;margin-top:8px;padding-top:8px;display:flex;justify-content:space-between;font-size:28px;font-weight:800"><span>Net position</span><span style="color:#B8321C">−₹7,900.00</span></div>`, root);
    card.style.cssText += ';position:absolute;left:96px;top:548px;width:600px;background:#FBF8F0;border:3px solid #191817;box-shadow:5px 5px 0 #191817;padding:22px 26px 20px';
    const leader = sv('path', { d: `M${wx + 30} ${wy + 54} Q ${wx - 60} 480 ${96 + 600} 560`, fill: 'none', stroke: '#D9412A', 'stroke-width': 4, 'stroke-dasharray': '2 10', 'stroke-linecap': 'round' }, svgEl);

    const drift = (i, t, amt) => [Math.sin(t * 1.7 + i * 0.09) * amt, Math.cos(t * 1.3 + i * 0.11) * amt];
    scenes[3].upd = (t) => {
      const draw = E.out2(P(t, T.kolamDraw[0], T.kolamDraw[1]));
      const m = P(t, T.morph[0], T.morph[1]);
      const nVis = Math.max(2, Math.floor(N * (m > 0 ? 1 : draw)));
      const pts = [];
      const K = 0.7;
      for (let i = 0; i < nVis; i++) {
        const loc = E.io3(clamp(m * (1 + K) - (i / (N - 1)) * K));
        const [dx, dy] = drift(i, t, 7 * (1 - loc) * (1 - m));
        const x = lerp(tangle[i][0] + dx, target[i][0], loc), y = lerp(tangle[i][1] + dy, target[i][1], loc);
        pts.push(x.toFixed(1) + ',' + y.toFixed(1));
      }
      const s = pts.join(' ');
      pathInk.setAttribute('points', s);
      pathShadow.setAttribute('points', pts.map((p) => { const [x, y] = p.split(','); return (+x + 3) + ',' + (+y + 2.5); }).join(' '));
      // dots + labels in
      for (const k of Object.keys(pos)) {
        const a = E.out3(P(t, 16.15 + Object.keys(pos).indexOf(k) * 0.12, 16.7 + Object.keys(pos).indexOf(k) * 0.12));
        dots[k].setAttribute('opacity', a);
        labels[k].style.opacity = a;
        const lab = labels[k];
        lab.style.transform = (k === 'Sam' ? 'translateX(-100%) ' : k === 'Ravi' ? 'translateX(-50%) ' : '') + `translateY(${(1 - a) * 14}px)`;
      }
      lat.setAttribute('opacity', E.out2(P(t, 16.0, 16.8)));
      // tangle tags
      tags.forEach((e, i) => {
        const a = E.out3(P(t, T.kolamDraw[0] + 0.7 + i * 0.28, T.kolamDraw[0] + 1.1 + i * 0.28)) * (1 - E.in2(P(t, T.morph[0] - 0.15, T.morph[0] + 0.5)));
        e.style.opacity = a; e.style.display = a > 0.01 ? 'block' : 'none';
        e.style.transform = `translate(${-50}%,${(1 - a) * 10}px)`;
        e.style.marginLeft = '0';
      });
      // kicker
      const k1 = 1 - E.in2(P(t, T.morph[0] - 0.1, T.morph[0] + 0.3)), k2 = E.out2(P(t, T.morph[1] - 0.3, T.morph[1] + 0.3));
      kick.innerHTML = t < T.morph[0] + 0.3 ? 'Before · four expenses, everyone owing everyone' : 'After · transfer plan, 2 transfers';
      kick.style.opacity = t < T.morph[0] + 0.3 ? E.out3(P(t, 16.3, 16.9)) * k1 : k2;
      // Ravi loop
      rl.setAttribute('stroke-dashoffset', 290 * (1 - E.out3(P(t, T.ravi, T.ravi + 0.6))));
      // arrows & transfer labels
      const aa = E.out3(P(t, T.morph[1] - 0.2, T.morph[1] + 0.4));
      ar1.setAttribute('opacity', aa); ar2.setAttribute('opacity', aa);
      tl1.style.opacity = aa; tl2.style.opacity = aa;
      tf(tl1, 0, (1 - aa) * 12); tf(tl2, 0, (1 - aa) * 12);
      // why tag + trail
      const wp = E.back(P(t, T.why, T.why + 0.35));
      why.style.opacity = t > T.why ? 1 : 0;
      why.style.transform = `translate(${wx}px,${wy}px) scale(${wp})`;
      const cp = E.out4(P(t, T.why + 0.45, T.why + 1.1));
      card.style.opacity = cp; card.style.display = cp > 0 ? 'block' : 'none';
      tf(card, (1 - cp) * -60, 0);
      leader.setAttribute('opacity', cp);
    };
  })();

  /* =========================================================
     SCENE 5: UPI standee, settle, stamps
  ========================================================= */
  (function () {
    const root = makeScene(4);
    const st = el('', '', root);
    st.style.cssText = 'position:absolute;left:150px;top:150px;width:600px;height:700px';
    // base trapezoid
    const baseS = svg(600, 700, st);
    sv('path', { d: 'M40 600H560L600 690H0Z', fill: '#E9E2D2', stroke: '#191817', 'stroke-width': 4, 'stroke-linejoin': 'round' }, baseS);
    sv('path', { d: 'M40 600H560', stroke: '#191817', 'stroke-width': 4 }, baseS);
    const card = el('', '', st);
    card.style.cssText = 'position:absolute;left:0;top:0;width:600px;height:604px;background:#FBF8F0;border:4px solid #191817;box-shadow:6px 6px 0 #191817;border-radius:8px 8px 0 0';
    el('', '<span>Settle up</span><span>UPI</span>', card).style.cssText = 'position:absolute;left:-4px;right:-4px;top:-4px;height:84px;background:#23306B;color:#FBF8F0;display:flex;justify-content:space-between;align-items:center;padding:0 32px;font-weight:800;font-stretch:75%;font-size:46px;letter-spacing:.1em;text-transform:uppercase;border-radius:8px 8px 0 0';
    const qr = svg(400, 400, card); qr.style.left = '100px'; qr.style.top = '108px';
    sv('rect', { x: 0, y: 0, width: 400, height: 400, fill: '#FBF8F0' }, qr);
    const M = 25, c = 400 / M;
    seed = 42;
    const fin = (ox, oy) => {
      sv('rect', { x: ox * c, y: oy * c, width: 7 * c, height: 7 * c, fill: '#191817' }, qr);
      sv('rect', { x: (ox + 1) * c, y: (oy + 1) * c, width: 5 * c, height: 5 * c, fill: '#FBF8F0' }, qr);
      sv('rect', { x: (ox + 2) * c, y: (oy + 2) * c, width: 3 * c, height: 3 * c, fill: '#191817' }, qr);
    };
    const inFinder = (x, y) => (x < 8 && y < 8) || (x > M - 9 && y < 8) || (x < 8 && y > M - 9);
    for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
      if (inFinder(x, y)) continue;
      if (x > 9 && x < 15 && y > 9 && y < 15) continue;
      if (rnd() < 0.5) sv('rect', { x: x * c, y: y * c, width: c + 0.4, height: c + 0.4, fill: '#191817' }, qr);
    }
    fin(0, 0); fin(M - 7, 0); fin(0, M - 7);
    sv('rect', { x: 9.5 * c, y: 9.5 * c, width: 6 * c, height: 6 * c, fill: '#FBF8F0' }, qr);
    sv('rect', { x: 10 * c, y: 10 * c, width: 5 * c, height: 5 * c, fill: '#D9412A' }, qr);
    sv('rect', { x: 11 * c, y: 11 * c, width: 3 * c, height: 3 * c, fill: '#FBF8F0' }, qr);
    el('', 'asha@okbank', card).style.cssText = 'position:absolute;left:0;right:0;top:524px;text-align:center;font-size:40px;font-weight:700;font-stretch:100%';
    el('', 'Any UPI app. Scan, pay, come back.', card).style.cssText = 'position:absolute;left:0;right:0;top:570px;text-align:center;font-size:22px;letter-spacing:.14em;font-weight:600;font-stretch:80%;text-transform:uppercase;color:#4E4A42;display:none';
    el('', 'Payee: Asha', card).style.cssText = 'position:absolute;left:0;right:0;top:482px;text-align:center;font-size:22px;letter-spacing:.2em;font-weight:600;font-stretch:80%;text-transform:uppercase;color:#4E4A42;display:none';
    el('', 'tally · a ledger, not a bank', st).style.cssText = 'position:absolute;left:0;right:0;top:632px;text-align:center;font-size:26px;letter-spacing:.2em;font-weight:700;font-stretch:78%;text-transform:uppercase;color:#4E4A42';

    const slips = [
      { who: 'Sam pays Asha', amt: 790000, up: 'upi://pay?pa=asha@okbank&am=7900.00', y: 150, rot: -0.6 },
      { who: 'Meera pays Asha', amt: 740000, up: 'upi://pay?pa=asha@okbank&am=7400.00', y: 450, rot: 0.7 }
    ].map((s, i) => {
      const e = el('', `<div class="lab">Transfer ${i + 1} of 2 \u00B7 via UPI</div>
        <div style="font-size:56px;font-weight:700;font-stretch:80%;margin-top:4px;line-height:1.05">${s.who}</div>
        <div style="font-size:72px;font-weight:800;font-stretch:112%;letter-spacing:-.01em;line-height:1.1;margin-top:2px">${inr(s.amt)}</div>
        <div style="font-size:22px;font-weight:500;color:#4E4A42;margin-top:2px">${s.up}</div>`, root);
      e.style.cssText += `;position:absolute;left:850px;top:${s.y}px;width:920px;height:270px;background:#FBF8F0;border:3px solid #191817;box-shadow:5px 5px 0 #191817;padding:26px 34px;border-radius:6px`;
      const stp = el('stamp', `<span class="deva" style="font-weight:800;font-stretch:90%">\u091A\u0941\u0915\u0924\u093E</span> \u00B7 Settled<small>Settled over UPI</small>`, e);
      stp.style.cssText += ';font-size:54px;right:30px;top:92px;padding:10px 22px 4px';
      return { e, stp, s, i };
    });
    const note = el('', 'Declared by the payer. The payee is told. Net positions go to zero.', root);
    note.style.cssText = 'position:absolute;left:850px;top:752px;width:920px;font-size:32px;font-weight:600;font-stretch:90%;color:#4E4A42';

    scenes[4].upd = (t) => {
      const a = E.out4(P(t, 24.15, 24.9));
      tf(st, 0, (1 - a) * 140); st.style.opacity = a;
      slips.forEach((o) => {
        const q = E.out4(P(t, 24.45 + o.i * 0.3, 25.2 + o.i * 0.3));
        const hit = T.upiStamp[o.i];
        const k = t - hit;
        const sq = k > 0 && k < 0.4 ? Math.sin(k * 40) * 5 * Math.exp(-k * 11) : 0;
        tf(o.e, (1 - q) * 160, sq, o.s.rot);
        o.e.style.opacity = q;
        const sp = P(t, hit, hit + 0.2);
        o.stp.style.opacity = sp > 0 ? 1 : 0;
        tf(o.stp, 0, 0, -9 + o.i * 4, lerp(2.6, 1, E.out4(sp)));
      });
      const na = E.out3(P(t, 28.1, 28.7));
      note.style.opacity = na; tf(note, 0, (1 - na) * 16);
    };
  })();

  /* =========================================================
     SCENE 6: matchbox labels
  ========================================================= */
  (function () {
    const root = makeScene(5);
    const ic = {
      repeat: '<path d="M30 70a50 50 0 0 1 88-22M122 20v32H90M130 80a50 50 0 0 1-88 22M38 130v-32h32" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>',
      guest: '<circle cx="80" cy="50" r="28" fill="none" stroke="currentColor" stroke-width="9" stroke-dasharray="14 12"/><path d="M26 140c0-34 24-52 54-52s54 18 54 52" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-dasharray="1 0"/>',
      key: '<circle cx="52" cy="80" r="30" fill="none" stroke="currentColor" stroke-width="9"/><path d="M82 80H146M122 80v26M142 80v18" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round"/>',
      bars: '<path d="M22 140H138M36 140V96M70 140V56M104 140V84M138 140V30" fill="none" stroke="currentColor" stroke-width="14" stroke-linecap="round"/>',
      tray: '<path d="M80 18V92M52 66l28 28 28-28M24 112v28h112v-28" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>',
      phone: '<rect x="42" y="14" width="76" height="132" rx="14" fill="none" stroke="currentColor" stroke-width="9"/><path d="M80 48V98M60 80l20 20 20-20M68 126h24" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>'
    };
    const labs = [
      { nm: 'Recurring', sb: 'Rent files itself. A retry never double-creates.', ic: ic.repeat, bg: '#D9412A', fg: '#FBF8F0', bd: '#191817' },
      { nm: 'Guests', sb: 'Named, never logged in. They split like anyone.', ic: ic.guest, bg: '#FBF8F0', fg: '#191817', bd: '#191817' },
      { nm: 'Passkeys', sb: 'Sign in with a touch. No password to leak.', ic: ic.key, bg: '#23306B', fg: '#FBF8F0', bd: '#191817' },
      { nm: 'Insights', sb: 'Where it went, and how fast the budget burns.', ic: ic.bars, bg: '#DCE0F0', fg: '#23306B', bd: '#191817' },
      { nm: 'Import from Splitwise', sb: 'Bring the old ledger. Splid works too.', ic: ic.tray, bg: '#D9412A', fg: '#FBF8F0', bd: '#191817', small: true },
      { nm: 'Install as app', sb: 'Home screen, no store. It is a PWA.', ic: ic.phone, bg: '#191817', fg: '#F3EEE2', bd: '#191817' }
    ];
    // two ghost cards behind for depth
    const ghosts = [0, 1].map((g) => { const e = el('mb', '', root); e.innerHTML = `<div class="in" style="background:#E9E2D2"></div>`; e.style.zIndex = 0; return e; });
    const cards = labs.map((L, i) => {
      const e = el('mb', '', root);
      e.style.color = L.fg; e.style.zIndex = 2;
      e.innerHTML = `<div class="in" style="background:${L.bg}"></div><div class="in2"></div>
        <div class="tp"><span>tally · hisaab brand</span><span>No. ${i + 1} of 6</span></div>
        <div class="ic"><svg width="130" height="130" viewBox="0 0 160 160" style="margin-top:0">${L.ic}</svg></div>
        <div class="txt"><div class="nm" style="${L.small ? 'font-size:104px' : ''}">${L.nm}</div><div class="sb">${L.sb}</div></div>
        <div class="bt"><span>Safe to settle</span><span>Strike on ledger</span></div>`;
      e.style.perspective = '1600px';
      return e;
    });
    ghosts.forEach((g, i) => { g.style.zIndex = 1 - i; });
    const dots = labs.map((L, i) => { const d = el('', '', root); d.style.cssText = 'position:absolute;top:786px;width:28px;height:28px;border-radius:50%;border:3px solid #191817'; d.style.left = 960 - 6 * 22 + i * 44 + 'px'; return d; });
    scenes[5].upd = (t) => {
      const base = E.out3(P(t, 29.95, 30.4));
      ghosts.forEach((g, i) => { tf(g, (i + 1) * 14, (i + 1) * 14, (i ? 1.2 : -1.2), 1); g.style.opacity = base; });
      cards.forEach((e, i) => {
        const f = T.flips[i];
        const nextF = i < 5 ? T.flips[i + 1] : 99;
        const inP = P(t, f - 0.3, f);
        const outP = P(t, nextF - 0.22, nextF);
        const vis = t >= f - 0.3 && t < nextF + 0.01;
        e.style.display = vis ? 'block' : 'none';
        if (!vis) return;
        const rotY = inP < 1 ? lerp(-85, 0, E.back(inP)) : lerp(0, 80, E.in2(outP));
        const sc = 1 - 0.04 * outP;
        e.style.transform = `perspective(1800px) rotateY(${rotY}deg) rotate(${(i % 2 ? 1 : -1) * 1.2 * (1 - outP)}deg) scale(${sc})`;
        e.style.opacity = inP < 1 ? clamp(inP * 2) : 1 - outP * 0.6;
        e.style.transformOrigin = '50% 50%';
      });
      dots.forEach((d, i) => {
        const cur = T.flips.filter((f) => t >= f - 0.05).length - 1;
        d.style.background = i === cur ? '#D9412A' : i < cur ? '#191817' : 'transparent';
        d.style.opacity = E.out3(P(t, 30.0, 30.4));
      });
    };
  })();

  /* =========================================================
     SCENE 7: end card, width axis
  ========================================================= */
  (function () {
    const root = makeScene(6);
    const hs = el('', 'हिसाब · the accounts', root);
    hs.className = 'deva';
    hs.style.cssText = 'position:absolute;left:0;right:0;top:132px;text-align:center;font-size:40px;font-weight:600;letter-spacing:.14em;color:#4E4A42';
    const logo = el('logo disp', 'tally', root);
    const l2 = el('line2', '₹0/month. Yours to run. MIT.', root);
    const cta = el('cta', '<div class="btn"><span>Try the demo</span><svg width="64" height="40" viewBox="0 0 64 40"><path d="M4 20H56M40 6l16 14-16 14" fill="none" stroke="#FBF8F0" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg><b>tally.moneytosms.workers.dev/demo</b></div>', root);
    const rule = el('', '', root);
    rule.style.cssText = 'position:absolute;left:480px;right:480px;top:640px;height:0;border-top:3px solid #191817;transform-origin:left center';
    scenes[6].upd = (t) => {
      const w = E.io3(P(t, T.widen[0], T.widen[1]));
      const s = lerp(75, 125, w);
      const wg = lerp(300, 800, E.out3(P(t, T.end - 0.1, T.widen[1])));
      logo.style.fontStretch = s.toFixed(2) + '%';
      logo.style.fontWeight = Math.round(wg);
      const a = E.out4(P(t, T.end, T.end + 0.6));
      logo.style.opacity = a;
      // light tracking shift for polish
      logo.style.letterSpacing = lerp(0.01, -0.02, w) + 'em';
      const h = E.out3(P(t, T.end + 0.3, T.end + 0.9)); hs.style.opacity = h;
      const b = E.out4(P(t, 38.1, 38.7)); l2.style.opacity = b; tf(l2, 0, (1 - b) * 28);
      rule.style.transform = `scaleX(${E.out4(P(t, 38.0, 38.7))})`;
      const c = E.out4(P(t, 38.9, 39.6)); cta.style.opacity = c; tf(cta, 0, (1 - c) * 34);
    };
  })();

  /* ---------- render ---------- */
  function seek(t) {
    t = Math.max(0, Math.min(T.dur, t));
    for (const sc of scenes) {
      const a = P(t, sc.start - 0.0, sc.start + 0.35);
      const isLast = sc.i === scenes.length - 1;
      const o = isLast ? 1 : 1 - E.in2(P(t, sc.end - 0.15, sc.end + 0.3));
      const vis = t >= sc.start - 0.01 && (isLast || t <= sc.end + 0.31);
      show(sc.root, vis);
      if (!vis) continue;
      const alpha = sc.i === 0 ? o : a * o;
      sc.root.style.opacity = alpha.toFixed(3);
      sc.upd(t);
    }
    updCaps(t);
    const cur = Math.min(scenes.length, 1 + S.filter((s, i) => i < scenes.length && t >= s - 0.01).length - 1 + 0);
    pages.innerHTML = `<i>${String(cur).padStart(2, '0')}</i> / 07`;
    chrome.style.display = t >= T.end ? 'none' : 'block';
    chrome.style.opacity = 1 - P(t, T.end - 0.3, T.end);
  }
  window.seek = seek;
  window.ready = (async () => {
    await Promise.all([
      document.fonts.load('800 40px Anek', 'tally ₹0 − ÷ ×'),
      document.fonts.load('400 40px Anek', 'abc ₹0,000.00'),
      document.fonts.load('600 40px Anek', 'abc'),
      document.fonts.load('700 40px AnekDeva', 'चुकता हिसाब')
    ]);
    await document.fonts.ready;
    seek(0);
    return true;
  })();
  seek(0);
})();
