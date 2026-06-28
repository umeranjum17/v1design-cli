// `v1design gallery [folder] [--no-open]` — assemble a polished BROWSER gallery of explore
// concepts and open it in the user's default browser. This is the OUTPUT step of `explore`:
// the user flips through Lane A (adapted) vs Lane B (fresh) options and picks one to build.
//
// Pure node — no browser/deps. Reads concept PNGs from <folder> (default ./), preferring a
// manifest.json ([{file,name,style,source,pitch,lane,palette,fonts}]); else infers from
// laneA-*/laneB-* PNG filenames. Writes <folder>/gallery.html and opens it.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { spawn } from "node:child_process";

function openInBrowser(file) {
  const plat = process.platform;
  try {
    if (plat === "darwin") spawn("open", [file], { detached: true, stdio: "ignore" }).unref();
    else if (plat === "win32") spawn("cmd", ["/c", "start", "", file], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [file], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch { return false; }
}

function loadConcepts(folder) {
  const mf = join(folder, "manifest.json");
  if (existsSync(mf)) {
    try {
      const arr = JSON.parse(readFileSync(mf, "utf8"));
      if (Array.isArray(arr) && arr.length) {
        return arr.filter((c) => c && c.file).map((c) => {
          const png = c.file.endsWith(".png") ? c.file : `${c.file}.png`;
          return { ...c, png: existsSync(join(folder, png)) ? png : null };
        });
      }
    } catch { /* fall through to filename inference */ }
  }
  return readdirSync(folder)
    .filter((f) => f.toLowerCase().endsWith(".png") && f !== "gallery.html")
    .map((f) => ({
      file: f, png: f,
      lane: /lane.?a/i.test(f) ? "A" : /lane.?b/i.test(f) ? "B" : "",
      name: basename(f, ".png").replace(/^lane.?[ab][-_]?/i, "").replace(/[-_]/g, " ").trim() || basename(f, ".png"),
    }));
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function card(c) {
  const laneTag = c.lane === "A" ? "Lane A · adapted" : c.lane === "B" ? "Lane B · fresh" : "concept";
  const meta = [c.style, c.palette, c.fonts].filter(Boolean).map(esc).join(" · ");
  return `
    <figure class="card" data-name="${esc(c.name)}">
      <div class="phone">${c.png ? `<img loading="lazy" src="./${esc(c.png)}" alt="${esc(c.name)}">` : `<div class="missing">render missing</div>`}</div>
      <figcaption>
        <span class="lane ${c.lane === "A" ? "a" : "b"}">${esc(laneTag)}</span>
        <h3>${esc(c.name)}</h3>
        ${c.source ? `<p class="src">${esc(c.source)}</p>` : ""}
        ${c.pitch ? `<p class="pitch">${esc(c.pitch)}</p>` : ""}
        ${meta ? `<p class="meta">${meta}</p>` : ""}
        <button class="pick" onclick="pick(this)">Pick this →</button>
      </figcaption>
    </figure>`;
}

function buildHtml(concepts, folder, idea) {
  const A = concepts.filter((c) => c.lane === "A");
  const B = concepts.filter((c) => c.lane === "B");
  const rest = concepts.filter((c) => c.lane !== "A" && c.lane !== "B");
  const section = (title, sub, items) => items.length
    ? `<section><div class="shead"><h2>${esc(title)}</h2><span>${esc(sub)}</span></div><div class="grid">${items.map(card).join("")}</div></section>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>v1design explore — ${esc(idea || "options")}</title>
<style>
  :root{--bg:#f6f7f9;--ink:#15171a;--muted:#697079;--line:#e6e8ec;--card:#fff;--a:#2f6df6;--b:#0b9f7a}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Inter,sans-serif}
  header{padding:34px 28px 10px;max-width:1240px;margin:0 auto}
  header h1{font-size:24px;letter-spacing:-.02em;margin:0 0 4px}
  header p{color:var(--muted);margin:0}
  main{max-width:1240px;margin:0 auto;padding:8px 28px 120px}
  section{margin-top:34px}
  .shead{display:flex;align-items:baseline;gap:12px;border-bottom:1px solid var(--line);padding-bottom:8px;margin-bottom:20px}
  .shead h2{font-size:15px;text-transform:uppercase;letter-spacing:.08em;margin:0}
  .shead span{color:var(--muted);font-size:13px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:24px}
  .card{margin:0;background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;transition:.15s box-shadow,.15s transform}
  .card:hover{box-shadow:0 12px 40px rgba(20,23,26,.10);transform:translateY(-2px)}
  .card.picked{outline:2px solid var(--a);outline-offset:-2px}
  .phone{background:#0c0c0e;display:flex;justify-content:center;padding:16px}
  .phone img{width:100%;max-width:300px;height:auto;border-radius:22px;display:block;box-shadow:0 8px 30px rgba(0,0,0,.4)}
  .missing{color:#888;padding:60px 0;font-size:13px}
  figcaption{padding:16px 18px 18px;display:flex;flex-direction:column;gap:7px}
  .lane{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;align-self:flex-start;padding:3px 9px;border-radius:999px}
  .lane.a{background:rgba(47,109,246,.10);color:var(--a)}
  .lane.b{background:rgba(11,159,122,.12);color:var(--b)}
  h3{font-size:18px;margin:2px 0 0;letter-spacing:-.01em}
  .src{font-size:12.5px;color:var(--muted);margin:0}
  .pitch{font-size:13.5px;color:#3a4048;margin:2px 0 0}
  .meta{font-size:11.5px;color:var(--muted);margin:2px 0 0;font-variant:all-small-caps;letter-spacing:.02em}
  .pick{margin-top:8px;align-self:flex-start;background:var(--ink);color:#fff;border:0;border-radius:10px;padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer}
  .pick:hover{opacity:.9}
  .bar{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid var(--line);padding:14px 28px;display:flex;gap:14px;align-items:center;justify-content:center;font-size:14px}
  .bar b{color:var(--a)}
  code{background:#eef0f3;padding:2px 7px;border-radius:6px;font-size:12.5px}
</style></head>
<body>
  <header>
    <h1>Explore options${idea ? ` — ${esc(idea)}` : ""}</h1>
    <p>Two lanes, side by side. Pick the one you want and build your app from it.</p>
  </header>
  <main>
    ${section("Lane A — adapted from your library", "reuse a proven design, re-pointed to your idea", A)}
    ${section("Lane B — fresh from your recipe", "brand-new, each a distinct design movement", B)}
    ${section("Concepts", "", rest)}
  </main>
  <div class="bar" id="bar">Click <b>Pick this →</b> on the option you want, then tell your coding agent: <code id="cmd">build the &lt;name&gt; concept</code></div>
  <script>
    function pick(btn){
      document.querySelectorAll('.card').forEach(c=>c.classList.remove('picked'));
      const fig=btn.closest('.card'); fig.classList.add('picked');
      const name=fig.getAttribute('data-name');
      document.getElementById('cmd').textContent='build the "'+name+'" concept (spec: this folder)';
      document.getElementById('bar').innerHTML='Picked <b>'+name+'</b> — tell your agent: <code>build the "'+name+'" concept from its HTML in this folder</code>';
      fig.scrollIntoView({behavior:'smooth',block:'center'});
    }
  </script>
</body></html>`;
}

/** CLI entry: v1design gallery [folder] [--no-open] */
export async function galleryCommand(folderArg, flags = {}) {
  const folder = resolve(folderArg || flags.folder || process.cwd());
  if (!existsSync(folder)) throw new Error(`gallery: folder not found: ${folder}`);
  const concepts = loadConcepts(folder);
  if (!concepts.length) throw new Error(`gallery: no concept PNGs (or manifest.json) found in ${folder}`);
  const out = join(folder, "gallery.html");
  writeFileSync(out, buildHtml(concepts, folder, flags.idea || ""));
  const opened = flags["no-open"] ? false : openInBrowser(out);
  console.log(`gallery: ${concepts.length} option(s) → ${out}${opened ? "  (opened in browser)" : flags["no-open"] ? "" : "  (open it manually)"}`);
  return { file: out, count: concepts.length, opened };
}
