import React from "react";
export function AppShell({children, tab, setTab}:{children: React.ReactNode; tab: string; setTab:(k:any)=>void}) {
  // Shell wrapper - V117 behavior is 100vw full-bleed, topBar #1E1E20, nav active #FF6B26/#0A0A0A
  return <div className="nylah-shell" style={{minHeight:"100vh"}}>{children}</div>;
}
