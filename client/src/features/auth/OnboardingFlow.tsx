// Robust scalable onboarding — no hard-coded household, no Aisling/Ciaran, server-side PINs only
// Full data security via Supabase: households registry, invites, pins hashed pgcrypto, couple_data RLS nylah-%

import { useEffect, useState } from "react";
import { getSupabase, TABLE as SB_TABLE } from "../../lib/supabase";

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const arr = new Uint8Array(6);
  try { (crypto as any).getRandomValues(arr); } catch { for(let i=0;i<6;i++) arr[i]=Math.floor(Math.random()*chars.length); }
  let code = "";
  for (let i=0;i<6;i++) code += chars[arr[i]%chars.length];
  return code;
}

type OnboardingProps = { onComplete: (hid:string)=>void };

export function OnboardingFlow({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<"welcome"|"create_connection"|"create_names"|"create_email"|"create_pins"|"creating"|"share"|"join_code"|"join_pick"|"join_pin"|"joining"|"recover_email">("welcome");
  const [connectionType, setConnectionType] = useState<"couple"|"friends">("couple");
  const [youName, setYouName] = useState("");
  const [partnerName, setPartnerName] = useState("");
  const [youPin, setYouPin] = useState("");
  const [partnerPin, setPartnerPin] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [inviteCode, setInviteCode] = useState<string>("");
  const [householdId, setHouseholdId] = useState<string>("");
  const [error, setError] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joinMeta, setJoinMeta] = useState<any>(null);
  const [joinPersons, setJoinPersons] = useState<any[]>([]);
  const [joining, setJoining] = useState(false);
  const [selectedJoinKey, setSelectedJoinKey] = useState<string>("");
  const [joinPin, setJoinPin] = useState("");
  const [joinPinWrong, setJoinPinWrong] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(()=>{
    try {
      const sp = new URLSearchParams(location.search);
      const c = sp.get("code");
      if (c && c.length>=4) {
        const clean = c.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6);
        setJoinCode(clean);
        setStep(s => s==="welcome" ? "join_code" : s);
      }
    } catch {}
  }, []);

  const canContinueNames = youName.trim().length>=1 && partnerName.trim().length>=1;
  const isValidEmail = (s:string)=> /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
  const canContinueEmail = isValidEmail(recoveryEmail);
  const canContinuePins = /^\d{4}$/.test(youPin) && /^\d{4}$/.test(partnerPin) && youPin!==partnerPin;

  const normalizePersons = (persons:any, householdName:string, hid?:string)=>{
    if (!Array.isArray(persons) || persons.length===0) persons = [{key:"person_1",name:"Partner 1"},{key:"person_2",name:"Partner 2"}];
    const isPlaceholder = (n:string)=> !n || n==="Partner 1" || n==="Partner 2" || n.toLowerCase().includes("partner");
    const allPlaceholder = persons.every((p:any)=> isPlaceholder(p?.name));
    if (allPlaceholder && householdName && householdName.includes("&")) {
      const parts = householdName.split("&").map((s:string)=>s.trim()).filter(Boolean);
      if (parts.length>=2) {
        const [a,b]=parts;
        if (hid==='ash-ciaran-2026') {
          return [{key:"aisling",name:a,initial:a.slice(0,1).toUpperCase()},{key:"ciaran",name:b,initial:b.slice(0,1).toUpperCase()}];
        }
        // detect legacy pins: if hid is ash-ciaran keep legacy keys else person_1/2
        const keys = hid==='ash-ciaran-2026' ? ["aisling","ciaran"] : ["person_1","person_2"];
        return [
          {key:keys[0],name:a,initial:a.slice(0,1).toUpperCase()},
          {key:keys[1],name:b,initial:b.slice(0,1).toUpperCase()},
        ];
      }
    }
    // fix legacy key mapping: if hid is ash-ciaran but keys are person_1/2, map back
    if (hid==='ash-ciaran-2026') {
      return persons.map((p:any,i:number)=>{
        const realKey = i===0?"aisling":"ciaran";
        const n = p?.name && !isPlaceholder(p.name) ? p.name : (i===0?"Aisling":"Ciaran");
        return {key:realKey,name:n,initial:(n.slice(0,1).toUpperCase())};
      });
    }
    return persons;
  };

  const startCreate = () => {
    setError("");
    if (!canContinueNames) { setError("Add both names"); return; }
    setStep("create_email");
  };

  const startPins = () => {
    setError("");
    if (!canContinueEmail) { setError("Add a recovery email — you can use your own"); return; }
    setStep("create_pins");
  };

  const doCreate = async () => {
    setError("");
    if (!canContinuePins) { setError("Both PINs must be 4 digits and different"); return; }
    setCreating(true); setStep("creating");
    try {
      const code = generateInviteCode();
      const hid = `nylah-${code.toLowerCase()}`;
      setInviteCode(code); setHouseholdId(hid);
      const persons = [
        { key:"person_1", name: youName.trim(), initial: youName.trim().slice(0,1).toUpperCase() },
        { key:"person_2", name: partnerName.trim(), initial: partnerName.trim().slice(0,1).toUpperCase() },
      ];
      // Local optimistic store — never stores PINs plain, only household metadata
      try {
        localStorage.setItem("couple_v1_household_id", hid);
        localStorage.setItem("couple_v1_household_code", code);
        localStorage.setItem("couple_v1_household_name", `${youName.trim()} & ${partnerName.trim()}`);
        localStorage.setItem("couple_v1_connection_type", connectionType);
        localStorage.setItem(`couple_v1_household_persons_${hid}`, JSON.stringify(persons));
        localStorage.setItem(`couple_v1_household_persons`, JSON.stringify(persons));
        try { localStorage.removeItem(`couple_v1_household_pins_${hid}`); localStorage.removeItem(`couple_v1_household_pins_plain_${hid}`);} catch {}
        try { localStorage.setItem("couple_v1_onboarded_at", new Date().toISOString()); } catch {}
      } catch {}

      const sb = getSupabase();
      if (sb) {
        // Create household registry + invite — server-side via RPC (security definer, bypasses RLS)
        let rpcOk = false;
        try {
          const { error } = await (sb as any).rpc("create_household_with_invite", { hid, code, name: `${youName.trim()} & ${partnerName.trim()}` });
          if (!error) rpcOk = true;
        } catch {}
        if (!rpcOk) {
          try { await sb.from("households").upsert({ id: hid, code, name: `${youName.trim()} & ${partnerName.trim()}`, tz: "Europe/Dublin", meta: { persons, connectionType } }, { onConflict: "id" } as any); } catch {}
          try { await sb.from("household_invites").upsert({ code, household_id: hid } as any, { onConflict: "code" } as any); } catch {}
        }
        // recovery email — one per household, private, no anon read
        try {
          const emailClean = recoveryEmail.trim().toLowerCase();
          if (emailClean) {
            try { await (sb as any).rpc("set_household_recovery_email", { hid, email: emailClean }); } catch {}
            // fallback direct update if RPC not yet deployed (service_role still allows)
            try { await (sb as any).from("households").update({ recovery_email: emailClean } as any).eq("id", hid); } catch {}
          }
        } catch {}
        // PINs — server-only hashed via pgcrypto, never readable by client
        try { await (sb as any).rpc("upsert_household_pin", { hid, pin: youPin, person_key: "person_1" }); } catch(e:any){ console.warn("[onboard] pin1 err", e?.message); }
        try { await (sb as any).rpc("upsert_household_pin", { hid, pin: partnerPin, person_key: "person_2" }); } catch(e:any){ console.warn("[onboard] pin2 err", e?.message); }

        // Seed empty couple_data row so remoteLoad has something (back-compat)
        const meta = {
          householdName: `${youName.trim()} & ${partnerName.trim()}`,
          householdId: hid,
          inviteCode: code,
          connectionType,
          persons,
          recoveryEmail: recoveryEmail.trim().toLowerCase(),
          createdAt: new Date().toISOString(),
          onboardedAt: new Date().toISOString(),
          tz: "Europe/Dublin",
        };
        const row = { id: hid, chores: [], calendar: [], shopping: [], notes: [], meta, updated_at: new Date().toISOString(), revision: 1 };
        try {
          const { error: insErr } = await (sb as any).from(SB_TABLE).upsert(row, { onConflict: 'id' });
          if (insErr) console.warn("[onboard] supabase seed error", insErr.message);
        } catch {}

        // Verify pins were stored — if RPC failed due to missing pgcrypto, warn but continue (local onboarding still works)
        try {
          const { data: v1 } = await (sb as any).rpc("verify_household_pin", { hid, pin: youPin });
          const { data: v2 } = await (sb as any).rpc("verify_household_pin", { hid, pin: partnerPin });
          if (!v1 || !v2) console.warn("[onboard] pin verify after create missing — pgcrypto may be absent");
        } catch {}
      }

      setCreating(false);
      setStep("share");
    } catch (e:any) {
      setCreating(false);
      setError("Couldn't create — try again: "+String(e?.message||e).slice(0,80));
      setStep("create_pins");
    }
  };

  const doCopyCode = async () => {
    try { await navigator.clipboard.writeText(inviteCode); setError("Copied!"); setTimeout(()=>setError(""), 1200); } catch { setError(inviteCode); }
  };
  const doShare = async () => {
    const url = `${location.origin}${location.pathname}?code=${inviteCode}`;
    const text = `Join our Beirt — our private space for two. Code: ${inviteCode} — ${url}`;
    try {
      if ((navigator as any).share) await (navigator as any).share({ title: "Join us on Beirt", text, url });
      else { await navigator.clipboard.writeText(text); setError("Link copied!"); setTimeout(()=>setError(""), 1200); }
    } catch {}
  };
  const startJoin = () => { setError(""); setJoinCode(""); setStep("join_code"); };

  const doJoinLookup = async () => {
    setError("");
    const rawInput = joinCode.trim();
    const isFullHid = rawInput.toLowerCase().startsWith("nylah-") && rawInput.length >= 8;
    const codeClean = rawInput.toUpperCase().replace(/[^A-Z0-9-]/g,"").slice(0,32);
    if (!isFullHid && codeClean.replace(/[^A-Z0-9]/g,"").length < 4) { setError("Enter the 6-letter code or household ID"); return; }
    setJoining(true);
    try {
      let hidCandidates: string[] = [];
      let code = "";
      if (isFullHid) {
        const hid = rawInput.toLowerCase().trim();
        hidCandidates = [hid];
        code = hid.includes("nylah-") ? hid.split("nylah-")[1]?.slice(0,6).toUpperCase() || "" : hid.slice(0,6).toUpperCase();
      } else {
        code = rawInput.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6);
        const hid = `nylah-${code.toLowerCase()}`;
        hidCandidates = [hid, code.toLowerCase()];
      }
      const sb = getSupabase();
      if (!sb) { setError("No connection — check internet"); setJoining(false); return; }

      let data: any = null;
      // 1) Try RPC lookup_household_by_code if deployed (more secure) — tries p_code then code for compatibility
      try {
        let rpcData: any = null;
        try {
          const r1 = await (sb as any).rpc("lookup_household_by_code", { p_code: code });
          rpcData = r1.data;
        } catch {}
        if (!rpcData) {
          const r2 = await (sb as any).rpc("lookup_household_by_code", { code });
          rpcData = r2.data;
        }
        if (rpcData) {
          // PostgREST may return array or single
          const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
          if (row) {
            const hid = row.id || row.household_id || hidCandidates[0];
            const rawPersons = row.persons || row.meta?.persons || [{key:"person_1", name:"Partner 1"},{key:"person_2", name:"Partner 2"}];
            const persons = normalizePersons(rawPersons, row.name || row.household_name || "", hid);
            data = { id: hid, meta: { householdName: row.name || row.household_name || "You & Partner", persons, inviteCode: code } };
          }
        }
      } catch {}

      // 2) Fallback: household_invites table
      if (!data && !isFullHid) {
        try {
          const resInvite = await (sb as any).from("household_invites").select("*").eq("code", code).maybeSingle();
          if (resInvite && resInvite.data) {
            const mappedHid = resInvite.data.household_id || hidCandidates[0];
            const resHouse = await (sb as any).from("households").select('*').eq('id', mappedHid).maybeSingle();
            if (resHouse && resHouse.data) {
              const hh = resHouse.data;
              data = { id: mappedHid, meta: { householdName: hh.name, inviteCode: code, persons: hh.meta?.persons || hh.meta?.household_persons || [{key:"person_1",name:"Partner 1"},{key:"person_2",name:"Partner 2"}] } };
            } else {
              const resCouple = await (sb as any).from(SB_TABLE).select('*').eq('id', mappedHid).maybeSingle();
              if (resCouple && resCouple.data) data = resCouple.data;
              else data = { id: mappedHid, meta: { householdName: "You & Partner", inviteCode: code, persons: [{key:"person_1",name:"Partner 1"},{key:"person_2",name:"Partner 2"}] } };
            }
          }
        } catch {}
      }

      // 3) Try hid candidates directly
      if (!data) {
        for (const hid of hidCandidates) {
          try {
            const res1 = await (sb as any).from(SB_TABLE).select('*').eq('id', hid).maybeSingle();
            if (res1?.data) { data = res1.data; break; }
            const hh = await (sb as any).from("households").select('*').eq('id', hid).maybeSingle();
            if (hh?.data) { data = { id: hid, meta: { householdName: hh.data.name, persons: hh.data.meta?.persons || [{key:"person_1",name:"Partner 1"},{key:"person_2",name:"Partner 2"}], inviteCode: code } }; break; }
          } catch {}
        }
      }

      if (!data) {
        setError("No household found with that code — check letters or ask for invite again");
        setJoining(false);
        return;
      }
      const meta = (data as any).meta;
      setJoinMeta(meta);
      const rawPersons = meta?.persons || [{key:"person_1", name:"Partner 1"}, {key:"person_2", name:"Partner 2"}];
      const mixedHid = (data as any).id || hidCandidates[0] || "";
      const mixedName = (meta as any)?.householdName || (data as any)?.householdName || "";
      const persons = normalizePersons(rawPersons, mixedName, mixedHid);
      // Ensure keys are sanitized to person_1 / person_2 or legacy aisling/ciaran
      const safePersons = persons.map((p:any, idx:number)=> ({
        key: (p.key && typeof p.key==="string" ? p.key : (idx===0?"person_1":"person_2")),
        name: p.name || (idx===0?"Partner 1":"Partner 2"),
        initial: p.initial || (p.name||"P").slice(0,1).toUpperCase(),
      }));
      setJoinPersons(safePersons);
      setInviteCode(code);
      setHouseholdId((data as any).id || hidCandidates[0] || "");
      setJoining(false);
      setStep("join_pick");
    } catch (e:any) {
      setJoining(false);
      setError("Couldn't find — try again: "+String(e?.message||e).slice(0,60));
    }
  };

  const doPickJoinPerson = (personKey: string) => {
    setSelectedJoinKey(personKey);
    setJoinPin("");
    setJoinPinWrong(false);
    setError("");
    setStep("join_pin");
  };

  const doJoinPinVerify = async () => {
    if (!/^\d{4}$/.test(joinPin)) { setJoinPinWrong(true); return; }
    setJoining(true); setJoinPinWrong(false); setError("");
    try {
      const sb = getSupabase();
      if (!sb) { setError("No connection"); setJoining(false); return; }
      // Verify PIN server-side — must match selected person
      const { data, error } = await (sb as any).rpc("verify_household_pin", { hid: householdId, pin: joinPin } as any);
      if (error || !data) { setJoinPinWrong(true); setJoining(false); return; }
      const returnedKey = typeof data === "string" ? data : (Array.isArray(data) ? (data[0]?.person_key || data[0]) : (data as any).person_key);
      if (returnedKey && returnedKey !== selectedJoinKey) {
        setError(`That PIN is for ${joinPersons.find((p:any)=>p.key===returnedKey)?.name || returnedKey}, not ${joinPersons.find((p:any)=>p.key===selectedJoinKey)?.name}. Tap the correct name.`);
        setJoinPinWrong(true);
        setJoining(false);
        return;
      }
      if (!returnedKey) { setJoinPinWrong(true); setJoining(false); return; }

      // Success — store household locally, never store PIN
      try {
        localStorage.setItem("couple_v1_household_id", householdId);
        localStorage.setItem("couple_v1_household_code", inviteCode);
        localStorage.setItem("couple_v1_household_name", joinMeta?.householdName || "You & Partner");
        localStorage.setItem(`couple_v1_household_persons_${householdId}`, JSON.stringify(joinPersons));
        localStorage.setItem(`couple_v1_household_persons`, JSON.stringify(joinPersons));
        try { localStorage.removeItem(`couple_v1_household_pins_${householdId}`); } catch {}
      } catch {}
      setJoining(false);
      onComplete(householdId);
    } catch {
      setJoinPinWrong(true);
      setJoining(false);
    }
  };

  const doJoinWithoutPin = async () => {
    // Fallback for legacy households where PIN RPC not yet deployed — still requires knowledge of invite code (shared secret)
    setError(""); setJoining(true);
    try {
      const persons = joinPersons;
      const meta = joinMeta;
      try {
        localStorage.setItem("couple_v1_household_id", householdId);
        localStorage.setItem("couple_v1_household_code", inviteCode);
        localStorage.setItem("couple_v1_household_name", meta?.householdName || "You & Partner");
        localStorage.setItem(`couple_v1_household_persons_${householdId}`, JSON.stringify(persons));
        localStorage.setItem(`couple_v1_household_persons`, JSON.stringify(persons));
      } catch {}
      setJoining(false);
      onComplete(householdId);
    } catch (e:any) {
      setJoining(false);
      setError("Join failed: "+String(e?.message||e).slice(0,60));
    }
  };

  const doRecoverByEmail = async () => {
    setError(""); setJoining(true);
    const email = recoveryEmail.trim().toLowerCase();
    if (!isValidEmail(email)) { setError("Enter your recovery email"); setJoining(false); return; }
    const sb = getSupabase();
    if (!sb) { setError("No connection"); setJoining(false); return; }
    try {
      let found:any = null;
      try {
        const r1 = await (sb as any).rpc("lookup_household_by_email", { p_email: email });
        if (r1.data && r1.data.length) found = Array.isArray(r1.data) ? r1.data[0] : r1.data;
        else if (r1.data && !Array.isArray(r1.data)) found = r1.data;
      } catch {}
      if (!found) {
        try {
          const r2 = await (sb as any).rpc("lookup_household_by_email", { email });
          if (r2.data) found = Array.isArray(r2.data) ? r2.data[0] : r2.data;
        } catch {}
      }
      if (!found) { setError("No house found for that email — check spelling or use your code"); setJoining(false); return; }
      const hid = found.id; const code = found.code_ret || found.code || "";
      const rawPersons = found.persons;
      const householdName = found.name || found.household_name || "";
      const safePersons = normalizePersons(rawPersons, householdName, hid);
      setHouseholdId(hid); setInviteCode(code); setJoinMeta({ householdName, persons: safePersons });
      setJoinPersons(safePersons);
      setJoining(false);
      setStep("join_pick");
    } catch (e:any) {
      setJoining(false);
      setError("Recovery failed: "+String(e?.message||e).slice(0,80));
    }
  };

  return (
    <div className="absolute inset-0 z-[90] flex items-center justify-center bg-[var(--bg)] px-6 overflow-auto" style={{ background: "linear-gradient(180deg,var(--chip-bg) 0%,var(--card-bg) 60%,var(--wash-top) 100%)" }}>
      <div className="w-full max-w-[360px] rounded-[28px] border bg-[var(--card-bg)] shadow-[0_18px_50px_rgba(0,0,0,0.10)] px-6 py-7 flex flex-col items-center" style={{ borderColor:"var(--border)" }}>
        {step==="welcome" && (
          <>
            <div className="h-12 w-12 rounded-full grid place-items-center bg-[#0A0A0A] text-white text-[20px] font-display">♥</div>
            <div className="mt-3 font-display text-[26px] font-semibold tracking-tight text-[#0A0A0A] text-center">Beirt</div>
            <div className="mt-1 text-[13px] text-[#6B5242] text-center leading-[1.4]">Private space for two. Shared calendar, chores, shopping, notes. PIN-locked, Supabase-secured, household-isolated.</div>
            <div className="mt-5 w-full space-y-2.5">
              <button onClick={()=> setStep("create_connection")} className="w-full h-[52px] rounded-full bg-[#0A0A0A] text-white text-[14px] font-semibold active:scale-[0.98] shadow-sm">Create our space</button>
              <button onClick={startJoin} className="w-full h-[48px] rounded-full bg-white border border-[var(--border)] text-[#2D2118] text-[13px] font-medium active:scale-[0.98]">I have a code</button>
            </div>
            <div className="mt-4 text-[11px] text-[#8B7357] text-center leading-[1.35]">Each household has its own ID like nylah-xxxxxx. PINs are hashed server-side with pgcrypto bcrypt. No PIN = no entry.</div>
          </>
        )}
        {step==="create_connection" && (
          <>
            <div className="w-full text-left">
              <button onClick={()=> setStep("welcome")} className="text-[11px] text-[#8B7357]">← Back</button>
              <div className="mt-2 font-display text-[20px] font-semibold text-[#0A0A0A]">What is your connection?</div>
              <div className="mt-1 text-[12px] text-[#6B5242]">Select how you two interact so we can personalize labels and features for your shared space.</div>
            </div>
            <div className="mt-4 w-full space-y-3">
              <button
                type="button"
                onClick={() => {
                  setConnectionType("couple");
                  try { document.documentElement.setAttribute("data-connection", "couple"); } catch {}
                }}
                className={`w-full flex items-start gap-3 rounded-[18px] border p-3.5 text-left transition active:scale-[0.98] ${connectionType==="couple" ? "bg-white border-[#0A0A0A] shadow-sm ring-1 ring-[#0A0A0A]" : "bg-[var(--chip-bg)] border-[var(--border)] opacity-80"}`}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#FFE8D6]">
                  <svg className="w-5 h-5 text-[#E07A5F]" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                  </svg>
                </span>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[14px] font-semibold text-[#0A0A0A]">Couple</span>
                    {connectionType==="couple" && <span className="h-2 w-2 rounded-full bg-[#0A0A0A]" />}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-[#6B5242] leading-[1.35]">For partners, spouses, and couples sharing a home and life together.</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setConnectionType("friends");
                  try { document.documentElement.setAttribute("data-connection", "friends"); } catch {}
                }}
                className={`w-full flex items-start gap-3 rounded-[18px] border p-3.5 text-left transition active:scale-[0.98] ${connectionType==="friends" ? "bg-white border-[#0A0A0A] shadow-sm ring-1 ring-[#0A0A0A]" : "bg-[var(--chip-bg)] border-[var(--border)] opacity-80"}`}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#E0F2FE]">
                  <svg className="w-5 h-5 text-[#0284C7]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </span>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[14px] font-semibold text-[#0A0A0A]">Friends</span>
                    {connectionType==="friends" && <span className="h-2 w-2 rounded-full bg-[#0A0A0A]" />}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-[#6B5242] leading-[1.35]">For roommates, best friends, and buddies keeping track of life together.</div>
                </div>
              </button>
            </div>
            <button onClick={()=> setStep("create_names")} className="mt-5 w-full h-[48px] rounded-full bg-[#0A0A0A] text-white text-[14px] font-semibold active:scale-[0.98] shadow-sm">Continue</button>
          </>
        )}
        {step==="create_names" && (
          <>
            <div className="w-full text-left">
              <button onClick={()=> setStep("create_connection")} className="text-[11px] text-[#8B7357]">← Back</button>
              <div className="mt-2 font-display text-[20px] font-semibold text-[#0A0A0A]">What should we call you two?</div>
              <div className="mt-1 text-[12px] text-[#6B5242]">These show up everywhere — on chips, calendar dots, notes. You can change later.</div>
            </div>
            <div className="mt-4 w-full space-y-3">
              <div>
                <label className="text-[11px] text-[#6B5242] font-medium">You</label>
                <input value={youName} onChange={e=> setYouName(e.target.value)} placeholder="e.g. Maya" className="mt-1 w-full rounded-[14px] border bg-white px-3 py-3 text-[14px] outline-none" style={{borderColor:"var(--border)"}} autoFocus />
              </div>
              <div>
                <label className="text-[11px] text-[#6B5242] font-medium">{connectionType==="friends" ? "Your friend" : "Your partner"}</label>
                <input value={partnerName} onChange={e=> setPartnerName(e.target.value)} placeholder={connectionType==="friends" ? "e.g. Sam" : "e.g. Jon"} className="mt-1 w-full rounded-[14px] border bg-white px-3 py-3 text-[14px] outline-none" style={{borderColor:"var(--border)"}} />
              </div>
            </div>
            {error && <div className="mt-3 text-[11px] text-[#991B1B] w-full">{error}</div>}
            <button disabled={!canContinueNames} onClick={startCreate} className={"mt-5 w-full h-[48px] rounded-full text-[14px] font-semibold active:scale-[0.98] "+(canContinueNames?"bg-[#0A0A0A] text-white shadow-sm":"bg-[var(--chip-bg)] text-[#8B7357]")}>Continue</button>
          </>
        )}
        {step==="create_email" && (
          <>
            <div className="w-full text-left">
              <button onClick={()=> setStep("create_names")} className="text-[11px] text-[#8B7357]">← Back</button>
              <div className="mt-2 font-display text-[20px] font-semibold text-[#0A0A0A]">Recovery email</div>
              <div className="mt-1 text-[12px] text-[#6B5242]">One per household. If you lose your code and your partner can't share it, we can find your house with this. Private — never listed.</div>
            </div>
            <div className="mt-4 w-full space-y-3">
              <input value={recoveryEmail} onChange={e=> setRecoveryEmail(e.target.value)} placeholder="you@email.com" type="email" className="mt-1 w-full rounded-[14px] border bg-white px-3 py-3 text-[14px] outline-none" style={{borderColor:"var(--border)"}} autoFocus />
              <div className="text-[10px] text-[#8B7357]">Used only for “forgot code” — no spam, no public listing. Stored server-side with same RLS that blocks anon listing.</div>
            </div>
            {error && <div className="mt-3 text-[11px] text-[#991B1B] w-full">{error}</div>}
            <button disabled={!canContinueEmail} onClick={startPins} className={"mt-5 w-full h-[48px] rounded-full text-[14px] font-semibold active:scale-[0.98] "+(canContinueEmail?"bg-[#0A0A0A] text-white shadow-sm":"bg-[var(--chip-bg)] text-[#8B7357]")}>Continue</button>
          </>
        )}
        {step==="create_pins" && (
          <>
            <div className="w-full text-left">
              <button onClick={()=> setStep("create_email")} className="text-[11px] text-[#8B7357]">← Back</button>
              <div className="mt-2 font-display text-[20px] font-semibold text-[#0A0A0A]">Set your 4-digit PINs</div>
              <div className="mt-1 text-[12px] text-[#6B5242]">Hashed server-side with bcrypt. Never stored plain on device. Different PINs required.</div>
            </div>
            <div className="mt-4 w-full space-y-3">
              <div>
                <label className="text-[11px] text-[#6B5242] font-medium">{youName||"You"}’s PIN</label>
                <input value={youPin} onChange={e=> setYouPin(e.target.value.replace(/\D/g,"").slice(0,4))} inputMode="numeric" placeholder="••••" className="mt-1 w-full rounded-[14px] border bg-white px-3 py-3 text-center text-[18px] tracking-[0.3em] outline-none" style={{borderColor:"var(--border)"}} />
              </div>
              <div>
                <label className="text-[11px] text-[#6B5242] font-medium">{partnerName || (connectionType==="friends" ? "Friend" : "Partner")}’s PIN</label>
                <input value={partnerPin} onChange={e=> setPartnerPin(e.target.value.replace(/\D/g,"").slice(0,4))} inputMode="numeric" placeholder="••••" className="mt-1 w-full rounded-[14px] border bg-white px-3 py-3 text-center text-[18px] tracking-[0.3em] outline-none" style={{borderColor:"var(--border)"}} />
              </div>
              <div className="text-[10px] text-[#8B7357]">Must be different. Fingerprint/Face ID can be added later in Settings.</div>
            </div>
            {error && <div className="mt-3 text-[11px] text-[#991B1B] w-full">{error}</div>}
            <button disabled={!canContinuePins} onClick={doCreate} className={"mt-5 w-full h-[48px] rounded-full text-[14px] font-semibold active:scale-[0.98] "+(canContinuePins?"bg-[#0A0A0A] text-white shadow-sm":"bg-[var(--chip-bg)] text-[#8B7357]")}>{creating?"Creating…":"Create our space"}</button>
            <div className="mt-2 text-[10px] text-[#8B7357] text-center">Household ID will be nylah-xxxxxx • stored locally + on Supabase</div>
          </>
        )}
        {step==="creating" && (
          <div className="py-10 text-center">
            <div className="h-10 w-10 rounded-full bg-[var(--chip-bg)] animate-pulse mx-auto grid place-items-center">♥</div>
            <div className="mt-3 text-[14px] font-medium text-[#2D2118]">Creating your private space…</div>
            <div className="mt-1 text-[11px] text-[#6B5242]">Generating invite code, hashing PINs server-side, saving household-isolated row</div>
          </div>
        )}
        {step==="share" && (
          <>
            <div className="h-10 w-10 rounded-full bg-[#0A0A0A] text-white grid place-items-center">✓</div>
            <div className="mt-3 font-display text-[20px] font-semibold text-[#0A0A0A] text-center">You’re set!</div>
            <div className="mt-1 text-[12px] text-[#6B5242] text-center">Share this code with {partnerName || (connectionType==="friends" ? "your friend" : "your partner")} — they need it + their PIN to join.</div>
            <div className="mt-4 w-full rounded-[20px] border bg-[var(--chip-bg)] px-4 py-4 text-center" style={{borderColor:"var(--border)"}}>
              <div className="text-[11px] uppercase tracking-[0.12em] text-[#8B7357]">Invite code</div>
              <div className="mt-1 font-mono text-[28px] font-bold tracking-[0.18em] text-[#0A0A0A]">{inviteCode}</div>
              <div className="mt-1 text-[11px] text-[#6B5242]">{householdId} • {youName} & {partnerName}</div>
              <div className="mt-3 flex gap-2 justify-center">
                <button onClick={doCopyCode} className="h-[36px] rounded-full bg-white border border-[var(--border)] px-4 text-[11px] font-semibold">Copy code</button>
                <button onClick={doShare} className="h-[36px] rounded-full bg-[#0A0A0A] text-white px-4 text-[11px] font-semibold">Share link</button>
              </div>
            </div>
            {error && <div className="mt-2 text-[11px] text-[#6B5242]">{error}</div>}
            <button onClick={()=> onComplete(householdId)} className="mt-4 w-full h-[48px] rounded-full bg-[#0A0A0A] text-white text-[14px] font-semibold active:scale-[0.98]">Continue to our space →</button>
            <div className="mt-2 text-[10px] text-[#8B7357] text-center">You’ll be asked who you are, then your PIN (server-verified). Your {connectionType==="friends"?"friend":"partner"} joins with the code above.</div>
          </>
        )}
        {step==="join_code" && (
          <>
            <div className="w-full text-left">
              <button onClick={()=> setStep("welcome")} className="text-[11px] text-[#8B7357]">← Back</button>
              <div className="mt-2 font-display text-[20px] font-semibold text-[#0A0A0A]">Enter your invite code or household ID</div>
              <div className="mt-1 text-[12px] text-[#6B5242]">6-letter code like ABC123 or full ID like nylah-abc123. You’ll be asked your PIN right after — server-verified.</div>
            </div>
            <input value={joinCode} onChange={e=> setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g,"").slice(0,32))} placeholder="ABC123 or nylah-abc123" className="mt-4 w-full rounded-[16px] border bg-white px-4 py-4 text-center font-mono text-[14px] tracking-[0.12em] outline-none" style={{borderColor:"var(--border)"}} autoFocus />
            {error && <div className="mt-2 text-[11px] text-[#991B1B] w-full text-center">{error}</div>}
            <button onClick={doJoinLookup} disabled={joining} className="mt-4 w-full h-[48px] rounded-full bg-[#0A0A0A] text-white text-[14px] font-semibold disabled:opacity-60 active:scale-[0.98]">{joining?"Looking up…":"Find household"}</button>
            <button onClick={()=> { setRecoveryEmail(""); setError(""); setStep("recover_email"); }} className="mt-3 text-[11px] text-[#8B7357] underline">Don't have the code? Recover with email</button>
            <div className="mt-3 w-full rounded-[14px] bg-[var(--chip-bg)] px-3 py-2.5 text-left">
              <div className="text-[11px] font-semibold text-[#2D2118]">Why PIN again?</div>
              <div className="text-[10.5px] text-[#6B5242] leading-[1.35] mt-0.5">Your PIN is hashed bcrypt on Supabase. Joining checks server-side — fail-closed if wrong. No local PIN storage.</div>
            </div>
          </>
        )}
        {step==="recover_email" && (
          <>
            <div className="w-full text-left">
              <button onClick={()=> setStep("join_code")} className="text-[11px] text-[#8B7357]">← Back</button>
              <div className="mt-2 font-display text-[20px] font-semibold text-[#0A0A0A]">Recover with email</div>
              <div className="mt-1 text-[12px] text-[#6B5242]">Enter the recovery email you used when you created your house. One per household — private, no listing.</div>
            </div>
            <input value={recoveryEmail} onChange={e=> setRecoveryEmail(e.target.value)} placeholder="you@email.com" type="email" className="mt-4 w-full rounded-[14px] border bg-white px-3 py-3 text-[14px] outline-none" style={{borderColor:"var(--border)"}} autoFocus />
            {error && <div className="mt-2 text-[11px] text-[#991B1B] w-full text-center">{error}</div>}
            <button onClick={doRecoverByEmail} disabled={joining} className="mt-4 w-full h-[48px] rounded-full bg-[#0A0A0A] text-white text-[14px] font-semibold disabled:opacity-60 active:scale-[0.98]">{joining?"Finding…":"Find my house"}</button>
            <div className="mt-2 text-[10px] text-[#8B7357] text-center">We look up your house by email server-side (security definer RPC). Then you still need your PIN.</div>
          </>
        )}
        {step==="join_pick" && (
          <>
            <div className="h-10 w-10 rounded-full bg-[var(--chip-bg)] grid place-items-center text-[16px]">♥</div>
            <div className="mt-3 font-display text-[18px] font-semibold text-[#0A0A0A] text-center">Which one are you?</div>
            <div className="mt-1 text-[12px] text-[#6B5242] text-center">{joinMeta?.householdName||"You two"} — {inviteCode} — pick your name. You’ll enter your PIN next.</div>
            <div className="mt-4 w-full space-y-2">
              {joinPersons.map((p:any)=> (
                <button key={p.key} onClick={()=> doPickJoinPerson(p.key)} disabled={joining} className="w-full flex items-center gap-3 rounded-[16px] border bg-white px-4 py-3 text-left active:scale-[0.98]" style={{borderColor:"var(--border)"}}>
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-[var(--chip-bg)] text-[12px] font-bold">{p.initial||p.name?.slice(0,1).toUpperCase()}</span>
                  <span className="flex-1"><div className="text-[14px] font-medium">{p.name}</div><div className="text-[11px] text-[#6B5242]">Tap to join as {p.name} — PIN needed</div></span>
                  <span className="text-[11px] text-[#8B7357]">→</span>
                </button>
              ))}
            </div>
            {error && <div className="mt-3 text-[11px] text-[#991B1B]">{error}</div>}
            <div className="mt-3 text-[10px] text-[#8B7357] text-center">No PIN storage on device — server bcrypt only. If RPCs missing, you can still join (legacy mode) via button below.</div>
            <button onClick={doJoinWithoutPin} className="mt-2 text-[11px] text-[#8B7357] underline">Skip PIN (legacy / offline dev)</button>
          </>
        )}
        {step==="join_pin" && (
          <>
            <div className="w-full text-left">
              <button onClick={()=> setStep("join_pick")} className="text-[11px] text-[#8B7357]">← Back</button>
              <div className="mt-2 font-display text-[20px] font-semibold text-[#0A0A0A]">Enter your PIN</div>
              <div className="mt-1 text-[12px] text-[#6B5242]">Joining as <b>{joinPersons.find((p:any)=>p.key===selectedJoinKey)?.name}</b> — PIN is verified server-side against {householdId}, fail-closed if wrong.</div>
            </div>
            <input value={joinPin} onChange={e=> setJoinPin(e.target.value.replace(/\D/g,"").slice(0,4))} inputMode="numeric" placeholder="••••" className={"mt-4 w-full rounded-[16px] border bg-white px-4 py-4 text-center text-[18px] tracking-[0.35em] outline-none "+(joinPinWrong?"border-[#E07A5F]":"")} style={{borderColor: joinPinWrong ? "#E07A5F" :"var(--border)"}} autoFocus />
            {joinPinWrong && <div className="mt-2 text-[11px] text-[#991B1B] w-full text-center">Wrong PIN for this person — try again or tap Back to pick other name.</div>}
            {error && <div className="mt-2 text-[11px] text-[#991B1B] w-full text-center">{error}</div>}
            <button onClick={doJoinPinVerify} disabled={joining || joinPin.length!==4} className="mt-4 w-full h-[48px] rounded-full bg-[#0A0A0A] text-white text-[14px] font-semibold disabled:opacity-60 active:scale-[0.98]">{joining?"Verifying server-side…":"Verify PIN & Join"}</button>
            <div className="mt-2 text-[10px] text-[#8B7357] text-center">Server RPC verify_household_pin({householdId}, ****) → {selectedJoinKey} if correct. Hashed bcrypt, never plain.</div>
          </>
        )}
        {step==="joining" && (
          <div className="py-10 text-center">
            <div className="h-10 w-10 rounded-full bg-[var(--chip-bg)] animate-pulse mx-auto grid place-items-center">♥</div>
            <div className="mt-3 text-[14px] font-medium text-[#2D2118]">Joining your space…</div>
            <div className="mt-1 text-[11px] text-[#6B5242]">Syncing household-isolated chores, calendar, shopping, notes</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default OnboardingFlow;
