/* 圣言 · 圣经智慧视角 —— 前端逻辑 v2 */
(() => {
  'use strict';

  const ACCESS_KEY = 'bible_access_code';
  const THEME_KEY = 'bible_theme';
  const MARKS_KEY = 'bible_bookmarks';

  /* ========== 图标 helper ========== */
  function icon(name, cls) {
    /* 同时带 href 与 xlink:href，兼容旧 WebView / Safari */
    return `<svg class="ic ${cls || ''}" xmlns:xlink="http://www.w3.org/1999/xlink"><use href="#i-${name}" xlink:href="#i-${name}"/></svg>`;
  }

  /* ========== 主题切换（日 / 夜·静谧） ========== */
  const rootEl = document.documentElement;
  function applyTheme(t) {
    rootEl.setAttribute('data-theme', t);
    const iconEl = document.getElementById('theme-icon');
    if (iconEl) iconEl.innerHTML = `<use href="#i-${t === 'night' ? 'moon' : 'sun'}"/>`;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'night' ? '#23201b' : '#fffaf0');
  }
  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    let t = saved;
    if (!t) {
      /* 没有存过：跟随系统偏好，默认亮色 */
      t = (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'night' : 'day';
    }
    if (!['day', 'night'].includes(t)) t = 'day';
    applyTheme(t);
  }
  function toggleTheme() {
    const cur = rootEl.getAttribute('data-theme') === 'night' ? 'night' : 'day';
    const next = cur === 'night' ? 'day' : 'night';
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
  }

  /* ========== 晨光浮尘 ========== */
  const cvs = document.getElementById('motes');
  const ctx = cvs.getContext('2d');
  let motes = [];
  function resize() {
    cvs.width = innerWidth; cvs.height = innerHeight;
    const n = Math.min(160, Math.floor(innerWidth * innerHeight / 12000));
    motes = Array.from({ length: n }, () => ({
      x: Math.random() * cvs.width,
      y: Math.random() * cvs.height,
      r: Math.random() * 1.6 + .6,
      vy: -(Math.random() * .22 + .08),   // 缓慢上升
      vx: (Math.random() - .5) * .15,
      p: Math.random() * Math.PI * 2,
      a: Math.random() * .5 + .3,
    }));
  }
  resize(); addEventListener('resize', resize);
  function draw() {
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    const t = performance.now() / 1000;
    for (const m of motes) {
      m.x += m.vx; m.y += m.vy;
      if (m.y < -10) { m.y = cvs.height + 10; m.x = Math.random() * cvs.width; }
      if (m.x < -10) m.x = cvs.width + 10; if (m.x > cvs.width + 10) m.x = -10;
      const tw = .55 + .45 * Math.sin(m.p + t * 1.4);
      ctx.beginPath();
      ctx.fillStyle = `rgba(217, 164, 65, ${m.a * tw})`;
      ctx.arc(m.x, m.y, m.r, 0, 7);
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }
  draw();

  /* ========== 译本状态（全局） ========== */
  const VER_KEY = 'bible_version';
  const CMP_KEY = 'bible_compare';
  let versions = [];                                    /* 由 /api/versions 填充 */
  let curVer = localStorage.getItem(VER_KEY) || 'cuv';
  let compare = localStorage.getItem(CMP_KEY) === '1';
  function verDef(id) {
    return versions.find(v => v.id === id) || { id, short: id, langName: id, lang: '', name: id };
  }
  function activeVersions() {
    if (!compare) return [curVer];
    const all = versions.map(v => v.id);
    return [curVer, ...all.filter(id => id !== curVer)];   /* 主译本在前，其余并列对照 */
  }
  function verDir(id) { return verDef(id).lang === 'he' ? 'rtl' : 'ltr'; }
  /** 渲染「译本id→经文」；主译本为正文，对照模式下其余译本并列小字 */
  function renderTexts(texts) {
    const ids = Object.keys(texts || {});
    if (!ids.length) return '<div class="vtext muted">（该译本无此节经文）</div>';
    const primary = texts[curVer] !== undefined ? curVer : ids[0];
    const pd = verDef(primary);
    let html = `<div class="vtext${pd.lang === 'he' ? ' rtl' : ''}" dir="${verDir(primary)}">${esc(texts[primary])}</div>`;
    if (compare) {
      const others = ids.filter(id => id !== primary);
      if (others.length) {
        html += '<div class="vparallel">' + others.map(id => {
          const d = verDef(id);
          return `<div class="vp-item"><span class="vp-tag">${esc(d.short || d.langName)}</span>` +
            `<span class="vp-tx" dir="${verDir(id)}">${esc(texts[id])}</span></div>`;
        }).join('') + '</div>';
      }
    }
    return html;
  }
  /** 取一组经文（当前生效译本） */
  async function fetchVerses(q) {
    const r = await fetch(`/api/verse?q=${encodeURIComponent(q)}&v=${activeVersions().join(',')}`);
    return r.json();
  }

  /* ========== 收藏（书签）持久化 ========== */
  function loadMarks() {
    try { return JSON.parse(localStorage.getItem(MARKS_KEY) || '[]'); }
    catch { return []; }
  }
  function saveMarks(list) { localStorage.setItem(MARKS_KEY, JSON.stringify(list)); }
  let marks = loadMarks();
  function isMarked(ref) { return marks.some(m => m.ref === ref); }
  function toggleMark(ref, text) {
    if (isMarked(ref)) marks = marks.filter(m => m.ref !== ref);
    else marks.unshift({ ref, text });
    saveMarks(marks);
    renderMarks();
    flushVDAction(ref);
  }
  function flushVDAction(ref) {
    const btn = document.querySelector('#verse-day .vd-act.mark[data-ref]');
    if (btn && btn.dataset.ref === ref) btn.classList.toggle('on', isMarked(ref));
  }

  /* ========== 今日经文 ========== */
  const VD_REFS = [
    '诗篇 23:1', '彼得前书 5:7', '传道书 3:1', '诗篇 119:105', '约翰福音 15:12',
    '箴言 1:7', '罗马书 8:35', '诗篇 23:4', '马太福音 7:7', '彼得前书 5:10',
  ];
  let vIdx = (new Date().getDate() + new Date().getMonth()) % VD_REFS.length;
  let vdRef = VD_REFS[vIdx], vdText = '';
  let vdToken = 0;                                      /* 防止快速切换时的竞态 */
  async function setVerse(i) {
    vIdx = ((i % VD_REFS.length) + VD_REFS.length) % VD_REFS.length;
    vdRef = VD_REFS[vIdx];
    const token = ++vdToken;
    const body = document.getElementById('vd-body');
    body.innerHTML = '<div class="vtext muted">载入中…</div>';
    document.getElementById('vd-ref').textContent = vdRef;
    try {
      const j = await fetchVerses(vdRef);
      if (token !== vdToken) return;                    /* 已被更新的请求取代 */
      if (j.type === 'verses' && j.verses.length) {
        const texts = j.verses[0].texts;
        vdText = texts[curVer] || Object.values(texts)[0] || '';
        body.innerHTML = renderTexts(texts);
      } else {
        body.innerHTML = '<div class="vtext muted">未取到该节经文</div>';
      }
    } catch { if (token === vdToken) body.innerHTML = '<div class="vtext muted">载入失败</div>'; }
    renderVDActions();
  }
  function renderVDActions() {
    let acts = document.querySelector('#verse-day .vd-actions');
    if (!acts) {
      acts = document.createElement('div');
      acts.className = 'vd-actions';
      document.getElementById('verse-day').appendChild(acts);
    }
    acts.innerHTML =
      `<button class="vd-act mark ${isMarked(vdRef) ? 'on' : ''}" data-ref="${esc(vdRef)}" title="收藏">${icon('mark')}</button>` +
      `<button class="vd-act copy" data-ref="${esc(vdRef)}" title="复制">${icon('copy')}</button>`;
  }
  document.getElementById('vd-switch').onclick = e => { e.stopPropagation(); setVerse(vIdx + 1); };
  document.getElementById('verse-day').addEventListener('click', e => {
    const act = e.target.closest('.vd-act');
    if (!act) return;
    if (!vdText) return;                              /* 经文尚未载入，忽略 */
    if (act.classList.contains('mark')) toggleMark(act.dataset.ref, vdText);
    else if (act.classList.contains('copy')) copyToClip(act.dataset.ref + ' ' + vdText, act);
  });

  /* ========== 访问码 ========== */
  const overlay = document.getElementById('access-overlay');
  const aInput = document.getElementById('access-input');
  const aErr = document.getElementById('access-err');
  function needAccess() { overlay.hidden = false; aInput.focus(); }
  function gotAccess(code) {
    overlay.hidden = true;
    localStorage.setItem(ACCESS_KEY, code);
  }
  let accessFails = 0;
  document.getElementById('access-btn').onclick = tryAccess;
  aInput.addEventListener('keydown', e => { if (e.key === 'Enter') tryAccess(); });
  const accessCode = () => localStorage.getItem(ACCESS_KEY) || '';

  /* ========== 轻量 Markdown 渲染 ========== */
  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function renderInline(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  /* 轻提示（复制成功等） */
  function flash(el, text) {
    const prev = el.title;
    el.title = text;
    const old = el.classList.contains('flash') ? el.offsetWidth : -1;
    el.classList.add('flash');
    setTimeout(() => { el.classList.remove('flash'); el.title = prev; }, 900);
  }
  function copyToClip(text, el) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text)
        .then(() => flash(el, '复制完成'))
        .catch(() => flash(el, '复制失败'));
    } else flash(el, '浏览器不支持复制');
  }

  /* 消息复制工具：返回嵌入 bubble 的复制按钮外挂 */
  function msgToolbar(text) {
    return `<div class="toolbar"><button class="mtool" data-copy="${esc(text)}">${icon('copy')}复制</button></div>`;
  }

  /* ========== 对话 ========== */
  const chat = document.getElementById('chat');
  const inp = document.getElementById('inp');
  const sendBtn = document.getElementById('send');
  const history = [];
  let busy = false;
  let abortCtrl = null;
  const HIST_KEY = 'bible_history';

  function loadHistory() {
    try { const h = JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); return Array.isArray(h) ? h : []; }
    catch { return []; }
  }
  function saveHistory() {
    try { localStorage.setItem(HIST_KEY, JSON.stringify(history.slice(-40))); } catch {}
    const clr = document.getElementById('clear-chat');
    if (clr) clr.hidden = history.length === 0;
  }

  /** 生成中：发送键变「停止」 */
  function setBusy(b) {
    busy = b;
    sendBtn.disabled = false;                       /* 生成中仍可点（用于停止） */
    sendBtn.classList.toggle('stop', b);
    sendBtn.title = b ? '停止生成' : '发送';
    sendBtn.innerHTML = b ? '<span class="stop-square"></span>' : icon('send');
  }
  function stopGen() { if (abortCtrl) abortCtrl.abort(); }

  function addMsg(role, text, html) {
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + role;
    wrap.innerHTML = `<div class="role">${role === 'assistant' ? '圣言 · 智慧视角' : '你'}</div>` +
      `<div class="bubble">${html || renderInline(text)}</div>` + msgToolbar(text);
    chat.appendChild(wrap);
    smoothScroll();
    return wrap;
  }
  function addCrisis(note) {
    const wrap = document.createElement('div');
    wrap.className = 'msg crisis';
    wrap.innerHTML = `<div class="role">${icon('mark')} 请先照顾好自己</div><div class="bubble">${renderInline(note)}</div>` + msgToolbar(note);
    chat.appendChild(wrap);
    smoothScroll();
  }
  function smoothScroll() {
    requestAnimationFrame(() => { chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' }); });
  }
  function typing() {
    const w = document.createElement('div');
    w.className = 'msg assistant';
    w.id = 'typing-msg';
    w.innerHTML = '<div class="bubble"><span class="typing"><i></i><i></i><i></i></span> 默想中…</div>';
    chat.appendChild(w);
    smoothScroll();
  }
  function typingDone() { const t = document.getElementById('typing-msg'); if (t) t.remove(); }

  async function send(userText, opts) {
    const text = (opts && opts.pre) || userText;
    if (!text.trim() || busy) return;
    addMsg('user', text);
    history.push({ role: 'user', content: text });
    saveHistory();
    setBusy(true);
    hideChips();
    typing();
    const headers = { 'Content-Type': 'application/json' };
    if (accessCode()) headers['x-access-code'] = accessCode();
    abortCtrl = new AbortController();
    let acc = '', bubble = null;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers, signal: abortCtrl.signal,
        body: JSON.stringify({ messages: history }),
      });
      if (res.status === 401) {
        const j = await res.json().catch(() => ({}));
        typingDone(); setBusy(false);
        if (j.needAccess) { needAccess(); return; }
      }
      if (!res.ok || !res.body) {
        let msg = '请求失败（' + res.status + '），请稍后再试。';
        try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
        typingDone(); addMsg('assistant', '', `<span style="color:#c4534f">${icon('mark')} ${esc(msg)}</span>`);
        setBusy(false);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const j = JSON.parse(data);
            if (j.crisis) { addCrisis(j.crisis); continue; }
            if (j.error) {
              typingDone();
              if (bubble) bubble.remove();
              addMsg('assistant', '', `<span style="color:#c4534f">${icon('mark')} ${esc(j.error)}</span>`);
              setBusy(false);
              return;
            }
            if (j.delta) {
              acc += j.delta;
              if (!bubble) { typingDone(); bubble = addMsg('assistant', ''); }
              bubble.querySelector('.bubble').innerHTML = renderInline(acc);
              smoothToast(bubble);
            }
          } catch {}
        }
      }
      typingDone();
      if (!bubble && !acc) addMsg('assistant', '（没有收到回复，请再试一次）');
      if (acc) { history.push({ role: 'assistant', content: acc }); saveHistory(); }
      setBusy(false);
    } catch (e) {
      typingDone();
      if (e.name === 'AbortError') {
        /* 用户主动停止：保留已生成的部分，计入历史 */
        if (acc) { history.push({ role: 'assistant', content: acc }); saveHistory(); }
        setBusy(false);
        return;
      }
      addMsg('assistant', '', `<span style="color:#c4534f">${icon('mark')} 网络异常：${esc(e.message)}</span>`);
      setBusy(false);
    }
  }
  /* 流式追加时的滚动：节流，避免每个字都触发平滑滚动 */
  let toastT = 0;
  function smoothToast() {
    const now = Date.now();
    if (now - toastT < 120) return;
    toastT = now;
    smoothScroll();
  }

  function autoResize() {
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 140) + 'px';
  }
  inp.addEventListener('input', autoResize);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(inp.value); inp.value = ''; autoResize(); }
  });
  sendBtn.onclick = () => {
    if (busy) { stopGen(); return; }
    const v = inp.value; send(v); inp.value = ''; autoResize();
  };

  /* ========== 查经工具 ========== */
  const vq = document.getElementById('vq');
  const vbtn = document.getElementById('vbtn');
  const vclear = document.getElementById('vclear');
  const vres = document.getElementById('vres');
  function syncClear() { vclear.hidden = vq.value.trim() === ''; }
  function clearVerse() {
    vq.value = '';
    vres.classList.remove('show');
    vres.innerHTML = '';
    syncClear();
    vq.focus();
  }
  async function lookup() {
    const q = vq.value.trim();
    if (!q) return;
    vres.innerHTML = '<div class="hint">检索中…</div>';
    vres.classList.add('show');
    try {
      const j = await fetchVerses(q);
      if (!j || j.type === 'empty') { vres.innerHTML = '<div class="hint">请输入经文或关键词</div>'; return; }
      if (j.type === 'unavailable') { vres.innerHTML = '<div class="hint">经文数据未加载</div>'; return; }
      let html = '';
      if (j.type === 'verses') {
        html = `<div class="hint">${esc(j.book)} 第 ${j.chapter} 章 · 点击即可引用发送</div>`;
        j.verses.forEach(v => { html += item(`${j.book} ${j.chapter}:${v.v}`, v.texts); });
      } else if (j.type === 'search') {
        if (!j.hits.length) { vres.innerHTML = '<div class="hint">没有找到，换个关键词试试</div>'; return; }
        html = `<div class="hint">共 ${j.total} 处 · 点击即可引用发送</div>`;
        j.hits.forEach(h => { html += item(h.ref, h.texts); });
      }
      vres.innerHTML = html;
    } catch { vres.innerHTML = '<div class="hint">检索失败</div>'; }
  }
  function item(ref, texts) {
    const on = isMarked(ref) ? ' on' : '';
    const pid = texts[curVer] !== undefined ? curVer : Object.keys(texts)[0];
    const primary = texts[pid] || '';
    let sub = '';
    if (compare) {
      const others = Object.entries(texts).filter(([id]) => id !== pid);
      if (others.length) {
        sub = '<div class="vparallel">' + others.map(([id, t]) => {
          const d = verDef(id);
          return `<div class="vp-item"><span class="vp-tag">${esc(d.short || d.langName)}</span>` +
            `<span class="vp-tx" dir="${verDir(id)}">${esc(t)}</span></div>`;
        }).join('') + '</div>';
      }
    }
    return `<div class="item" data-tx="${esc(primary)}" data-ref="${esc(ref)}">` +
      `<div class="itop"><div class="rf">${esc(ref)}</div>` +
      `<button class="imark${on}" title="收藏">${icon('mark')}</button></div>` +
      `<div class="tx" dir="${verDir(pid)}">${esc(primary)}</div>` + sub + '</div>';
  }
  vbtn.onclick = lookup;
  vclear.onclick = clearVerse;
  vq.addEventListener('input', syncClear);
  vq.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); lookup(); } });
  vres.addEventListener('click', e => {
    const mark = e.target.closest('.imark');
    if (mark) {
      const it = mark.closest('.item');
      const ref = it.dataset.ref, tx = it.dataset.tx;
      toggleMark(ref, tx);
      e.stopPropagation();
      return;
    }
    const it = e.target.closest('.item');
    if (!it) return;
    const tx = it.dataset.tx;
    vres.classList.remove('show'); vq.value = '';
    syncClear();
    send('', { pre: '请引用这段经文并结合它回答：' + tx });
  });

  /* ========== 开场白 / 恢复历史 ========== */
  function greet() {
    addMsg('assistant',
      '我用圣经的智慧视角陪你聊聊。\n\n你可以说说正在经历的难处，或问我某个困惑 —— 爱、饶恕、苦难、焦虑、方向…都可以。\n\n*仅供你参考，你也可以完全保留自己的判断。*');
  }
  function restoreHistory() {
    const saved = loadHistory();
    if (!saved.length) return false;
    saved.forEach(m => addMsg(m.role, m.content));
    history.push(...saved);
    return true;
  }
  function clearChat() {
    if (history.length && !confirm('清空当前对话？此操作不可恢复。')) return;
    history.length = 0;
    try { localStorage.removeItem(HIST_KEY); } catch {}
    chat.innerHTML = '';
    greet();
    renderChips();
    saveHistory();
  }

  /* ========== 启动自检：让页面自己说出状态 ========== */
  const statusEl = document.getElementById('status');
  function renderStatus(cfg) {
    if (!statusEl) return;
    statusEl.innerHTML =
      `<span class="sdot ${cfg.keyConfigured ? 'ok' : 'bad'}"></span>API ${cfg.keyConfigured ? '已配置' : '未配置'}` +
      `<span class="sep">·</span>` +
      `<span class="sdot ${cfg.needAccess ? 'ok' : 'off'}"></span>访问码 ${cfg.needAccess ? '已启用' : '未启用'}`;
  }
  (async function boot() {
    try {
      const r = await fetch('/api/config');
      const cfg = await r.json();
      renderStatus(cfg);
      if (cfg.needAccess) {
        /* 需要访问码：主动弹出，避免等 401 */
        if (!accessCode()) needAccess();
      } else {
        overlay.hidden = true; /* 服务明确不需要访问码时，强制关掉弹窗 */
        aErr.textContent = '';
      }
      if (!cfg.keyConfigured) {
        addMsg('assistant', '',
          `<span style="color:#c4534f">${icon('mark')} 服务尚未配置 DeepSeek API Key —— 管理员需在部署平台设置环境变量 <code>DEEPSEEK_API_KEY</code> 后重新部署，聊天才能使用。</span>`);
      }
    } catch {}
  })();

  function tryAccess() {
    const code = aInput.value.trim();
    if (!code) { aErr.textContent = '请输入访问码'; return; }
    localStorage.setItem(ACCESS_KEY, code);
    fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-access-code': code },
      body: JSON.stringify({ messages: [{ role: 'user', content: '你好' }] }) })
      .then(r => r.json())
      .then(j => {
        if (j.needAccess) {
          accessFails++;
          aErr.textContent = accessFails >= 2
            ? '访问码不正确。访问码由网站管理员在部署时设置（环境变量 ACCESS_CODE），请联系管理员获取。'
            : '访问码不正确';
          localStorage.removeItem(ACCESS_KEY);
        } else {
          gotAccess(code);
        }
      })
      .catch(() => gotAccess(code));
  }

  /* ========== 快捷示例 chip ========== */
  const CHIP_EXAMPLES = [
    ['怎么面对焦虑', '我最近非常焦虑，圣经怎么看焦虑这件事？'],
    ['饶恕很难，怎么办', '一个人伤害我很深，饶恕他太难了，圣经怎么讲饶恕？'],
    ['查经文：诗篇 23', '给我诗篇 23 篇，并白话解释'],
    ['我该怎么面对苦难', '正在经历很大的苦难，圣经如何看苦难与盼望？'],
  ];
  function hideChips() {
    const c = document.querySelector('.chips');
    if (c) c.classList.add('hide');
  }
  function renderChips() {
    const chatEl = document.getElementById('chat');
    let chips = document.querySelector('.chips');
    if (!chips) {
      chips = document.createElement('div');
      chips.className = 'chips';
      chatEl.appendChild(chips);
    }
    chips.innerHTML = CHIP_EXAMPLES.map(([label, prompt]) =>
      `<button class="chip" data-prompt="${esc(prompt)}">${esc(label)}</button>`).join('');
    chips.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => { send(chip.dataset.prompt); });
    });
  }
  /* 输入时隐藏快捷chip */
  inp.addEventListener('input', () => { if (inp.value.trim()) hideChips(); });

  /* ========== 消息复制（工具栏委托） ========== */
  document.getElementById('chat').addEventListener('click', e => {
    const btn = e.target.closest('.mtool[data-copy]');
    if (btn) copyToClip(btn.dataset.copy, btn);
  });

  /* ========== 主题切换 ========== */
  initTheme();
  document.getElementById('theme-toggle').onclick = toggleTheme;

  /* ========== 侧栏：书卷 / 收藏 ========== */
  const shelf = document.getElementById('shelf');
  const backdrop = document.getElementById('backdrop');
  const openShelf = () => { shelf.classList.add('on'); backdrop.hidden = false; requestAnimationFrame(() => backdrop.classList.add('on')); };
  const closeShelf = () => {
    shelf.classList.remove('on'); backdrop.classList.remove('on');
    setTimeout(() => { backdrop.hidden = true; }, 300);
  };
  document.getElementById('shelf-toggle').onclick = openShelf;
  document.getElementById('shelf-close').onclick = closeShelf;
  backdrop.onclick = closeShelf;
  /* 页签切换 */
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(t => t.addEventListener('click', () => {
    tabs.forEach(x => x.classList.remove('active')); t.classList.add('active');
    const tab = t.dataset.tab;
    document.getElementById('panel-books').classList.toggle('on', tab === 'books');
    document.getElementById('panel-marks').classList.toggle('on', tab === 'marks');
    if (tab === 'marks') renderMarks();
    else if (tab === 'books' && !document.querySelector('#books-list .bk-item')) loadBooks();
  }));

  /* ---------- 收藏 ---------- */
  const marksList = document.getElementById('marks-list');
  const marksEmpty = document.getElementById('marks-empty');
  function renderMarks() {
    marksList.innerHTML = '';
    marksEmpty.hidden = marks.length > 0;
    marks.forEach(mk => {
      const div = document.createElement('div');
      div.className = 'mk-item';
      div.innerHTML =
        `<button class="mk-del" title="删除收藏">${icon('close')}</button>` +
        `<div class="mk-rf">${esc(mk.ref)}</div><div class="mk-tx">${esc(mk.text)}</div>`;
      div.querySelector('.mk-del').onclick = e => { e.stopPropagation(); toggleMark(mk.ref, mk.text); };
      div.onclick = () => { send('请引用这段经文并结合它回答：' + mk.ref + ' ' + mk.text); closeShelf(); };
      marksList.appendChild(div);
    });
  }

  /* ---------- 书卷浏览 ---------- */
  const booksList = document.getElementById('books-list');
  const bookView = document.getElementById('book-view');
  let curBook = null, curCh = 1;
  async function loadBooks() {
    booksList.innerHTML = '<div class="hint">加载书卷…</div>';
    try {
      const arr = await fetch('/api/books?v=' + encodeURIComponent(curVer)).then(r => r.json());
      if (!Array.isArray(arr)) { booksList.innerHTML = '<div class="hint">书卷加载失败</div>'; return; }
      booksList.innerHTML = '';
      arr.forEach(b => {
        const div = document.createElement('div');
        div.className = 'bk-item';
        div.innerHTML = `<span class="bk-id">${b.id}</span><span class="bk-name">${esc(b.book)}</span>` +
          `<span class="bk-ch">${b.chapters} 章</span>`;
        div.onclick = () => openBook(b);
        booksList.appendChild(div);
      });
    } catch { booksList.innerHTML = '<div class="hint">书卷加载失败</div>'; }
  }
  async function openBook(b) {
    curBook = b; curCh = 1;
    bookView.hidden = false;
    document.getElementById('bv-title').textContent = b.book;
    await loadChapter();
  }
  async function loadChapter() {
    if (!curBook) return;
    document.getElementById('bv-chaptag').textContent = `第 ${curCh} 章 / 共 ${curBook.chapters} 章`;
    document.getElementById('bv-prev').disabled = curCh <= 1;
    document.getElementById('bv-next').disabled = curCh >= curBook.chapters;
    const box = document.getElementById('bv-verses');
    box.innerHTML = '<div class="hint">加载经文…</div>';
    try {
      const j = await fetchVerses(curBook.book + ' ' + curCh);
      if (!j || j.type !== 'verses') { box.innerHTML = '<div class="hint">未能加载该章</div>'; return; }
      box.innerHTML = '';
      j.verses.forEach(it => {
        const ref = `${curBook.book} ${j.chapter}:${it.v}`;
        const pid = it.texts[curVer] !== undefined ? curVer : Object.keys(it.texts)[0];
        const primary = it.texts[pid] || '';
        const div = document.createElement('div');
        div.className = 'bv-v';
        let inner = `<span class="num">${it.v}</span><div class="vbody" dir="${verDir(pid)}">` +
          `<div class="vtext">${esc(primary)}</div>`;
        if (compare) {
          const others = Object.entries(it.texts).filter(([id]) => id !== pid);
          if (others.length) {
            inner += '<div class="vparallel">' + others.map(([id, t]) => {
              const d = verDef(id);
              return `<div class="vp-item"><span class="vp-tag">${esc(d.short || d.langName)}</span>` +
                `<span class="vp-tx" dir="${verDir(id)}">${esc(t)}</span></div>`;
            }).join('') + '</div>';
          }
        }
        inner += `</div><button class="bv-mark ${isMarked(ref) ? 'on' : ''}" data-ref="${esc(ref)}" title="收藏">${icon('mark')}</button>`;
        div.innerHTML = inner;
        div.querySelector('.bv-mark').onclick = e => {
          e.stopPropagation();
          toggleMark(ref, primary);
          e.currentTarget.classList.toggle('on', isMarked(ref));
        };
        box.appendChild(div);
      });
    } catch { box.innerHTML = '<div class="hint">加载失败</div>'; }
  }
  document.getElementById('bv-back').onclick = () => { bookView.hidden = true; };
  document.getElementById('bv-prev').onclick = () => { if (curCh > 1) { curCh--; loadChapter(); } };
  document.getElementById('bv-next').onclick = () => { if (curBook && curCh < curBook.chapters) { curCh++; loadChapter(); } };

  /* ---------- 译本切换器 ---------- */
  function renderVSwitch() {
    const el = document.getElementById('vswitch');
    el.innerHTML = versions.map(v =>
      `<button class="vs-btn${v.id === curVer ? ' on' : ''}" data-v="${v.id}" title="${esc(v.name)}">${esc(v.short || v.langName)}</button>`
    ).join('');
    el.querySelectorAll('.vs-btn').forEach(b => {
      b.onclick = () => {
        curVer = b.dataset.v;
        localStorage.setItem(VER_KEY, curVer);
        renderVSwitch();
        refreshAll();
      };
    });
    const tg = document.getElementById('vtoggle');
    tg.classList.toggle('on', compare);
    tg.textContent = compare ? '对照中' : '对照';
    tg.onclick = () => {
      compare = !compare;
      localStorage.setItem(CMP_KEY, compare ? '1' : '0');
      renderVSwitch();
      refreshAll();
    };
  }
  /** 切换译本 / 对照模式后，刷新所有正在显示经文的地方 */
  function refreshAll() {
    setVerse(vIdx);
    if (vres.classList.contains('show') && vq.value.trim()) lookup();
    if (!bookView.hidden) bookView.hidden = true;              /* 译本变了，原章节可能不在该译本中（原文只有旧约/新约） */
    if (booksList.querySelector('.bk-item')) loadBooks();      /* 书卷清单随译本变化 */
  }

  /* ---------- 启动：拉译本清单 → 渲染切换器 → 首次取经文 ---------- */
  (async function initVersions() {
    try {
      const arr = await fetch('/api/versions').then(r => r.json());
      if (Array.isArray(arr) && arr.length) versions = arr;
    } catch {}
    if (!versions.length) versions = [{ id: 'cuv', short: '和合本', langName: '中文', lang: 'zh', name: '和合本' }];
    if (!versions.some(v => v.id === curVer)) curVer = versions[0].id;
    renderVSwitch();
    setVerse(vIdx);
  })();

  renderMarks();
  if (!restoreHistory()) greet();
  renderChips();
  if (history.length) hideChips();       /* 有历史时不显示快捷 chip */
  saveHistory();
  document.getElementById('clear-chat').onclick = clearChat;
})();
