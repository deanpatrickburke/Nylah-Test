// ZERO LOGIC CHANGE — extracted from App.tsx lines 245-257 V117 4cfbabb
// Contains THEMES array, PERSONS, TABS constants. No logic changes.
import type { Theme, PersonKey, TABSItem } from "../types";

export type { Theme } from "../types";

export const THEMES: Theme[] = [
  { id: "beige", name: "Beige", bg: "#F7EFE8", phoneBg: "linear-gradient(180deg,#FFDCC7 0%,#FFE8D6 22%,#FFFEFB 100%)", accent: "#E8CEB7", accentStrong: "#8B5E3C", text: "#292624", cardBd: "#E8DDD3", navBg: "rgba(255,254,251,0.94)", navActiveBg: "#8B5E3C", navActiveText: "#FFFEFB", topBarBg: "#FFFEFB", washTop: "#FFDCC7", washMid: "#FFE8D6", chipBg: "#F7EFE8", cardBg: "#FFFEFB" },
  { id: "ink", name: "Charcoal Orange", bg: "#121214", phoneBg: "linear-gradient(180deg,#232326 0%,#1E1E20 28%,#161618 58%,#121214 100%)", accent: "#FF6B26", accentStrong: "#FF8A4D", text: "#F5F3F0", cardBd: "rgba(255,255,255,0.08)", navBg: "rgba(22,22,24,0.88)", navActiveBg: "#FF6B26", navActiveText: "#121214", topBarBg: "#1E1E20", washTop: "#2E2E32", washMid: "#242428", chipBg: "#2C2C30", cardBg: "#232326" },
];

// PERSONS — scalable: supports legacy aisling/ciaran and generic person_1/person_2
// Names are mutated at runtime via applyCustomPersonNames() reading localStorage
export const PERSONS: Record<string, { name: string; initial: string; accent: string; accent2: string; wash: string }> = {
  aisling: { name: "Aisling", initial: "Á", accent: "#A89FDA", accent2: "#977DDA", wash: "#E9E0FF" },
  ciaran: { name: "Ciaran", initial: "C", accent: "var(--border)", accent2: "#E07A5F", wash: "var(--wash-top)" },
  person_1: { name: "Partner 1", initial: "1", accent: "#A89FDA", accent2: "#977DDA", wash: "#E9E0FF" },
  person_2: { name: "Partner 2", initial: "2", accent: "var(--border)", accent2: "#E07A5F", wash: "var(--wash-top)" },
};

export const TABS: TABSItem[] = [
  { k: "fridge", label: "Home", title: "Beirt", icon: "" },
  { k: "plans", label: "Plans", title: "Plans", icon: "" },
  { k: "chores", label: "Chores", title: "Chores", icon: "" },
  { k: "shopping", label: "Shop", title: "Shop", icon: "" },
  { k: "notes", label: "Notes", title: "Notes", icon: "" },
] as any;
