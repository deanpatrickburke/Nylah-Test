import { useEffect, useState } from "react";
import type { PersonKey } from "../../types";
import { PERSONS } from "../../constants/themes";

function webAuthnIdKey(user: PersonKey){ return `couple_v1_webauthn_${user}`; }
function isWebAuthnSupported(): boolean { try{ return !!(window as any).PublicKeyCredential; }catch{return false;} }
async function canDoPlatformBiometric(): Promise<boolean> {
  try{
    const pkc=(window as any).PublicKeyCredential;
    if(!pkc) return false;
    if(pkc.isUserVerifyingPlatformAuthenticatorAvailable) return await pkc.isUserVerifyingPlatformAuthenticatorAvailable();
    return true;
  }catch{return false;}
}
function bufToB64u(buf:ArrayBuffer){ const bytes=new Uint8Array(buf); let bin=""; for(let i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]); return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }

async function registerBiometric(user: PersonKey): Promise<string|null> {
  if(!isWebAuthnSupported()) return null;
  const challenge=crypto.getRandomValues(new Uint8Array(32));
  const userId=crypto.getRandomValues(new Uint8Array(16));
  const rpId=location.hostname;
  try{
    const cred:any=await (navigator.credentials as any).create({ publicKey:{ challenge, rp:{name:"Nylah OS", id:rpId}, user:{id:userId, name:user, displayName:(PERSONS as any)[user]?.name || user}, pubKeyCredParams:[{type:"public-key",alg:-7},{type:"public-key",alg:-257}], authenticatorSelection:{authenticatorAttachment:"platform", requireResidentKey:false, userVerification:"required"}, timeout:60000, attestation:"none" }});
    if(!cred||!cred.rawId) return null;
    const idB64u=bufToB64u(cred.rawId);
    try{ localStorage.setItem(webAuthnIdKey(user), idB64u); localStorage.setItem("couple_v1_biometric_enabled","1"); }catch{}
    return idB64u;
  }catch{ return null; }
}

export function BiometricsSettings({ currentUser }: { currentUser?: PersonKey }){
  const [supported,setSupported]=useState(false);
  const [enabled,setEnabled]=useState(()=>{ try{ return localStorage.getItem("couple_v1_biometric_enabled")==="1"; }catch{return false;} });
  const [remember,setRemember]=useState(()=>{ try{ const v=localStorage.getItem("couple_v1_remember_user"); return v==="1"||v==='"1"'||v==="true"; }catch{return false;} });
  const [enrolled,setEnrolled]=useState<PersonKey[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");

  useEffect(()=>{ (async()=>{ try{ const ok=await canDoPlatformBiometric(); setSupported(ok); const e:PersonKey[]=[]; try{ if(localStorage.getItem(webAuthnIdKey("aisling"))) e.push("aisling"); if(localStorage.getItem(webAuthnIdKey("ciaran"))) e.push("ciaran"); }catch{} setEnrolled(e);}catch{} })(); },[]);

  const toggleBiometric=async()=>{
    if(!supported) { setError("not supported"); return; }
    setLoading(true); setError("");
    try{
      if(enabled){
        try{ localStorage.setItem("couple_v1_biometric_enabled","0"); for(const u of ["aisling","ciaran"] as PersonKey[]) localStorage.removeItem(webAuthnIdKey(u)); }catch{}
        setEnabled(false); setEnrolled([]);
      } else {
        const who=currentUser||"aisling";
        const id=await registerBiometric(who);
        if(id){ setEnabled(true); setEnrolled([who]); } else setError("could not register — try again");
      }
    }catch{ setError("failed"); }
    finally{ setLoading(false); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-[16px] border bg-[var(--card-bg)] px-4 py-3 flex items-center justify-between" style={{borderColor:'var(--border)'}}>
        <div><div className="text-[13px] font-medium">Face ID / Touch ID</div><div className="text-[11px] text-[var(--muted)]">{supported ? (enrolled.length?enrolled.map(u=>PERSONS[u].name).join(", ")+" enrolled":"available"): "not available on this device"}</div>{error && <div className="text-[11px] text-[#B91C1C] mt-1">{error}</div>}</div>
        <label className="relative inline-flex cursor-pointer"><input type="checkbox" checked={enabled} onChange={toggleBiometric} disabled={!supported||loading} className="peer sr-only"/><span className="h-[28px] w-[44px] rounded-full bg-[var(--border)] relative flex items-center px-[3px] peer-checked:bg-[#0A0A0A] transition"><span className="h-[22px] w-[22px] bg-white rounded-full shadow-sm transition-transform translate-x-0 peer-checked:translate-x-[16px] inline-block"/></span></label>
      </div>
      <div className="rounded-[16px] border bg-[var(--card-bg)] px-4 py-3 flex items-center justify-between" style={{borderColor:'var(--border)'}}>
        <div><div className="text-[13px] font-medium">Remember device (Stay logged in)</div><div className="text-[11px] text-[var(--muted)]">Off = ask PIN again after close (ephemeral). On = stay signed in.</div></div>
        <label className="relative inline-flex cursor-pointer"><input type="checkbox" checked={remember} onChange={e=>{ const v=e.target.checked; setRemember(v); try{ localStorage.setItem("couple_v1_remember_user", v?"1":"0"); }catch{} }} className="peer sr-only"/><span className="h-[28px] w-[44px] rounded-full bg-[var(--border)] relative flex items-center px-[3px] peer-checked:bg-[#0A0A0A]"><span className="h-[22px] w-[22px] bg-white rounded-full shadow-sm transition-transform translate-x-0 peer-checked:translate-x-[16px] inline-block"/></span></label>
      </div>
    </div>
  );
}
export default BiometricsSettings;
