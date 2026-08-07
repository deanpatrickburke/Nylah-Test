import React from "react";

// 20 chore-themed line-art icons — warm tactile doodle style matching DoodleBroom
// All use currentColor, strokeWidth 1.6, round caps/joins, 24x24 viewBox
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
  | 'tools';

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
  'broom','dishes','bins','laundry','vacuum','bathroom','cooking','shopping','dust','mop','windows','bed','recycling','ironing','garden','pet','cleaning','kitchen','groceries','tools'
];
