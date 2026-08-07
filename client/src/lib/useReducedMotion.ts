import { useEffect, useState } from "react";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(()=>{
    try{
      const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
      setReduced(mql.matches);
      const onChange = (e:any)=> setReduced(e.matches);
      mql.addEventListener?.("change", onChange);
      return ()=> mql.removeEventListener?.("change", onChange);
    }catch{ return }
  },[]);
  return reduced;
}

export function useHiddenPause(cb: ()=>void, intervalMs: number, opts?: { pauseWhenHidden?: boolean, pauseWhenReduced?: boolean }){
  useEffect(()=>{
    let id:any = null;
    const reduced = opts?.pauseWhenReduced ? (()=>{ try{ return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }catch{return false} })() : false;
    if(reduced) return;
    const start = ()=>{
      if(id) clearInterval(id);
      id = setInterval(()=>{
        if(opts?.pauseWhenHidden!==false && document.hidden) return;
        cb();
      }, intervalMs);
    };
    start();
    const onVis = ()=>{ if(!document.hidden) cb(); };
    document.addEventListener("visibilitychange", onVis);
    return ()=>{ if(id) clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  },[intervalMs]);
}
