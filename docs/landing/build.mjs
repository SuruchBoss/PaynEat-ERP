// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0
//
// Builds the landing page (#45) in English and Thai, and the README section "The problems it solves
// today" in README.md and README.th.md, from docs/landing/content.mjs.
//
//   node docs/landing/build.mjs           # write docs/landing/index*.html and both README sections
//   node docs/landing/build.mjs --check   # fail if any of them differs from what content.mjs says (CI)
//
// The page is static HTML and CSS with no JavaScript. The deploy workflow publishes it next to the
// public demo, at /PaynEat-ERP/about/. Its screenshots come from docs/landing/capture.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGUAGES, REPO, SITE, issue } from './content.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const ABOUT = `${SITE}about/`;
const SIZE = { desktop: [1600, 1067], phone: [780, 1688] };
const README_START = '<!-- problems:start -->';
const README_END = '<!-- problems:end -->';

const esc = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const MARK = `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M22 8h30a6 6 0 0 1 6 6v36a6 6 0 0 1-6 6H22a4 4 0 0 1-2.9-1.24L6.2 36.9a7 7 0 0 1 0-9.8L19.1 9.24A4 4 0 0 1 22 8Zm-3.5 28a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/><path fill="none" stroke="var(--mark-lines)" stroke-width="4.4" stroke-linecap="round" d="M29 22H50M29 32H45M29 42H39"/></svg>`;

const CSS = `
:root{
  --ink:#1d1d1f;--ink-2:#424245;--muted:#6e6e73;--line:#d2d2d7;--paper:#fff;--gray:#f5f5f7;--night:#000;--night-2:#161617;
  --brand:#a4480f;--brand-dark:#f29a5c;--link:#a4480f;--mark-lines:#fbeee4;
  --wrap:1080px;--gutter:clamp(16px,4vw,32px);
  --display:${'${DISPLAY}'};
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:400 17px/1.5 var(--display);letter-spacing:-.01em;-webkit-font-smoothing:antialiased;overflow-x:hidden}
img{display:block;max-width:100%;height:auto}
a{color:var(--link);text-decoration:none}
a:hover{text-decoration:underline}
h1,h2,h3,p{margin:0}
code{font:500 .9em ui-monospace,SFMono-Regular,Menlo,monospace}
:focus-visible{outline:3px solid var(--brand-dark);outline-offset:3px;border-radius:6px}
.skip{position:absolute;left:-999px;top:8px;z-index:99;background:#fff;color:#000;padding:8px 12px;border-radius:8px}
.skip:focus{left:12px}
.wrap{max-width:var(--wrap);margin:0 auto;padding:0 var(--gutter)}
[id]{scroll-margin-top:56px}
.mark{width:22px;height:22px;color:var(--brand-dark)}

/* navigation — a thin, translucent bar */
.nav{position:sticky;top:0;z-index:50;background:rgba(22,22,23,.82);backdrop-filter:saturate(1.8) blur(20px);-webkit-backdrop-filter:saturate(1.8) blur(20px);color:#f5f5f7}
.nav .wrap{display:flex;align-items:center;gap:22px;height:48px;font-size:13px}
.nav .brand{display:flex;align-items:center;gap:8px;color:#f5f5f7;font-weight:600;font-size:15px}
.nav .brand:hover{text-decoration:none}
.nav .links{display:flex;gap:22px;margin-left:auto}
.nav .links a,.nav .lang{color:#d2d2d7}
.nav .links a:hover,.nav .lang:hover{color:#fff;text-decoration:none}
.pill{display:inline-flex;align-items:center;gap:6px;border-radius:980px;font-weight:500;white-space:nowrap}
.nav .pill{background:var(--brand-dark);color:#1d1d1f;padding:4px 12px;font-size:12px}
.nav .pill:hover{background:#ffb27e;text-decoration:none}

/* hero */
.hero{background:var(--night);color:#f5f5f7;text-align:center;padding:clamp(56px,9vw,112px) 0 0;overflow:hidden}
.eyebrow{font-size:clamp(17px,2vw,21px);font-weight:600;color:var(--brand-dark)}
.hero h1{font-size:clamp(44px,8vw,96px);line-height:1.04;font-weight:700;letter-spacing:-.035em;margin:10px auto 0;max-width:14em}
.grad{display:block;background:linear-gradient(90deg,#f29a5c 0%,#ffcf9e 45%,#f29a5c 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero .lead{font-size:clamp(19px,2.3vw,24px);line-height:1.4;color:#a1a1a6;max-width:34em;margin:22px auto 0;font-weight:400}
.ctas{display:flex;flex-wrap:wrap;gap:14px 26px;justify-content:center;align-items:center;margin-top:30px;font-size:clamp(17px,1.8vw,19px)}
.btn{background:var(--brand-dark);color:#1d1d1f;padding:12px 24px}
.btn:hover{background:#ffb27e;text-decoration:none}
.more{color:var(--link)}
.hero .more,.band.dark .more{color:var(--brand-dark)}
.more::after{content:" ›"}
.status{display:inline-block;margin:28px auto 0;max-width:40em;font-size:14px;color:#86868b;border:1px solid #333336;border-radius:980px;padding:8px 18px}
.hero-shot{margin:clamp(40px,6vw,72px) auto 0;max-width:1180px;padding:0 var(--gutter)}
.hero-shot .frame{border-radius:18px 18px 0 0;border:1px solid #333336;border-bottom:0;overflow:hidden;
  box-shadow:0 -30px 120px -30px rgba(242,154,92,.35)}

/* sections */
.band{padding:clamp(72px,11vw,140px) 0}
.band.gray{background:var(--gray)}
.band.dark{background:var(--night);color:#f5f5f7}
.band.dark .sub,.band.dark .pain,.band.dark .body{color:#a1a1a6}
.band.dark a{color:var(--brand-dark)}
.center{text-align:center}
.kicker{font-size:clamp(17px,2vw,21px);font-weight:600;color:var(--brand)}
.band.dark .kicker{color:var(--brand-dark)}
.headline{font-size:clamp(36px,6vw,64px);line-height:1.06;font-weight:700;letter-spacing:-.03em;margin-top:8px}
.sub{font-size:clamp(19px,2.2vw,24px);line-height:1.4;color:var(--muted);max-width:32em;margin:18px auto 0}
.pain{font-size:clamp(17px,1.9vw,21px);line-height:1.45;color:var(--muted);max-width:36em;margin:20px auto 0;font-style:italic}
/* Thai has no true italic; a slanted Thai face is harder to read, so the problem line is set upright */
html[lang="th"] .pain{font-style:normal}
.body{font-size:clamp(17px,1.9vw,21px);line-height:1.5;color:var(--ink-2);max-width:40em;margin:18px auto 0}
.points{list-style:none;padding:0;margin:clamp(36px,5vw,56px) auto 0;display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(16px,3vw,32px);max-width:960px;text-align:left}
.points li{border-top:1px solid var(--line);padding-top:16px}
.band.dark .points li{border-color:#333336}
.points b{display:block;font-size:19px;font-weight:600;letter-spacing:-.02em}
.points span{display:block;color:var(--muted);font-size:15px;margin-top:6px}
.band.dark .points span{color:#a1a1a6}
.tag{display:inline-block;margin-top:8px;font-size:12px;font-weight:600;color:var(--brand);border:1px solid currentColor;border-radius:980px;padding:1px 8px}
.band.dark .tag{color:var(--brand-dark)}
.shots{display:grid;gap:clamp(20px,3vw,32px);margin:clamp(44px,6vw,72px) auto 0;max-width:1080px}
/* two desktop screens: a gallery that scrolls sideways, the second peeking in — CSS only */
.shots.two{grid-auto-flow:column;grid-auto-columns:86%;overflow-x:auto;scroll-snap-type:x mandatory;padding:0 0 18px;scrollbar-width:thin}
.shots.two figure{scroll-snap-align:center}
.shots.phones{grid-template-columns:repeat(2,minmax(0,300px));justify-content:center;gap:clamp(24px,5vw,56px)}
figure{margin:0}
.screen{border-radius:14px;overflow:hidden;border:1px solid var(--line);box-shadow:0 30px 60px -30px rgba(0,0,0,.35);background:#fff}
.band.dark .screen{border-color:#333336}
.phone{border-radius:44px;padding:10px;background:#1d1d1f;box-shadow:0 30px 60px -30px rgba(0,0,0,.45)}
.phone img{border-radius:34px}
figcaption{font-size:14px;color:var(--muted);margin-top:14px;text-align:center}
.try{margin-top:28px;font-size:15px;color:var(--muted)}
.try b{color:var(--ink);font-weight:600}
.band.dark .try b{color:#f5f5f7}

/* roadmap */
.road{list-style:none;padding:0;margin:clamp(40px,5vw,60px) auto 0;display:grid;grid-template-columns:repeat(4,1fr);gap:14px;max-width:1080px;text-align:left}
.road a{display:block;height:100%;background:#fff;border-radius:18px;padding:20px;color:var(--ink)}
.road a:hover{text-decoration:none;box-shadow:0 10px 30px -18px rgba(0,0,0,.35)}
.road .n{font-size:13px;color:var(--muted)}
.road b{display:block;font-size:17px;font-weight:600;line-height:1.3;margin-top:6px;letter-spacing:-.015em}
.road .state{display:inline-block;margin-top:12px;font-size:12px;font-weight:600;color:var(--muted)}
.road .state.progress{color:var(--brand)}

/* open source */
.facts{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(16px,3vw,32px);margin:clamp(40px,5vw,60px) auto 0;max-width:960px}
.facts div{text-align:center}
.facts b{display:block;font-size:clamp(26px,3.6vw,40px);font-weight:700;letter-spacing:-.03em;line-height:1.1}
.facts span{display:block;color:#a1a1a6;font-size:15px;margin-top:6px}

/* footer */
footer{background:var(--gray);color:var(--muted);font-size:12px;line-height:1.6;padding:20px 0 36px}
footer p+p{margin-top:6px}
footer nav{display:flex;flex-wrap:wrap;gap:6px 20px;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}
footer a{color:var(--ink-2)}

@media (max-width:860px){
  .nav .links{display:none}
  .nav .lang{margin-left:auto}
  .points,.facts{grid-template-columns:1fr}
  .shots.two{grid-auto-columns:92%}
  .road{grid-template-columns:repeat(2,1fr)}
}
@media (max-width:480px){
  .shots.phones{grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
  .phone{border-radius:30px;padding:7px}
  .phone img{border-radius:24px}
  .road{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
`;

function shot(c, [scene, kind, alt], { eager = false } = {}) {
  const [w, h] = SIZE[kind];
  const loading = eager ? 'fetchpriority="high"' : 'loading="lazy"';
  return `<img src="img/${c.code}-${scene}.webp" width="${w}" height="${h}" alt="${esc(alt)}" ${loading} decoding="async">`;
}

function figure(c, s) {
  const [, kind, alt] = s;
  const cls = kind === 'phone' ? 'phone' : 'screen';
  return `<figure><div class="${cls}">${shot(c, s)}</div>${kind === 'phone' ? '' : `<figcaption>${esc(alt)}</figcaption>`}</figure>`;
}

function problem(c, p, index) {
  const band = ['', 'gray', 'dark'][index % 3];
  const points = p.points
    .map(([b, t, planned]) => {
      const tag = planned ? `<a class="tag" href="${issue(planned)}">${esc(c.labels.planned)} · #${planned}</a>` : '';
      return `<li><b>${esc(b)}</b><span>${esc(t)}</span>${tag}</li>`;
    })
    .join('');
  const phones = p.shots.every(([, kind]) => kind === 'phone');
  const layout = phones ? 'phones' : p.shots.length === 2 ? 'two' : '';
  return `<section class="band ${band} center" id="${p.id}" aria-labelledby="${p.id}-h">
  <div class="wrap">
    <p class="kicker">${esc(p.kicker)}</p>
    <h2 class="headline" id="${p.id}-h">${esc(p.title)}</h2>
    <p class="pain">${esc(p.pain)}</p>
    <p class="body">${esc(p.body)}</p>
    <ul class="points">${points}</ul>
    <div class="shots ${layout}">${p.shots.map((s) => figure(c, s)).join('')}</div>
    <p class="try"><b>${esc(c.labels.try)}:</b> ${esc(p.try)} <a class="more" href="${SITE}">${esc(c.labels.open)}</a></p>
  </div>
</section>`;
}

function page(c) {
  const display =
    c.code === 'th'
      ? `'IBM Plex Sans Thai','Inter',system-ui,-apple-system,sans-serif`
      : `'Inter','IBM Plex Sans Thai',system-ui,-apple-system,sans-serif`;
  const [otherFile, otherLabel, otherCode] = c.nav.other;
  const road = c.next.items
    .map(
      ([n, text, state]) =>
        `<li><a href="${issue(n)}"><span class="n">#${n}</span><b>${esc(text)}</b><span class="state${state ? ' progress' : ''}">${esc(state ? c.labels.progress : c.labels.planned)}</span></a></li>`,
    )
    .join('');
  const url = c.file === 'index.html' ? ABOUT : `${ABOUT}${c.file}`;
  return `<!doctype html>
<!-- Copyright 2026 Suruch Chakrapeesirisuk. SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated by docs/landing/build.mjs from docs/landing/content.mjs (#45). Edit those, not this file. -->
<html lang="${c.code}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(c.title)}</title>
<meta name="description" content="${esc(c.description)}">
<meta name="theme-color" content="#000000">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(c.title)}">
<meta property="og:description" content="${esc(c.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ABOUT}img/${c.code}-stock-dark.webp">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="en" href="${ABOUT}">
<link rel="alternate" hreflang="th" href="${ABOUT}index.th.html">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath fill='%23a4480f' fill-rule='evenodd' d='M22 8h30a6 6 0 0 1 6 6v36a6 6 0 0 1-6 6H22a4 4 0 0 1-2.9-1.24L6.2 36.9a7 7 0 0 1 0-9.8L19.1 9.24A4 4 0 0 1 22 8Zm-3.5 28a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap">
<style>${CSS.replace('${DISPLAY}', display)}</style>
</head>
<body>
<a class="skip" href="#problems">${esc(c.problemsHead.title)}</a>
<header class="nav"><div class="wrap">
  <a class="brand" href="#top">${MARK}<span>PaynEat ERP</span></a>
  <nav class="links" aria-label="${esc(c.nav.label)}">${c.nav.links.map(([h, t]) => `<a href="${h}">${esc(t)}</a>`).join('')}</nav>
  <a class="lang" href="${otherFile}" hreflang="${otherCode}" lang="${otherCode}">${esc(otherLabel)}</a>
  <a class="pill" href="${SITE}">${esc(c.nav.cta)}</a>
</div></header>
<main id="top">
<section class="hero" aria-labelledby="hero-h">
  <div class="wrap">
    <p class="eyebrow">${esc(c.hero.eyebrow)}</p>
    <h1 id="hero-h">${esc(c.hero.title)}<span class="grad">${esc(c.hero.accent)}</span></h1>
    <p class="lead">${esc(c.hero.lead)}</p>
    <div class="ctas"><a class="pill btn" href="${SITE}">${esc(c.hero.cta)}</a><a class="more" href="${REPO}">${esc(c.hero.cta2)}</a></div>
    <p class="status">${esc(c.hero.status)}</p>
  </div>
  <div class="hero-shot"><div class="frame">${shot(c, c.hero.shot, { eager: true })}</div></div>
</section>
<section class="band center" id="problems" aria-labelledby="problems-h">
  <div class="wrap">
    <p class="kicker">${esc(c.problemsHead.kicker)}</p>
    <h2 class="headline" id="problems-h">${esc(c.problemsHead.title)}</h2>
    <p class="sub">${esc(c.problemsHead.sub)}</p>
  </div>
</section>
${c.problems.map((p, i) => problem(c, p, i + 1)).join('\n')}
<section class="band gray center" id="next" aria-labelledby="next-h">
  <div class="wrap">
    <p class="kicker">${esc(c.next.kicker)}</p>
    <h2 class="headline" id="next-h">${esc(c.next.title)}</h2>
    <p class="sub">${esc(c.next.sub)}</p>
    <ul class="road">${road}</ul>
  </div>
</section>
<section class="band dark center" id="open" aria-labelledby="open-h">
  <div class="wrap">
    <p class="kicker">${esc(c.open.kicker)}</p>
    <h2 class="headline" id="open-h">${esc(c.open.title)}</h2>
    <p class="body">${esc(c.open.body)}</p>
    <div class="facts">${c.open.facts.map(([b, t]) => `<div><b>${esc(b)}</b><span>${esc(t)}</span></div>`).join('')}</div>
    <p class="try"><a class="more" href="${c.open.link[1]}">${esc(c.open.link[0])}</a></p>
  </div>
</section>
<section class="band center" aria-labelledby="final-h">
  <div class="wrap">
    <h2 class="headline" id="final-h">${esc(c.final.title)}</h2>
    <p class="sub">${esc(c.final.sub)}</p>
    <div class="ctas"><a class="pill btn" href="${SITE}">${esc(c.final.cta)}</a><a class="more" href="${c.final.install}">${esc(c.final.cta2)}</a></div>
  </div>
</section>
</main>
<footer><div class="wrap">
  ${c.footer.map((p) => `<p>${p}</p>`).join('')}
  <nav aria-label="Links">${c.footerLinks.map(([t, h]) => `<a href="${h}">${esc(t)}</a>`).join('')}</nav>
</div></footer>
</body>
</html>
`;
}

function readmeSection(c) {
  const img = ([scene, kind, alt], width) =>
    `<img src="docs/landing/img/${c.code}-${scene}.webp" width="${width}" alt="${esc(alt)}">`;
  const blocks = c.problems.map((p) => {
    const phones = p.shots.every(([, kind]) => kind === 'phone');
    const width = phones ? 240 : p.shots.length === 2 ? 420 : 720;
    const points = p.points
      .map(([b, t, planned]) => `- **${b}** — ${t}${planned ? ` _(${c.labels.planned}: [#${planned}](${issue(planned)}))_` : ''}`)
      .join('\n');
    return [
      `### ${p.title}`,
      '',
      `<p align="center">\n  ${p.shots.map((s) => img(s, width)).join('\n  ')}\n</p>`,
      '',
      `**${c.labels.problem}:** ${p.pain}`,
      '',
      p.body,
      '',
      points,
      '',
      `**${c.labels.try}:** ${p.try}`,
    ].join('\n');
  });
  return [
    README_START,
    '<!-- Generated by docs/landing/build.mjs from docs/landing/content.mjs (#45). Edit those, not this section. -->',
    '',
    `## ${c.readmeSection.title}`,
    '',
    c.readmeSection.intro,
    '',
    blocks.join('\n\n'),
    '',
    README_END,
  ].join('\n');
}

const check = process.argv.includes('--check');
const stale = [];

function emit(path, content) {
  const current = (() => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  })();
  if (current === content) return;
  if (check) stale.push(path);
  else writeFileSync(path, content);
}

for (const c of LANGUAGES) {
  emit(join(HERE, c.file), page(c));
  const readmePath = join(ROOT, c.readme);
  const readme = readFileSync(readmePath, 'utf8');
  const start = readme.indexOf(README_START);
  const end = readme.indexOf(README_END);
  if (start < 0 || end < start) throw new Error(`${c.readme}: no ${README_START} … ${README_END} markers`);
  emit(readmePath, readme.slice(0, start) + readmeSection(c) + readme.slice(end + README_END.length));
}

if (stale.length) {
  console.error(`Out of date — run node docs/landing/build.mjs and commit:\n  ${stale.join('\n  ')}`);
  process.exit(1);
}
console.log(check ? 'The landing page and both README sections match content.mjs.' : 'Built the landing page and both README sections.');
