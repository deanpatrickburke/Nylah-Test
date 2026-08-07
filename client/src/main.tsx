import { createRoot } from "react-dom/client";
import React from "react";
import { App } from "./App";
import "./theme.css";

class ErrorBoundary extends React.Component<any,{hasError:boolean; err:any}>{
  constructor(p:any){ super(p); this.state={hasError:false, err:null} }
  static getDerivedStateFromError(err:any){ return {hasError:true, err} }
  componentDidCatch(e:any){ console.error("[beirtos] boundary", e) }
  render(){
    if(this.state.hasError){
      return React.createElement("pre",{style:{padding:"16px",margin:"16px",borderRadius:"12px",background:"#F5F3F0",color:"#0A0A0A",whiteSpace:"pre-wrap",font:"12px/1.4 ui-monospace",border:"1px solid #E8DDD3"}}, `Beirt error - tap to reload\n${this.state.err?.message||this.state.err}\n\n${this.state.err?.stack||""}`);
    }
    return this.props.children;
  }
}

function mount() {
  const raw = document.querySelector<HTMLElement>("[data-generated-space-root]") ||
              document.getElementById("root") as any;
  let rootEl = raw as any;
  if (!rootEl) {
    rootEl = document.createElement("div");
    rootEl.id = "root";
    document.body.appendChild(rootEl);
  }
  // clear white
  rootEl.innerHTML = "";
  try {
    createRoot(rootEl).render(
      <div className="hatch-space-root" data-hatch-space-root>
        <ErrorBoundary><App /></ErrorBoundary>
      </div>
    );
  } catch (e: any) {
    rootEl.innerHTML = `<pre style="padding:16px;color:#8B5E3C;background:#FFFEFB">Beirt mount error: ${e?.message||e}\n${e?.stack||""}</pre>`;
    console.error(e);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  });
}

window.addEventListener("error", (ev)=>{
  const el = document.getElementById("nylah-error");
  if (!el) {
    const d = document.createElement("div");
    d.id = "nylah-error";
    d.style.cssText = "position:fixed;bottom:0;left:0;right:0;background:#8B5E3C;color:#FFFEFB;padding:8px 12px;font:12px/14px system-ui;z-index:99999";
    d.textContent = "JS error: " + (ev.message || ev.error?.message || "unknown");
    document.body.appendChild(d);
  }
});
