#!/usr/bin/env node
/**
 * 手机视口截图工具（headless Chrome + DevTools 协议）
 *
 * 为什么需要它：headless Chrome 的 --window-size 与布局视口宽度不一致，
 * 直接截图会把右侧裁掉造成"溢出"的假象。这里用 Emulation.setDeviceMetricsOverride
 * 做真正的设备模拟，得到准确的手机渲染。
 *
 * 用法：
 *   node tools/shot.js [url] [outfile] [width] [height]
 * 默认：http://localhost:8787/  →  /tmp/shot.png  390×844（iPhone 尺寸）
 * 加 --full    截整页长图
 * 加 --eval "js"  截图前先执行一段 JS（用于模拟交互，如发一条消息）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const CHROME = process.env.CHROME_PATH ||
  ['C:/Program Files/Google/Chrome/Application/chrome.exe',
   'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));

if (!CHROME) { console.error('找不到 Chrome/Edge，可用 CHROME_PATH 环境变量指定'); process.exit(1); }

const rawArgs = process.argv.slice(2);
const evalIdx = rawArgs.indexOf('--eval');
const evalJs = evalIdx >= 0 ? rawArgs[evalIdx + 1] : null;
const full = rawArgs.includes('--full');
const args = rawArgs.filter((a, i) =>
  a !== '--full' && a !== '--eval' && !(evalIdx >= 0 && i === evalIdx + 1));
const url = args[0] || 'http://localhost:8787/';
const out = args[1] || path.join(os.tmpdir(), 'shot.png');
const W = Number(args[2]) || 390;
const H = Number(args[3]) || 844;

const PORT = 9333 + Math.floor(Math.random() * 200);
const profile = path.join(os.tmpdir(), 'shot-profile-' + crypto.randomBytes(4).toString('hex'));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let ws, id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  try {
    // 等 DevTools 端口就绪
    let target = null;
    for (let i = 0; i < 40 && !target; i++) {
      await sleep(250);
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        target = list.find(t => t.type === 'page');
      } catch {}
    }
    if (!target) throw new Error('DevTools 端口未就绪');

    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = m => {
      const d = JSON.parse(m.data);
      if (d.id && pending.has(d.id)) {
        const { res, rej } = pending.get(d.id);
        pending.delete(d.id);
        d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result);
      }
    };

    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: W, height: H, deviceScaleFactor: 2, mobile: true,
    });
    await send('Page.navigate', { url });
    await sleep(3500);                       // 等 JS 拉数据渲染

    if (evalJs) {                            // 模拟交互（发消息、切换状态等）
      await send('Runtime.evaluate', { expression: evalJs, awaitPromise: true });
      await sleep(2500);
    }

    // 顺手报告是否有横向溢出（真机模拟下的判断才准；跳过可横向滚动的容器内部）
    const check = await send('Runtime.evaluate', {
      expression: `(() => {
        const vw = document.documentElement.clientWidth;
        const inScroller = el => {
          for (let p = el.parentElement; p; p = p.parentElement) {
            const ov = getComputedStyle(p).overflowX;
            if (ov === 'auto' || ov === 'scroll') return true;
          }
          return false;
        };
        const bad = [];
        document.querySelectorAll('body *').forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.right > vw + 1 && !inScroller(el)) {
            const n = (typeof el.className === 'string' && el.className) || el.tagName;
            bad.push(n + ' right=' + Math.round(r.right));
          }
        });
        return JSON.stringify({ vw, scrollW: document.documentElement.scrollWidth, overflow: bad.slice(0, 8) });
      })()`, returnByValue: true,
    });
    console.log('视口检查:', check.result.value);

    const shot = await send('Page.captureScreenshot',
      full ? { captureBeyondViewport: true } : {});
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log(`✓ 截图已保存: ${out}  (${W}×${H}${full ? ' 整页' : ''})`);
  } catch (e) {
    console.error('截图失败:', e.message);
    process.exitCode = 1;
  } finally {
    try { ws && ws.close(); } catch {}
    chrome.kill();
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
})();
