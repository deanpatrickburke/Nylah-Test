// PinScreen — scalable dynamic persons, server-only PIN verify via verify_household_pin RPC
// No hardcoded aisling/ciaran, uses local household persons for names

import { useEffect, useState } from "react";
import type { PersonKey } from "../../types";
import { PERSONS } from "../../constants/themes";
import { verifyPin } from "../../lib/pins";

function getHouseholdPersonsRaw(): any[] | null {
  try {
    const hid = localStorage.getItem("couple_v1_household_id");
    const keys = hid ? [`couple_v1_household_persons_${hid}`, `couple_v1_household_persons`] : [`couple_v1_household_persons`];
    for (const k of keys) {
      const raw = localStorage.getItem(k);
      if (raw) {
        try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch {}
      }
    }
  } catch {}
  return null;
}

function bufToB64u(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i=0;i<bytes.length;i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function b64uToBuf(b64u: string): ArrayBuffer {
  let b64 = b64u.replace(/-/g,"+").replace(/_/g,"/");
  const pad = b64.length % 4; if (pad) b64 += "=".repeat(4-pad);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  return bytes.buffer as ArrayBuffer;
}
export function webAuthnIdKey(user: PersonKey){ return `couple_v1_webauthn_${user}`; }
function isWebAuthnSupported(): boolean {
  try { return !!(window as any).PublicKeyCredential; } catch { return false; }
}
async function canDoPlatformBiometric(): Promise<boolean> {
  try {
    const pkc = (window as any).PublicKeyCredential;
    if (!pkc) return false;
    if (pkc.isUserVerifyingPlatformAuthenticatorAvailable) {
      return await pkc.isUserVerifyingPlatformAuthenticatorAvailable();
    }
    return true;
  } catch { return false; }
}
async function authenticateBiometricDynamic(): Promise<PersonKey | null> {
  if (!isWebAuthnSupported()) return null;
  const persons = getHouseholdPersonsRaw();
  const keys: string[] = persons?.map((p:any)=>p.key) || ["person_1","person_2"];
  const stored: { user: string; id: string }[] = [];
  try {
    for (const u of keys) {
      const v = localStorage.getItem(`couple_v1_webauthn_${u}`);
      if (v) stored.push({ user: u, id: v });
    }
    // legacy fallback aisling/ciaran
    if (stored.length===0) {
      for (const u of ["aisling","ciaran"] as string[]) {
        const v = localStorage.getItem(`couple_v1_webauthn_${u}`);
        if (v) stored.push({ user: u, id: v });
      }
    }
  } catch { return null; }
  if (stored.length===0) return null;
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const allow = stored.map(s=> ({ id: b64uToBuf(s.id) as any, type:"public-key" as const, transports: ["internal"] as any }));
  try {
    const assertion: any = await (navigator.credentials as any).get({
      publicKey: { challenge, timeout: 60000, userVerification:"required", allowCredentials: allow }
    });
    if (!assertion || !assertion.rawId) return null;
    const got = bufToB64u(assertion.rawId);
    const match = stored.find(s=> s.id===got);
    if (match) return match.user as PersonKey;
    if (stored.length===1) return stored[0].user as PersonKey;
    return stored[0].user as PersonKey;
  } catch {
    try {
      const assertion: any = await (navigator.credentials as any).get({ publicKey: { challenge, timeout:60000, userVerification:"required" } });
      if (!assertion) return null;
      if (stored.length===1) return stored[0].user as PersonKey;
      return null;
    } catch { return null; }
  }
}

export function PinScreen({ onSelect, onPick }: { onSelect: (k: PersonKey)=>void; onPick?: (k: PersonKey)=>void }) {
  const select = onSelect || onPick!;
  const [pin, setPin] = useState("");
  const [wrong, setWrong] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [popIdx, setPopIdx] = useState<number|null>(null);
  const [checking, setChecking] = useState(false);
  const [remember, setRemember] = useState<boolean>(false);
  const [bioSupported, setBioSupported] = useState(false);
  const [bioEnrolled, setBioEnrolled] = useState<PersonKey[]>([]);
  const [bioLoading, setBioLoading] = useState(false);
  const [bioError, setBioError] = useState("");
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [persons, setPersons] = useState<any[]>(()=> getHouseholdPersonsRaw() || []);

  useEffect(()=>{
    const raw = getHouseholdPersonsRaw();
    if (raw) setPersons(raw);
  }, []);

  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      try{
        const ok = await canDoPlatformBiometric();
        if (cancelled) return;
        setBioSupported(ok);
        const enrolled: PersonKey[] = [];
        try{
          const keys = (persons?.map((p:any)=>p.key) || ["person_1","person_2"]).concat(["aisling","ciaran"]);
          for (const k of keys) {
            if (localStorage.getItem(webAuthnIdKey(k))) enrolled.push(k as PersonKey);
          }
        }catch{}
        // dedupe
        const uniq = Array.from(new Set(enrolled)) as PersonKey[];
        setBioEnrolled(uniq);
      }catch{}
    })();
    return ()=>{ cancelled=true; };
  },[persons]);

  const handleBiometric = async () => {
    if (bioLoading) return;
    setBioLoading(true); setBioError("");
    try{
      const who = await authenticateBiometricDynamic();
      if (who) {
        try{ localStorage.setItem("couple_v1_remember_user","1"); try{ sessionStorage.removeItem("couple_v1_ephemeral_session"); }catch{} }catch{}
        select(who as PersonKey);
      } else setBioError("couldn't verify — try again or use PIN");
    } catch { setBioError("Face ID not available — use PIN"); }
    finally { setBioLoading(false); }
  };

  const tryPin = async (code: string) => {
    if (checking) return;
    setChecking(true);
    setSetupNeeded(false);
    try{
      const who = await verifyPin(code);
      if (who) {
        try{
          localStorage.setItem("couple_v1_remember_user", remember?"1":"0");
          if (!remember) { try{ sessionStorage.setItem("couple_v1_ephemeral_session","1"); }catch{} }
          else { try{ sessionStorage.removeItem("couple_v1_ephemeral_session"); }catch{} }
          try{ localStorage.setItem("couple_v1_force_resync", String(Date.now())); }catch{}
          try{ localStorage.setItem("couple_v1_last_login_pin_at", new Date().toISOString()); }catch{}
          try{ (window as any).__NYLAH_FORCE_RESYNC__ = Date.now(); }catch{}
        }catch{}
        select(who as PersonKey);
      } else {
        try {
          const mod = await import("../../lib/supabase");
          const sb = (mod as any).getSupabase?.();
          if (!sb) setSetupNeeded(true);
        } catch {}
        setWrong(true); setShaking(true);
        try{ (navigator as any).vibrate?.([30,50,30]); }catch{}
        setTimeout(()=> setShaking(false),460);
        setTimeout(()=> setPin(""),380);
      }
    } catch {
      setWrong(true); setShaking(true);
      setTimeout(()=> setShaking(false),460);
    } finally { setChecking(false); }
  };

  useEffect(()=>{ if (pin.length===4) tryPin(pin); }, [pin]);

  const pushDigit = (d:string)=>{ if (pin.length>=4||checking) return; setWrong(false); setPopIdx(pin.length); setPin(p=> (p+d).slice(0,4)); setTimeout(()=> setPopIdx(null),190); };
  const doBackspace = ()=>{ if (pin.length===0) return; setWrong(false); setPin(p=> p.slice(0,-1)); };

  const titleA = persons?.[0]?.name || PERSONS.person_1?.name || PERSONS.aisling?.name || "Partner 1";
  const titleB = persons?.[1]?.name || PERSONS.person_2?.name || PERSONS.ciaran?.name || "Partner 2";

  return (
    <div className="absolute inset-0 z-[80] flex flex-col items-center justify-center px-6 py-8 overflow-auto" style={{background:"linear-gradient(180deg,var(--wash-top), var(--card-bg))", minHeight:"100%"}}>
      <style>{`@keyframes whoShake{0%,100%{transform:translateX(0)}15%,45%,75%{transform:translateX(-7px)}30%,60%,90%{transform:translateX(7px)}}@keyframes whoPop{0%{transform:scale(1)}45%{transform:scale(1.3)}100%{transform:scale(1)}}.who-shake{animation:whoShake 440ms cubic-bezier(.36,.07,.19,.97) both}.who-dot-pop{animation:whoPop 180ms cubic-bezier(0.34,1.56,0.64,1) both}`}</style>
      <div className="w-full max-w-[344px] flex flex-col items-center">
        <div className="flex flex-col items-center mb-7">
          <div className="flex items-center gap-[9px] tracking-tight" style={{fontFamily:'"Fraunces", ui-serif, Georgia, serif', fontSize:'26px', fontWeight:600 as any, letterSpacing:'-0.02em', color:'var(--text)'}}><span>{titleA}</span><span className="inline-flex -mt-[1px]"><svg width="20" height="20" viewBox="0 0 16 16" fill="#E07A5F"><path d="M8 13.2 L3.6 9.3 A2.85 2.85 0 0 1 2.9 7.15 A2.36 2.36 0 0 1 5.08 5.03 A2.20 2.20 0 0 1 8 6.35 A2.20 2.20 0 0 1 10.92 5.03 A2.36 2.36 0 0 1 13.10 7.15 C13.10 7.93 12.84 8.54 12.4 9.28 L8 13.2Z" /></svg></span><span>{titleB}</span></div>
          <div className="mt-1.5 text-[11px] uppercase tracking-wide text-[var(--muted)]">private • just you two</div>
        </div>
        <div className={"w-full rounded-[28px] border px-6 pt-7 pb-6 flex flex-col items-center shadow-[0_18px_48px_rgba(0,0,0,0.10),0_1px_0_rgba(255,255,255,0.6)_inset] "+(shaking?"who-shake ":"")} style={{background:'var(--card-bg)', borderColor: wrong?'#E07A5F':'var(--border)'}}>
          <div className="text-[13px] font-semibold uppercase tracking-wide text-[var(--muted)]">Enter PIN</div>
          <div className="mt-4 flex gap-3">{[0,1,2,3].map(i=>{const filled=i<pin.length; const isPop=popIdx===i&&filled; return <div key={i} className={"grid h-[16px] w-[16px] place-items-center rounded-full border "+(isPop?"who-dot-pop ":"")} style={{borderColor: wrong?'#E07A5F':filled?'var(--text)':'var(--border)', background: filled?(wrong?'#E07A5F':'var(--text)'):'transparent'}}><div className="h-[6px] w-[6px] rounded-full bg-white/90" style={{opacity: filled?(wrong?1:0):0}}/></div>;})}</div>
          <div className="mt-2 min-h-[18px] text-[11px]" style={{color: wrong?'#B91C1C':'transparent'}}>{wrong? (setupNeeded? 'no connection — online needed for PIN check': 'wrong code — try again'):'·'}</div>
          {bioSupported && bioEnrolled.length>0 && (<div className="mt-2 w-full"><button onClick={handleBiometric} disabled={bioLoading} className="w-full h-[56px] rounded-full bg-[#0A0A0A] text-white text-[13.5px] font-semibold flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60">{bioLoading?"Checking…":`Unlock with ${persons?.find((p:any)=>p.key===bioEnrolled[0])?.name || bioEnrolled[0] || 'Face ID'}`}</button>{bioError && <div className="mt-1.5 text-[11px] text-[#B91C1C] text-center">{bioError}</div>}<div className="my-4 h-px w-full bg-[var(--border)] opacity-60"/></div>)}
          <div className="w-full grid grid-cols-3 gap-3 mt-2">
            {[1,2,3,4,5,6,7,8,9].map(n=><button key={n} onClick={()=>pushDigit(String(n))} className="h-[52px] min-h-[52px] rounded-full border bg-[var(--card-bg)] text-[17px] font-[600]" style={{borderColor:'var(--border)', background:'var(--chip-bg)', transition:'transform 160ms cubic-bezier(0.34,1.56,0.64,1)'}}>{n}</button>)}
            <div className="min-h-[64px] grid place-items-start pt-1 justify-items-center">
              <label className="flex flex-col items-center cursor-pointer w-[74px]"><input type="checkbox" checked={remember} onChange={e=> setRemember(e.target.checked)} className="peer sr-only"/><span className="h-[28px] w-[44px] rounded-full bg-[var(--border)] relative flex items-center px-[3px] peer-checked:bg-[#0A0A0A]"><span className="h-[22px] w-[22px] rounded-full bg-white shadow-sm transition-transform translate-x-0 peer-checked:translate-x-[16px] inline-block" style={{display:'inline-block'}}/></span><span className="mt-1.5 text-[10px] font-semibold text-[var(--muted)] text-center leading-[1.15] normal-case">Stay logged in</span></label>
            </div>
            <button onClick={()=>pushDigit("0")} className="h-[52px] rounded-full border" style={{borderColor:'var(--border)', background:'var(--chip-bg)'}}>0</button>
            <button onClick={doBackspace} className="h-[52px] rounded-full border bg-[var(--card-bg)] grid place-items-center" style={{borderColor:'var(--border)'}}>⌫</button>
          </div>
          <div className="mt-5 text-[11px] text-[var(--muted)]/70 text-center">{checking?"checking…":"PIN verified server-side — household only"}</div>
        </div>
      </div>
    </div>
  );
}
export default PinScreen;
