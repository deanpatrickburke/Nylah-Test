import React from "react";

// 80+ chore-themed line-art icons — warm tactile doodle style matching Beirt boutique
// All use currentColor, strokeWidth 1.6, round caps/joins, 24x24 viewBox
// Line-art only, no fill except tiny dots

export type ChoreIconId =
  | 'broom'
  | 'dishes'
  | 'bins'
  | 'laundry'
  | 'vacuum'
  | 'bathroom'
  | 'cooking'
  | 'shopping'
  | 'dust'
  | 'mop'
  | 'windows'
  | 'bed'
  | 'recycling'
  | 'ironing'
  | 'garden'
  | 'pet'
  | 'cleaning'
  | 'kitchen'
  | 'groceries'
  | 'tools'
  | 'fridge'
  | 'microwave'
  | 'trash'
  | 'compost'
  | 'pantry'
  | 'toilet'
  | 'shower'
  | 'sink'
  | 'mirror'
  | 'towels'
  | 'plunger'
  | 'polish'
  | 'cobweb'
  | 'tidy'
  | 'organize'
  | 'folding'
  | 'wardrobe'
  | 'sheets'
  | 'leaves'
  | 'lawn'
  | 'snow'
  | 'car'
  | 'mailbox'
  | 'patio'
  | 'sofa'
  | 'plants'
  | 'lights'
  | 'candles'
  | 'fire'
  | 'curtains'
  | 'pet-dog'
  | 'pet-cat'
  | 'pet-bowl'
  | 'pet-walk'
  | 'litter'
  | 'bills'
  | 'calendar'
  | 'medicine'
  | 'baby'
  | 'elderly'
  | 'bakery'
  | 'coffee'
  | 'tea'
  | 'bbq'
  | 'picnic'
  | 'oven'
  | 'kettle'
  | 'toaster'
  | 'blender'
  | 'sponge'
  | 'storage'
  | 'pest'
  | 'star'
  | 'sparkle'
  | 'heart'
  | 'celebration'
  | 'music'
  | 'gift'
  | 'trophy'
  | 'balloon'
  | 'party'
  | 'game'
  | 'check';

type IconProps = { size?: number; className?: string; style?: React.CSSProperties };

const baseProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const wrap = (children: React.ReactNode, size = 24) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...baseProps}>{children}</svg>
);

// Each icon as a function returning JSX
export const CHORE_ICONS: Record<ChoreIconId, (props?: IconProps) => React.ReactElement> = {
  // -- original 20 --
  broom: ({size=24}={}) => wrap(<><path d="M3 20 L11 12 M8 15 L10.5 17.5 M11 12 L18 5 L17 3.5 L14.5 2.5 L7.5 10 M14 8 L16.5 10.5" /><path d="M3 20 Q6 21.5 9 20 Q7 18 3 20" /></>, size),
  dishes: ({size=24}={}) => wrap(<><ellipse cx="12" cy="7" rx="7" ry="2.2" /><path d="M5 7 V14 Q5 18 12 18 Q19 18 19 14 V7" /><path d="M8 11 Q12 13 16 11" /></>, size),
  bins: ({size=24}={}) => wrap(<><path d="M6 6 H18 L17 20 H7 Z" /><path d="M4 6 H20" /><path d="M9 6 V4 H15 V6" /><path d="M10 10 V16 M14 10 V16" /></>, size),
  laundry: ({size=24}={}) => wrap(<><path d="M4 7 H20 L19 20 H5 Z" /><circle cx="12" cy="13.5" r="4.5" /><circle cx="12" cy="13.5" r="1.8" /><path d="M8 7 V5 Q12 4 16 5 V7" /></>, size),
  vacuum: ({size=24}={}) => wrap(<><path d="M15 3 L17 5 L11 16 L9 14 Z" /><path d="M9 14 L5 18 L6 20 L10 19 Z" /><path d="M17 5 L19 4.2 L20 6" /></>, size),
  bathroom: ({size=24}={}) => wrap(<><path d="M7 6 H17 A2 2 0 0 1 19 8 V10 A6 6 0 0 1 12 16 A6 6 0 0 1 5 10 V8 A2 2 0 0 1 7 6 Z" /><path d="M9 16 V19 H15 V16" /><path d="M10 11 Q12 12 14 11" /></>, size),
  cooking: ({size=24}={}) => wrap(<><path d="M4 9 H20 L19 13 Q18 19 12 19 Q6 19 5 13 Z" /><path d="M8 9 V6 H16 V9" /><path d="M9.5 14.5 Q12 15.5 14.5 14.5" /></>, size),
  shopping: ({size=24}={}) => wrap(<><path d="M6 8 H18 L17 19 H7 Z" /><path d="M9 8 V6 A3 3 0 0 1 15 6 V8" /><path d="M9 12 H15" /></>, size),
  dust: ({size=24}={}) => wrap(<><path d="M5 15 Q12 8 19 15" /><path d="M7 12 Q12 7 17 12" /><path d="M4 17 L20 17" strokeDasharray="1.5 2" /></>, size),
  mop: ({size=24}={}) => wrap(<><path d="M14 4 L18 8 L8 18 Q6 19 4 17 Q6 15 8 13 L14 4" /><path d="M4 17 Q7 18.5 9.5 17" /></>, size),
  windows: ({size=24}={}) => wrap(<><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 12 H20" /><path d="M12 4 V20" /><path d="M7 7 L11 11 M13 13 L17 17" opacity="0.5" /></>, size),
  bed: ({size=24}={}) => wrap(<><path d="M4 13 H20 V19 H4 Z" /><path d="M4 13 Q12 9 20 13" /><path d="M7 10 Q9 8 11 10" /></>, size),
  recycling: ({size=24}={}) => wrap(<><path d="M12 5 L15 9 H9 Z M16 14 L18.5 11 L20.5 14.5 L16 14 M8 14 L3.5 14.5 L5.5 11 L8 14" /><path d="M12 9 V14 M15.8 12.8 L13 14.5 M8.2 12.8 L11 14.5" /></>, size),
  ironing: ({size=24}={}) => wrap(<><path d="M5 12 L14 6 L17 9 L8 16 Z" /><path d="M17 9 L19 11 L18 13 L15 11 Z" /><path d="M6 16 H12" /></>, size),
  garden: ({size=24}={}) => wrap(<><path d="M12 4 Q13 7 12 10 Q11 7 12 4" /><path d="M12 10 Q9 12 8 16 Q12 15 12 10" /><path d="M12 10 Q15 12 16 16 Q12 15 12 10" /><path d="M8 18 Q12 20 16 18" /></>, size),
  pet: ({size=24}={}) => wrap(<><ellipse cx="12" cy="14" rx="6" ry="5" /><circle cx="8" cy="8" r="1.5" /><circle cx="12" cy="7" r="1.5" /><circle cx="16" cy="8" r="1.5" /><circle cx="10" cy="12.5" r="0.8" fill="currentColor" /><circle cx="14" cy="12.5" r="0.8" fill="currentColor" /></>, size),
  cleaning: ({size=24}={}) => wrap(<><path d="M7 7 L12 11 L18 5" /><circle cx="7" cy="7" r="1.2" fill="currentColor" stroke="none" /><circle cx="12" cy="11" r="1.2" fill="currentColor" stroke="none" /><circle cx="18" cy="5" r="1.2" fill="currentColor" stroke="none" /><path d="M6 16 Q9 13 12 16 Q15 19 18 16" /></>, size),
  kitchen: ({size=24}={}) => wrap(<><path d="M8 3 V18 Q8 20 12 20 Q16 20 16 18 V3" /><path d="M8 6 H16" /><path d="M10 21 L14 21" /></>, size),
  groceries: ({size=24}={}) => wrap(<><path d="M4 6 Q12 5 20 6 L18 18 H6 Z" /><path d="M8 10 L9 14 M12 10 L12.5 14 M16 10 L15 14" /><circle cx="10" cy="8" r="1" fill="currentColor" stroke="none" /></>, size),
  tools: ({size=24}={}) => wrap(<><path d="M14.5 5.5 L17.5 8.5 L14 12 L10.5 15.5 L7 12 L11 8 Z" /><path d="M7 12 L4 18 L6 20 L12 17" /><circle cx="15.5" cy="6.5" r="1.2" /></>, size),

  // -- Kitchen expansion --
  fridge: ({size=24}={}) => wrap(<><rect x="6" y="3" width="12" height="18" rx="1.5" /><path d="M6 10 H18" /><path d="M10 6.5 V8 M10 13.5 V15" /></>, size),
  microwave: ({size=24}={}) => wrap(<><rect x="3" y="6" width="18" height="12" rx="2" /><rect x="13" y="8" width="5" height="8" rx="0.8" /><circle cx="15.5" cy="10" r="0.7" fill="currentColor" stroke="none" /></>, size),
  trash: ({size=24}={}) => wrap(<><path d="M7 8 H17 L16 19 H8 Z" /><path d="M5 8 H19" /><path d="M10 8 V6 H14 V8" /><path d="M10.5 11.5 V16 M13.5 11.5 V16" /></>, size),
  compost: ({size=24}={}) => wrap(<><path d="M5 8 H19 L17.5 19 H6.5 Z" /><path d="M12 11 Q12.5 13.5 14 15 Q12 14.5 10 15 Q11.5 13.5 12 11" /><path d="M9 8 V7 Q12 6 15 7 V8" /></>, size),
  pantry: ({size=24}={}) => wrap(<><path d="M5 4 H19 V19 H5 Z" /><path d="M5 9 H19" /><path d="M5 14 H19" /><rect x="8" y="5.5" width="2.5" height="2" rx="0.4" /><rect x="13" y="10.5" width="2.5" height="2" rx="0.4" /></>, size),
  oven: ({size=24}={}) => wrap(<><rect x="4" y="5" width="16" height="14" rx="1.8" /><rect x="6.5" y="8" width="11" height="7" rx="1" /><path d="M9 17 H15" /><circle cx="16.5" cy="6.8" r="0.6" fill="currentColor" stroke="none" /></>, size),
  kettle: ({size=24}={}) => wrap(<><path d="M8 10 Q8 6 12 6 Q16 6 16 10 L15 15 H9 Z" /><path d="M16 8.5 Q18.5 9.5 18 12 Q17 13 16 12.5" /><path d="M9 5 Q12 3 15 5" /></>, size),
  toaster: ({size=24}={}) => wrap(<><rect x="5" y="9" width="14" height="8" rx="1.6" /><path d="M8 9 V7.5 Q12 6 16 7.5 V9" /><circle cx="10" cy="7.2" r="0.6" fill="currentColor" stroke="none" /><circle cx="13" cy="6.8" r="0.5" fill="currentColor" stroke="none" /></>, size),
  blender: ({size=24}={}) => wrap(<><path d="M8 5 H16 L14.5 14 H9.5 Z" /><path d="M9.5 14 V18 H14.5 V14" /><path d="M8.5 19 H15.5" /><path d="M10 7.5 H14" /></>, size),

  // -- Bathroom --
  toilet: ({size=24}={}) => wrap(<><ellipse cx="12" cy="10" rx="6" ry="4" /><path d="M6 10 C6 16 8.5 19 12 19 C15.5 19 18 16 18 10" /><path d="M9 5 H15" /><path d="M9 5 V7" /><path d="M15 5 V7" /></>, size),
  shower: ({size=24}={}) => wrap(<><path d="M12 3 L8 7 H16 Z" /><path d="M12 7 V11" /><circle cx="9.5" cy="13" r="0.6" fill="currentColor" stroke="none" /><circle cx="12" cy="14.2" r="0.6" fill="currentColor" stroke="none" /><circle cx="14.5" cy="13" r="0.6" fill="currentColor" stroke="none" /><path d="M10 16 Q12 17 14 16" /></>, size),
  sink: ({size=24}={}) => wrap(<><path d="M5 12 H19" /><path d="M6 12 Q6 16 12 16 Q18 16 18 12" /><path d="M12 8 V12" /><path d="M10.5 8 Q12 6.5 13.5 8" /></>, size),
  mirror: ({size=24}={}) => wrap(<><rect x="6" y="4" width="12" height="16" rx="6" /><path d="M8.5 8.5 L11 11" opacity="0.6" /><circle cx="13.5" cy="8" r="0.6" fill="currentColor" stroke="none" opacity="0.5" /></>, size),
  towels: ({size=24}={}) => wrap(<><path d="M4 6 H20" /><path d="M7 6 V14 Q7 16 10 16 H11 Q13 16 13 14 V7" /><path d="M13 8 V14 Q13 16.5 16 16.5 H17 Q19 16.5 19 14.5 V8" /></>, size),
  plunger: ({size=24}={}) => wrap(<><path d="M12 5 V14" /><path d="M9 15 Q12 13 15 15 Q15 18 12 19 Q9 18 9 15" /><circle cx="12" cy="5" r="1.2" /></>, size),
  sponge: ({size=24}={}) => wrap(<><path d="M5 13 Q6 9 11 9 Q14 9.5 16 12 Q19 14 18 17 Q15 19 9 18 Q5 16 5 13 Z" /><circle cx="9" cy="12.5" r="0.5" fill="currentColor" stroke="none" opacity="0.5" /><circle cx="12.5" cy="14" r="0.6" fill="currentColor" stroke="none" opacity="0.4" /></>, size),

  // -- Cleaning extras --
  polish: ({size=24}={}) => wrap(<><path d="M6 16 H18" /><path d="M9 12 L11 14 L16 8" /><circle cx="17" cy="9" r="1" fill="currentColor" stroke="none" opacity="0.6" /><path d="M14.5 6.5 L15.5 7.5 M17.2 5.8 L17.8 6.2" /></>, size),
  cobweb: ({size=24}={}) => wrap(<><path d="M4 4 L4 13 M4 4 L12 4 M4 4 L12 12" opacity="0.9" /><path d="M6 4 Q8 7 7 10 M9 4 Q12 7.5 11 11 M12 5 Q12 9 12 12" opacity="0.6" /><path d="M4 6 Q7 8 10 7 M4 9 Q7 11 11 10" opacity="0.6" /></>, size),
  tidy: ({size=24}={}) => wrap(<><rect x="4" y="6" width="7" height="5" rx="1" /><rect x="13" y="6" width="7" height="5" rx="1" /><rect x="7" y="13" width="10" height="5" rx="1" /><path d="M8 8 H9.5 M15 8 H16.5" /></>, size),
  organize: ({size=24}={}) => wrap(<><rect x="4" y="4" width="7" height="7" rx="1.2" /><rect x="13" y="4" width="7" height="7" rx="1.2" /><rect x="4" y="13" width="7" height="7" rx="1.2" /><rect x="13" y="13" width="7" height="7" rx="1.2" /></>, size),

  // -- Laundry extras --
  folding: ({size=24}={}) => wrap(<><path d="M6 8 L12 4 L18 8 V16 H6 Z" /><path d="M9 12 H15" /><path d="M12 4 V16" /></>, size),
  wardrobe: ({size=24}={}) => wrap(<><rect x="5" y="4" width="14" height="16" rx="1.4" /><path d="M12 4 V20" /><circle cx="9.5" cy="11" r="0.6" fill="currentColor" stroke="none" /><circle cx="14.5" cy="11" r="0.6" fill="currentColor" stroke="none" /></>, size),
  sheets: ({size=24}={}) => wrap(<><rect x="5" y="6" width="14" height="3" rx="0.8" /><rect x="5" y="10" width="14" height="3" rx="0.8" /><rect x="5" y="14" width="14" height="3" rx="0.8" /><path d="M8 6 V5" /></>, size),

  // -- Outside --
  leaves: ({size=24}={}) => wrap(<><path d="M12 5 Q13.5 8 12 11 Q10.5 8 12 5" /><path d="M12 11 Q9 12.5 8 15.5 Q11 15 12 11" /><path d="M12 11 Q15 12.5 16 15.5 Q13 15 12 11" /><path d="M7 7 Q8 9 7 11 Q6 9 7 7" opacity="0.7" /></>, size),
  lawn: ({size=24}={}) => wrap(<><path d="M4 17 H20" /><path d="M6 17 L7.5 11 H12 L13.5 17" /><path d="M12 11 Q12 7 15 6" /><circle cx="15.2" cy="5.8" r="1.1" /></>, size),
  snow: ({size=24}={}) => wrap(<><path d="M12 5 V19 M5.5 8.5 L18.5 15.5 M18.5 8.5 L5.5 15.5" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="7" r="0.6" fill="currentColor" stroke="none" opacity="0.7" /><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" opacity="0.7" /></>, size),
  car: ({size=24}={}) => wrap(<><path d="M3 12 H21 L19 16 H5 Z" /><path d="M6 12 L8 8 H16 L18 12" /><circle cx="8.5" cy="16" r="1.2" /><circle cx="15.5" cy="16" r="1.2" /></>, size),
  mailbox: ({size=24}={}) => wrap(<><path d="M6 9 H16 Q18 9 18 11.5 Q18 14 16 14 H6 Z" /><path d="M12 14 V19" /><path d="M9 19 H15" /><path d="M16 8 V9.5" /></>, size),
  patio: ({size=24}={}) => wrap(<><path d="M5 17 H19" /><path d="M7 17 V13 H11 V17" /><path d="M14 12 H18 V17" /><path d="M11 10 H15" /></>, size),

  // -- Living --
  sofa: ({size=24}={}) => wrap(<><path d="M4 12 H20 V16 H4 Z" /><path d="M4 12 Q4 9 7 9 H9 Q9 11 11 11" /><path d="M20 12 Q20 9 17 9 H15 Q15 11 13 11" /><path d="M6 9 V7 H9" opacity="0.6" /></>, size),
  plants: ({size=24}={}) => wrap(<><path d="M9 18 H15 L14 14 H10 Z" /><path d="M12 14 Q10 10 8 8 Q11 9 12 14" /><path d="M12 14 Q14 10 16 8 Q13 9 12 14" /><path d="M12 14 Q12 8 12 5" /></>, size),
  lights: ({size=24}={}) => wrap(<><path d="M12 4 A4 4 0 0 1 16 8 Q16 11 13 12 V14 H11 V12 Q8 11 8 8 A4 4 0 0 1 12 4 Z" /><path d="M11 15 H13 M11 17 H13" /></>, size),
  candles: ({size=24}={}) => wrap(<><rect x="9" y="11" width="6" height="8" rx="1" /><path d="M12 11 V8 Q13 6.5 12 5 Q11 6.5 12 8" /><circle cx="12" cy="5" r="0.6" fill="currentColor" stroke="none" /></>, size),
  fire: ({size=24}={}) => wrap(<><path d="M12 4 Q15 8 14 12 Q16 10 16 13 Q16 18 12 18 Q8 18 8 13 Q8 10 10 12 Q9 8 12 4 Z" /><path d="M12 10 Q13 12 12 14 Q11 12 12 10" opacity="0.6" /></>, size),
  curtains: ({size=24}={}) => wrap(<><path d="M4 4 H20" /><path d="M5 4 Q6.5 12 5.5 20" /><path d="M10 4 Q11 12 10 20" /><path d="M14 4 Q13 12 14 20" /><path d="M19 4 Q17.5 12 18.5 20" /></>, size),

  // -- Pets --
  "pet-dog": ({size=24}={}) => wrap(<><path d="M7 11 Q7 7 12 7 Q17 7 17 11 L16.5 15 Q12 17 7.5 15 Z" /><path d="M7 10 Q5 9 4.5 11 Q5 13 7 12" /><path d="M17 10 Q19 9 19.5 11 Q19 13 17 12" /><circle cx="10" cy="11.5" r="0.6" fill="currentColor" stroke="none" /><circle cx="14" cy="11.5" r="0.6" fill="currentColor" stroke="none" /><path d="M11 14 Q12 15 13 14" /></>, size),
  "pet-cat": ({size=24}={}) => wrap(<><path d="M8 5 L9.5 8.5 L7 10 Z" fill="none" /><path d="M16 5 L14.5 8.5 L17 10 Z" fill="none" /><path d="M8 8.5 Q12 6 16 8.5 Q18 12.5 16 16 Q12 18 8 16 Q6 12.5 8 8.5 Z" /><circle cx="10.2" cy="12.2" r="0.6" fill="currentColor" stroke="none" /><circle cx="13.8" cy="12.2" r="0.6" fill="currentColor" stroke="none" /><path d="M11.5 14.5 Q12 15.2 12.5 14.5" /></>, size),
  "pet-bowl": ({size=24}={}) => wrap(<><path d="M5 10 H19 L17 16 Q12 18 7 16 Z" /><ellipse cx="12" cy="10" rx="7" ry="1.6" /><circle cx="12" cy="12.5" r="1" fill="currentColor" stroke="none" opacity="0.5" /></>, size),
  "pet-walk": ({size=24}={}) => wrap(<><circle cx="8" cy="7" r="2" /><path d="M8 9 V15 L6 18 M8 11 L12 12" /><path d="M14 10 L18 12 L19 18 L17 18 L16.5 13 L12 12" /><path d="M12 12 Q13 9 14 10" /></>, size),
  litter: ({size=24}={}) => wrap(<><rect x="4" y="11" width="16" height="8" rx="1.4" /><path d="M6 11 L8 8 H16 L18 11" /><circle cx="10" cy="14.5" r="0.6" fill="currentColor" stroke="none" opacity="0.6" /><circle cx="13" cy="15" r="0.5" fill="currentColor" stroke="none" opacity="0.5" /></>, size),

  // -- Upkeep / Care --
  bills: ({size=24}={}) => wrap(<><rect x="5" y="7" width="14" height="10" rx="1.2" /><path d="M12 9.5 V14.5" /><path d="M10 10.5 Q12 9 14 10.5 Q14 12 12 12.2 Q10 12.5 10 14 Q10 15.5 12 15.5 Q14 15.5 14 14" /><path d="M7 5 H17" opacity="0.6" /></>, size),
  calendar: ({size=24}={}) => wrap(<><rect x="4" y="5" width="16" height="14" rx="1.6" /><path d="M4 9 H20" /><path d="M8 5 V7" /><path d="M16 5 V7" /><circle cx="8.5" cy="13" r="0.7" fill="currentColor" stroke="none" /></>, size),
  medicine: ({size=24}={}) => wrap(<><rect x="7" y="5" width="10" height="7" rx="1" /><path d="M7 12 H17 L16 19 H8 Z" /><circle cx="12" cy="15.5" r="1.2" /><path d="M10 8 H14" /></>, size),
  baby: ({size=24}={}) => wrap(<><circle cx="12" cy="9" r="4.5" /><path d="M8 13 Q12 17 16 13" /><circle cx="10.3" cy="9" r="0.5" fill="currentColor" stroke="none" /><circle cx="13.7" cy="9" r="0.5" fill="currentColor" stroke="none" /></>, size),
  elderly: ({size=24}={}) => wrap(<><circle cx="12" cy="6" r="2" /><path d="M12 8 V13 L11 18" /><path d="M12 10 L14.5 11.5" /><path d="M9 9 L12 10.5 M12 13 L9 14" /><path d="M14.5 11.5 V18" /></>, size),

  // -- Food --
  bakery: ({size=24}={}) => wrap(<><path d="M6 11 Q8 7 12 7 Q16 7 18 11 L17 15 H7 Z" /><path d="M8 11 Q12 13 16 11" /></>, size),
  coffee: ({size=24}={}) => wrap(<><path d="M6 9 H15 Q16 12 15 15 Q12 17 7 15 Z" /><path d="M15 10 Q17.5 10.5 17 12.5 Q16 14 15 13" /><path d="M9 6 Q10 4 11 6 M12 5.5 Q13 4 14 5.5" opacity="0.6" /></>, size),
  tea: ({size=24}={}) => wrap(<><path d="M7 9 H16 L15 16 H8 Z" /><path d="M16 10.5 Q18.5 11 18 13 Q17 14.5 16 13.5" /><path d="M9 7 Q12 5 15 7" /></>, size),
  bbq: ({size=24}={}) => wrap(<><path d="M4 12 H20" /><path d="M6 12 Q6 16 12 16 Q18 16 18 12" /><path d="M9 9 L8 12 M12 8 L12 12 M15 9 L16 12" /><circle cx="12" cy="7" r="1" fill="currentColor" stroke="none" opacity="0.5" /></>, size),
  picnic: ({size=24}={}) => wrap(<><path d="M6 12 Q12 9 18 12 L17 16 H7 Z" /><path d="M9 9 L10 7.5 H14 L15 9" /><circle cx="12" cy="11" r="0.5" fill="currentColor" stroke="none" /></>, size),

  // -- Misc / Fun --
  star: ({size=24}={}) => wrap(<><path d="M12 5 L13.8 9.8 L19 10 L14.8 13.2 L16 18.5 L12 15.6 L8 18.5 L9.2 13.2 L5 10 L10.2 9.8 Z" /></>, size),
  sparkle: ({size=24}={}) => wrap(<><path d="M12 3 L12.6 8 L18 9 L12.6 10 L12 15 L11.4 10 L6 9 L11.4 8 Z" /><path d="M17.5 6 L17.8 7.5 L19.3 7.8 L17.8 8.1 L17.5 9.6 L17.2 8.1 L15.7 7.8 L17.2 7.5 Z" opacity="0.7" /><circle cx="7" cy="13" r="0.6" fill="currentColor" stroke="none" /></>, size),
  heart: ({size=24}={}) => wrap(<><path d="M12 16.5 Q7 13 5 10 Q5 6.5 9 6.5 Q11 6.5 12 8 Q13 6.5 15 6.5 Q19 6.5 19 10 Q17 13 12 16.5 Z" /></>, size),
  celebration: ({size=24}={}) => wrap(<><path d="M12 5 V11" /><path d="M9 6 L10.5 8.5" /><path d="M15 6 L13.5 8.5" /><path d="M5 7 L7.2 9" /><path d="M19 7 L16.8 9" /><circle cx="12" cy="14.5" r="3" /><path d="M11 16.5 L10 18.5 M13 16.5 L14 18.5" /></>, size),
  music: ({size=24}={}) => wrap(<><path d="M10 14 V7 L16 6 V13" /><circle cx="10" cy="15" r="1.8" /><circle cx="16" cy="14" r="1.8" /></>, size),
  gift: ({size=24}={}) => wrap(<><rect x="5" y="9" width="14" height="10" rx="1.2" /><path d="M5 9 L12 12 L19 9" /><path d="M12 12 V19" /><path d="M9 6.5 Q12 4 12 6.5 Q12 4 15 6.5 Q15 8.5 12 9 Q9 8.5 9 6.5 Z" /></>, size),
  trophy: ({size=24}={}) => wrap(<><path d="M9 9 H15 Q17 9 17 11.5 Q17 15 12 16 Q7 15 7 11.5 Q7 9 9 9" /><path d="M7 10 Q5.5 10 5 11.5 Q5 13 7 13" /><path d="M17 10 Q18.5 10 19 11.5 Q19 13 17 13" /><path d="M12 16 V18 H10" /><path d="M9 19 H15" /></>, size),
  balloon: ({size=24}={}) => wrap(<><ellipse cx="12" cy="8" rx="4.5" ry="5" /><path d="M12 13 V19 Q11 20 12 20 Q13 20 12 19" /><circle cx="12" cy="6.5" r="0.5" fill="currentColor" stroke="none" /></>, size),
  party: ({size=24}={}) => wrap(<><path d="M8 6 L16 6 L14 15 L10 15 Z" /><path d="M8 6 Q12 4 16 6" /><circle cx="11" cy="9" r="0.5" fill="currentColor" stroke="none" /><circle cx="14" cy="11" r="0.4" fill="currentColor" stroke="none" /></>, size),
  game: ({size=24}={}) => wrap(<><path d="M6 12 Q6 9 9 9 H15 Q18 9 18 12 Q18 16 12 17 Q6 16 6 12 Z" /><circle cx="10" cy="12.5" r="0.7" fill="currentColor" stroke="none" /><circle cx="14" cy="12.5" r="0.7" fill="currentColor" stroke="none" /><path d="M10 10.5 H10.1 M14 10 H14.1" /></>, size),
  check: ({size=24}={}) => wrap(<><circle cx="12" cy="12" r="8" /><path d="M8.5 12 L11 14.5 L15.5 9.5" /></>, size),
};

export function ChoreIcon({ id, size = 28, className, style }: { id: ChoreIconId | string; size?: number; className?: string; style?: React.CSSProperties }) {
  const key = (typeof id === 'string' ? id : 'broom') as ChoreIconId;
  const fn = (CHORE_ICONS as any)[key] || CHORE_ICONS.broom;
  const el = fn({ size, className, style });
  // inject className/style if provided
  if (!className && !style) return el;
  return (
    <span className={className} style={style as any} aria-hidden="true">
      {el}
    </span>
  );
}

// Default mapping for legacy templates
export const CHORE_ICON_BY_TEMPLATE: Record<string, ChoreIconId> = {
  Bins: 'bins',
  Dishes: 'dishes',
  Laundry: 'laundry',
  Vacuum: 'vacuum',
  Bathroom: 'bathroom',
  Shop: 'shopping',
};

export const ALL_CHORE_ICON_IDS: ChoreIconId[] = [
  'broom','dishes','bins','laundry','vacuum','bathroom','cooking','shopping','dust','mop','windows','bed','recycling','ironing','garden','pet','cleaning','kitchen','groceries','tools',
  'fridge','microwave','trash','compost','pantry','toilet','shower','sink','mirror','towels','plunger','polish','cobweb','tidy','organize',
  'folding','wardrobe','sheets','leaves','lawn','snow','car','mailbox','patio','sofa','plants','lights','candles','fire','curtains',
  'pet-dog','pet-cat','pet-bowl','pet-walk','litter','bills','calendar','medicine','baby','elderly','bakery','coffee','tea','bbq','picnic',
  'oven','kettle','toaster','blender','sponge','storage','pest','star','sparkle','heart','celebration','music','gift','trophy','balloon','party','game','check'
];

export const ICON_CATEGORIES = ['Kitchen','Bathroom','Cleaning','Laundry','Outside','Living','Pets','Upkeep','Food','Fun'] as const;
export type IconCategory = typeof ICON_CATEGORIES[number];

export const CATEGORY_MAP: Record<IconCategory, ChoreIconId[]> = {
  Kitchen: ['dishes','cooking','kitchen','groceries','fridge','microwave','trash','recycling','compost','pantry','oven','kettle','toaster','blender'],
  Bathroom: ['bathroom','toilet','shower','sink','mirror','towels','laundry','mop','plunger','sponge'],
  Cleaning: ['broom','vacuum','dust','mop','windows','cleaning','polish','cobweb','tidy','organize','sponge','pest','storage'],
  Laundry: ['laundry','ironing','folding','wardrobe','bed','sheets','towels'],
  Outside: ['garden','leaves','lawn','bins','snow','car','mailbox','patio','trash','compost'],
  Living: ['bed','sofa','plants','lights','candles','fire','curtains','storage','wardrobe','kitchen'],
  Pets: ['pet','pet-dog','pet-cat','pet-bowl','pet-walk','litter'],
  Upkeep: ['shopping','tools','bills','calendar','medicine','baby','elderly','car','mailbox','storage'],
  Food: ['cooking','dishes','bakery','coffee','tea','bbq','picnic','groceries','oven','kettle','toaster','blender','fridge'],
  Fun: ['star','sparkle','heart','celebration','music','gift','trophy','balloon','party','game','check','pest']
};
