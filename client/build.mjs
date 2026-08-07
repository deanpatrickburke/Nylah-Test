// Client bundle for the space.
import { buildClient } from "@hatch/space-sdk/build";
import { cp, mkdir, readFile, writeFile, readdir, copyFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

await buildClient();

try {
  const publicDir = "./client/public";
  const outDir = "./client/dist";
  const assetsDir = join(outDir, "assets");
  if (existsSync(publicDir)) {
    await cp(publicDir, outDir, { recursive: true, force: true, filter: (src) => {
      // Exclude supabase-init.sql - must never go to Pages (causes build failed)
      if (src.endsWith("supabase-init.sql")) return false;
      return true;
    }});
  }
  // Ensure no supabase-init.sql leaked via older build
  try { const sqlPath = `${outDir}/supabase-init.sql`; if (existsSync(sqlPath)) { const { unlink } = await import("node:fs/promises"); await unlink(sqlPath); } } catch {}

  // fix asset icons
  try {
    if (existsSync(assetsDir)) {
      const files = await readdir(assetsDir);
      for (const f of files.filter(x=>x.startsWith("icon-")&&x.endsWith(".png"))) {
        try {
          const full = join(assetsDir,f);
          if (readFileSync(full).length < 5000) {
            const src = join(publicDir, f.includes("512") ? "icon-512.png" : "icon-192.png");
            if (existsSync(src)) await copyFile(src, full);
          }
        } catch {}
      }
      for (const mf of files.filter(f=>f.endsWith(".webmanifest"))) {
        try {
          const p = join(assetsDir,mf);
          const j = JSON.parse(await readFile(p,"utf8"));
          let ch=false;
          if (j.scope==="/"){j.scope="./";ch=true;}
          if (j.start_url==="/?standalone"){j.start_url="./?standalone";ch=true;}
          if (Array.isArray(j.icons)) for (const ic of j.icons) if (typeof ic.src==="string"&&ic.src.startsWith("/")){ic.src="."+ic.src;ch=true;}
          if (ch) await writeFile(p, JSON.stringify(j),"utf8");
        } catch {}
      }
    }
  } catch {}

  try { if (!existsSync(`${outDir}/404.html`) && existsSync(`${outDir}/index.html`)) await cp(`${outDir}/index.html`, `${outDir}/404.html`, {force:true}); } catch {}

  // Strip provider wrapper - V20 fix: robust balanced-paren replacement (no extra } )
  try {
    if (existsSync(assetsDir)) {
      for (const jf of (await readdir(assetsDir)).filter(f=>f.endsWith(".js"))) {
        const jp = join(assetsDir,jf);
        let code = await readFile(jp,"utf8");
        if (!code.includes("hatch-space-root")) continue;
        // If source already clean (no QueryClientProvider / client:) skip
        if (!code.includes("client:") && !code.includes("QueryClient")) {
          // still verify no extra })
          continue;
        }
        const crIdx = code.indexOf(".createRoot(");
        if (crIdx===-1) continue;
        const rendIdx = code.indexOf(".render(", crIdx);
        if (rendIdx===-1) continue;
        const afterRender = rendIdx + ".render(".length;
        // Find hatch div marker after render
        const marker = 'className:"hatch-space-root"';
        const markerIdx = code.indexOf(marker, afterRender);
        if (markerIdx===-1) continue;
        // locate start of H("div" that contains marker
        let innerStart = code.lastIndexOf('H("div"', markerIdx);
        if (innerStart===-1) innerStart = code.lastIndexOf("H('div'", markerIdx);
        if (innerStart===-1) continue;
        // Find App var after marker: children:H(VAR,{})
        const afterMarker = code.slice(markerIdx, markerIdx+500);
        const m = afterMarker.match(/children:H\(([A-Za-z0-9_$]+),\{\}\)/);
        if (!m) continue;
        const appVar = m[1];
        const replacement = `H("div",{className:"hatch-space-root","data-hatch-space-root":!0,children:H(${appVar},{})})`;
        // Now we need to replace the entire render argument (from afterRender to matching close paren of render)
        // Find matching ) for render( using paren balance on slice starting at afterRender
        let depth = 0;
        let i = afterRender;
        // we expect first char is H or similar, we will scan until we close render
        // Initialize depth for the opening '(' of render already consumed, so depth=1
        depth = 1;
        for (; i < code.length; i++) {
          const ch = code[i];
          if (ch === '(') depth++;
          else if (ch === ')') {
            depth--;
            if (depth===0) break;
          }
        }
        if (depth!==0) continue; // unbalanced
        const renderEnd = i; // index of final ) that closes render
        // Replace from afterRender to renderEnd (exclusive of final ) ? inclusive?) - we want to keep render's final )
        // Actually render arg is inside ... so we replace whole inside: from afterRender to renderEnd
        const inside = code.slice(afterRender, renderEnd);
        // If inside already equals replacement, skip
        if (inside.includes(replacement) && !inside.includes("client")) continue;
        // Build new code: before + replacement + after (starting at renderEnd)
        const before = code.slice(0, afterRender);
        const after = code.slice(renderEnd); // includes closing )
        const newCode = before + replacement + after;
        if (newCode !== code) {
          await writeFile(jp, newCode, "utf8");
          console.log(`[build] V20 robust strip ${jf}: replaced ${inside.length} chars with ${replacement.length}`);
        }
      }
    }
  } catch (e) { console.warn("[build] strip err", e?.message||e); }

  // html fixes - GH Pages needs relative ./assets/ not absolute /assets/
  for (const htmlName of ["index.html","404.html"]) {
    const p = `${outDir}/${htmlName}`;
    if (!existsSync(p)) continue;
    try {
      let h = await readFile(p,"utf8");
      let ch=false;
      // fix absolute /assets/ -> ./assets/ for GitHub Pages /nylah_os/ base
      if (h.includes('"/assets/') || h.includes("'/assets/") || h.includes('href="/assets/') || h.includes('src="/assets/')) {
        h = h.replace(/href="\/assets\//g, 'href="./assets/');
        h = h.replace(/src="\/assets\//g, 'src="./assets/');
        h = h.replace(/href='\/assets\//g, "href='./assets/");
        h = h.replace(/src='\/assets\//g, "src='./assets/");
        ch=true;
      }
      if (/href="\.\/assets\/manifest-.*\.webmanifest"/.test(h)) {
        h = h.replace(/<link\s+rel="manifest"\s+href="\.\/assets\/manifest-[^"]+\.webmanifest"\s*\/?>/, `<link rel="manifest" href="./manifest.webmanifest" />`);
        h = h.replace(/\.\/assets\/manifest-[^"]+\.webmanifest/g, "./manifest.webmanifest");
        ch=true;
      }
      if (h.includes("./assets/icon-192-eg94heyn.png")) { h=h.replace(/\.\/assets\/icon-192-eg94heyn\.png/g,"./icon-192.png"); ch=true; }
      if (h.includes("./assets/icon-512-eg94heyn.png")) { h=h.replace(/\.\/assets\/icon-512-eg94heyn\.png/g,"./icon-512.png"); ch=true; }
      // normalize any lingering ./assets vs assets
      // ensure supabase-env.js present and before module
      if (!h.includes("supabase-env.js")) {
        h = h.replace(/<script[^>]+type="module"[^>]*src=["'][^"']*assets\/index-[^"']*\.js["'][^>]*><\/script>/, m=>`<script src="./supabase-env.js"></script>${m}`);
        if (!h.includes("supabase-env.js")) h=h.replace("</head>",`<script src="./supabase-env.js"></script></head>`);
        ch=true;
      } else {
        const sIdx=h.indexOf("supabase-env.js"); const mIdx=h.indexOf("assets/index-");
        if (mIdx!==-1 && sIdx>mIdx) {
          h=h.replace(/<script src="\.\/supabase-env\.js"><\/script>/g,"");
          h=h.replace(/<script[^>]+type="module"[^>]*src=["'][^"']*assets\/index-[^"']*\.js["'][^>]*><\/script>/, m=>`<script src="./supabase-env.js"></script>${m}`);
          ch=true;
        }
      }
      if (ch) await writeFile(p,h,"utf8");
    } catch {}
  }

  try { const nj=`${outDir}/.nojekyll`; if (!existsSync(nj)) await writeFile(nj,"","utf8"); } catch {}

} catch (e) { console.warn("[build] final warn", e?.message||e); }
