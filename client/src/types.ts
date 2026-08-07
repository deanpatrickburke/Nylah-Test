// ZERO LOGIC CHANGE — extracted from App.tsx 4cfbabb V117
// This file contains all core domain types. No runtime code, only types + trivial const arrays that are required for type guards.

// Scalable person keys — no hardcoded Aisling/Ciaran, any household can have 2 distinct members
// Legacy data may still use "aisling"/"ciaran" but new households use "person_1"/"person_2"
export type PersonKey = string;

export type Theme = {
  id: string;
  name: string;
  bg: string;
  phoneBg: string;
  accent: string;
  accentStrong: string;
  text: string;
  cardBd: string;
  navBg: string;
  navActiveBg: string;
  navActiveText: string;
  topBarBg: string;
  washTop: string;
  washMid: string;
  chipBg: string;
  cardBg: string;
};

export type TabKey = "fridge" | "plans" | "calendar" | "chores" | "shopping" | "notes" | "blueprint";

export type TABSItem = { k: TabKey; label: string; title: string; icon: string };

export type ChoreV2 = {
  id: string;
  title: string;
  type: "one-off" | "repeat";
  frequency: "daily" | "twice-week" | "weekly" | "biweekly" | "monthly" | "custom" | "once";
  frequencyDetail?: string;
  dueAt?: string;
  createdAt: string;
  pain: number;
  basePoints: number;
  swipes: { aisling: "left" | "right" | null; ciaran: "left" | "right" | null };
  status: "deck" | "assigned" | "open" | "race" | "bonus" | "done";
  assignedTo?: PersonKey | null;
  multiplier: number;
  isOpenDoubled?: boolean;
  completedBy?: PersonKey | null;
  completedAt?: string;
  timeWindowHours?: number;
  updatedAt?: string;
  updatedBy?: PersonKey | string;
  deletedAt?: string;
  templateId?: string;
  icon?: string;
  dayOfMonth?: number;
  originalDom?: number;
  localTime?: string;
  timezone?: string;
};

export type CalendarEventStatus =
  | "draft"
  | "proposed"
  | "awaiting_aisling"
  | "awaiting_ciaran"
  | "needs_discussion"
  | "agreed"
  | "declined"
  | "cancelled"
  | "completed"
  | "open"
  | "dismissed";
export type CalendarResponseKind = "yes" | "no" | "discuss";
export type CalendarEventResponse = {
  eventId: string;
  memberId: PersonKey;
  response: CalendarResponseKind;
  comment?: string;
  respondedAt: string;
};

export type CalendarEventV2 = {
  id: string;
  title: string;
  type: "one-off" | "repeat";
  frequency?: "daily" | "twice-week" | "weekly" | "biweekly" | "monthly" | "custom" | "once";
  frequencyDetail?: string;
  dueAt: string;
  endAt?: string;
  start?: string;
  end?: string;
  createdAt: string;
  pain?: number;
  basePoints?: number;
  swipes: { aisling: "yes" | "no" | null; ciaran: "yes" | "no" | null };
  responses?: CalendarEventResponse[];
  status: CalendarEventStatus;
  proposer?: PersonKey;
  assignedTo?: PersonKey | null;
  allDay?: boolean;
  location?: string;
  notes?: string;
  reminderMinutes?: number;
  responseDeadline?: string;
  attendees?: PersonKey[];
  recurrenceRule?: string;
  templateId?: string;
  occurrenceId?: string;
  isTemplate?: boolean;
  dayOfMonth?: number;
  originalDom?: number;
  localTime?: string;
  timezone?: string;
  updatedAt?: string;
  updatedBy?: PersonKey | string;
  deletedAt?: string;
  dismissed?: boolean;
  proposalReason?: string;
  mutationId?: string;
  lastNotifiedState?: string;
};

export type ShoppingCategory =
  | "Food"
  | "Household"
  | "Toiletries"
  | "Clothes"
  | "Bills"
  | "Trips"
  | "Entertainment"
  | "Personal"
  | "Other";

export type ShoppingFrequency = "daily" | "every-2d" | "weekly" | "biweekly" | "monthly" | "as-needed";

export type ShoppingTrip = "grocery" | "online" | "personal" | "want";

export type ShoppingItemV2 = {
  id: string;
  item: string;
  qty: number;
  cat: ShoppingCategory;
  trip?: ShoppingTrip;
  purchased: boolean;
  addedBy: PersonKey;
  createdAt: string;
  lastDoneAt?: string;
  repeatCount: number;
  history?: string[];
  frequency: ShoppingFrequency;
  needDays?: string;
  notes?: string;
  tags?: string[];
  updatedAt?: string;
  updatedBy?: PersonKey | string;
  deletedAt?: string;
  archivedAt?: string;
  status?: "active" | "purchased" | "archived" | "deleted";
  isTemplate?: boolean;
  templateKind?: "personal" | "wants";
  templateOwner?: PersonKey;
  expiresAt?: string;
  mutationId?: string;
  originalDom?: number;
};

export type PersonalWants = {
  aisling: { personal: string[]; wants: string[] };
  ciaran: { personal: string[]; wants: string[] };
};

export type NoteReactionKind = "heart" | "laugh" | "kiss" | "ack";

export type NoteMemo = {
  id: string;
  body: string;
  author: PersonKey;
  createdAt: string;
  seenBy: { aisling: boolean; ciaran: boolean };
  isLove: boolean;
  photoDataUrl?: string;
  photoThumbDataUrl?: string;
  photoStoragePath?: string;
  rotation?: number;
  updatedAt?: string;
  updatedBy?: PersonKey | string;
  deletedAt?: string;
  pinned_at?: string | null;
  pinnedAt?: string | null;
  archived_at?: string | null;
  archivedAt?: string | null;
  read_by?: { aisling?: string; ciaran?: string };
  edited_at?: string | null;
  editedAt?: string | null;
  reactions?: Partial<Record<NoteReactionKind, PersonKey[]>>;
};

// Aliases preserved exactly as in App.tsx
export type CalendarEvent = CalendarEventV2;
export type Chore = ChoreV2;
export type ShoppingItem = ShoppingItemV2;

export type AddEventFormProps = {
  onAdd: (ev: any) => void;
  currentUser: PersonKey;
  selectedDate?: string;
  initialEvent?: any;
};

// Re-export canonical category array (const but required for typing helpers)
// Kept here because original file had `export const CATS` next to ShoppingCategory type
export const CATS: ShoppingCategory[] = [
  "Food",
  "Household",
  "Toiletries",
  "Clothes",
  "Bills",
  "Trips",
  "Entertainment",
  "Personal",
  "Other",
];
