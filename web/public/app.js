/* 圣言 · 圣经智慧视角 —— 前端逻辑 v2 */
(() => {
  'use strict';

  const ACCESS_KEY = 'bible_access_code';

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

  /* ========== 今日经文 ========== */
  const VERSES = [
    ['“耶和华是我的牧者，我必不至缺乏。”', '诗篇 23:1'],
    ['“你们要将一切的忧虑卸给　神，因为他顾念你们。”', '彼得前书 5:7'],
    ['“凡事都有定期，天下万务都有定时。”', '传道书 3:1'],
    ['“你的话是我脚前的灯，是我路上的光。”', '诗篇 119:105'],
    ['“你们要彼此相爱，像我爱你们一样，这就是我的命令。”', '约翰福音 15:12'],
    ['“敬畏耶和华是知识的开端。”', '箴言 1:7'],
    ['“谁能使我们与基督的爱隔绝呢？难道是患难吗？……都不能叫我们与　神的爱隔绝。”', '罗马书 8:35,38-39'],
    ['“我虽然行过死荫的幽谷，也不怕遭害，因为你与我同在。”', '诗篇 23:4'],
    ['“你们祈求，就给你们；寻找，就寻见；叩门，就给你们开门。”', '马太福音 7:7'],
    ['“那赐诸般恩典的　神……必要亲自成全你们，坚固你们，赐力量给你们。”', '彼得前书 5:10'],
  ];
  let vIdx = (new Date().getDate() + new Date().getMonth()) % VERSES.length;
  function setVerse(i) {
    const [t, r] = VERSES[i % VERSES.length];
    document.getElementById('vd-text').textContent = t;
    document.getElementById('vd-ref').textContent = r;
  }
  setVerse(vIdx);
  document.getElementById('vd-switch').onclick = () => setVerse(++vIdx);

  /* ========== 访问码 ========== */
  const overlay = document.getElementById('access-overlay');
  const aInput = document.getElementById('access-input');
  const aErr = document.getElementById('access-err');
  function needAccess() { overlay.hidden = false; aInput.focus(); }
  function gotAccess(code) {
    overlay.hidden = true;
    localStorage.setItem(ACCESS_KEY, code);
  }
  document.getElementById('access-btn').onclick = tryAccess;
  aInput.addEventListener('keydown', e => { if (e.key === 'Enter') tryAccess(); });
  function tryAccess() {
    const code = aInput.value.trim();
    if (!code) { aErr.textContent = '请输入访问码'; return; }
    localStorage.setItem(ACCESS_KEY, code);
    fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-access-code': code },
      body: JSON.stringify({ messages: [{ role: 'user', content: '你好' }] }) })
      .then(r => r.json())
      .then(j => { if (j.needAccess) { aErr.textContent = '访问码不正确'; localStorage.removeItem(ACCESS_KEY); } else { gotAccess(code); } })
      .catch(() => gotAccess(code));
  }
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

  /* ========== 对话 ========== */
  const chat = document.getElementById('chat');
  const inp = document.getElementById('inp');
  const sendBtn = document.getElementById('send');
  const history = [];
  let busy = false;

  function addMsg(role, text, html) {
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + role;
    wrap.innerHTML = `<div class="role">${role === 'assistant' ? '圣言 · 智慧视角' : '你'}</div>` +
      `<div class="bubble">${html || renderInline(text)}</div>`;
    chat.appendChild(wrap);
    smoothScroll();
    return wrap;
  }
  function addCrisis(note) {
    const wrap = document.createElement('div');
    wrap.className = 'msg crisis';
    wrap.innerHTML = `<div class="role">⚠ 请先照顾好自己</div><div class="bubble">${renderInline(note)}</div>`;
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
    busy = true; sendBtn.disabled = true;
    typing();
    const headers = { 'Content-Type': 'application/json' };
    if (accessCode()) headers['x-access-code'] = accessCode();
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers, body: JSON.stringify({ messages: history }) });
      if (res.status === 401) {
        const j = await res.json().catch(() => ({}));
        typingDone(); busy = false; sendBtn.disabled = false;
        if (j.needAccess) { needAccess(); return; }
      }
      if (!res.ok || !res.body) {
        let msg = '请求失败（' + res.status + '），请稍后再试。';
        try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
        typingDone(); addMsg('assistant', '', `<span style="color:#c4534f">⚠ ${esc(msg)}</span>`);
        busy = false; sendBtn.disabled = false;
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '', acc = '';
      let bubble = null;
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
              addMsg('assistant', '', `<span style="color:#c4534f">⚠ ${esc(j.error)}</span>`);
              busy = false; sendBtn.disabled = false;
              return;
            }
            if (j.delta) {
              acc += j.delta;
              if (!bubble) { typingDone(); bubble = addMsg('assistant', ''); }
              bubble.querySelector('.bubble').innerHTML = renderInline(acc);
              smoothScroll();
            }
          } catch {}
        }
      }
      typingDone();
      if (!bubble && !acc) addMsg('assistant', '（没有收到回复，请再试一次）');
      history.push({ role: 'assistant', content: acc });
      busy = false; sendBtn.disabled = false;
    } catch (e) {
      typingDone();
      addMsg('assistant', '', `<span style="color:#c4534f">⚠ 网络异常：${esc(e.message)}</span>`);
      busy = false; sendBtn.disabled = false;
    }
  }

  function autoResize() {
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 140) + 'px';
  }
  inp.addEventListener('input', autoResize);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(inp.value); inp.value = ''; autoResize(); }
  });
  sendBtn.onclick = () => { send(inp.value); inp.value = ''; autoResize(); };

  /* ========== 查经工具 ========== */
  const vq = document.getElementById('vq');
  const vbtn = document.getElementById('vbtn');
  const vres = document.getElementById('vres');
  async function lookup() {
    const q = vq.value.trim();
    if (!q) return;
    vres.innerHTML = '<div class="hint">检索中…</div>';
    vres.classList.add('show');
    try {
      const r = await fetch('/api/verse?q=' + encodeURIComponent(q));
      const j = await r.json();
      if (!j || (j.type === 'empty')) { vres.innerHTML = '<div class="hint">请输入经文或关键词</div>'; return; }
      let html = '<div class="hint">点击即可引用发送给助手：</div>';
      if (j.type === 'reference') {
        j.verses.forEach(v => { html += item(j.book, v); });
      } else {
        if (!j.hits.length) html = '<div class="hint">没有找到，换个关键词试试</div>';
        else j.hits.forEach(h => { html += item('', `${h.ref} ${h.text}`); });
      }
      vres.innerHTML = html;
    } catch { vres.innerHTML = '<div class="hint">检索失败</div>'; }
  }
  function item(book, tx) {
    const m = tx.match(/^(\d+:\d+(?:-\d+)?)\s*/);
    const ref = book + (m ? ' ' + m[1] : '');
    return `<div class="item" data-tx="${esc(tx)}"><div class="rf">${esc(ref)}</div><div class="tx">${esc(tx)}</div></div>`;
  }
  vbtn.onclick = lookup;
  vq.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); lookup(); } });
  vres.addEventListener('click', e => {
    const it = e.target.closest('.item');
    if (!it) return;
    const tx = it.dataset.tx;
    vres.classList.remove('show'); vq.value = '';
    send('', { pre: '请引用这段经文并结合它回答：' + tx });
  });

  /* ========== 开场白 ========== */
  addMsg('assistant',
    '我用圣经的智慧视角陪你聊聊。\n\n你可以说说正在经历的难处，或问我某个困惑 —— 爱、饶恕、苦难、焦虑、方向…都可以。\n\n*仅供你参考，你也可以完全保留自己的判断。*');
})();
