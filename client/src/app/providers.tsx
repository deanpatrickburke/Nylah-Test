import React from "react";
export function Providers({children}:{children:React.ReactNode}) {
  // V117: no extra providers, just pass-through to preserve behavior
  return <>{children}</>;
}
