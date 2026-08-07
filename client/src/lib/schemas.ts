import { z } from "zod";

// --- shared primitives ---
export const personKeySchema = z.enum(["aisling", "ciaran"]);
export type PersonKey = z.infer<typeof personKeySchema>;

export const recurrenceKindSchema = z.enum([
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "twice-week",
  "custom",
  "once",
  // shopping specific mapped variants
  "every-2d",
  "as-needed",
]);
export type RecurrenceKind = z.infer<typeof recurrenceKindSchema>;

// recurrence rule: semantic, timezone-aware
export const recurrenceRuleSchema = z.object({
  kind: z.enum(["daily", "weekly", "biweekly", "monthly", "twice-week", "custom", "once", "hourly"]),
  weekdays: z.array(z.string()).optional(), // ["Mo","Tu"] or [0-6]
  jsWeekdays: z.array(z.number().min(0).max(6)).optional(), // JS getDay 0=Sun
  dayOfMonth: z.number().min(1).max(31).optional(),
  weekOfMonth: z.enum(["first", "second", "third", "fourth", "last"]).optional(),
  time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(), // "09:00"
  tz: z.string().optional(), // IANA e.g. Europe/Dublin
  interval: z.number().min(1).optional(), // every N
  count: z.number().optional(),
  until: z.string().optional(), // ISO
  detailRaw: z.string().optional(), // legacy frequencyDetail
});
export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>;

export const baseEntitySchema = z.object({
  id: z.string().min(1),
  createdAt: z.string(), // ISO
  updatedAt: z.string().optional(),
  createdBy: personKeySchema.or(z.string()).optional(), // allow "unknown"/"system"
  updatedBy: personKeySchema.or(z.string()).optional(),
  revision: z.number().int().nonnegative().optional(),
  deletedAt: z.string().optional().nullable(),
});

export const swipeChoreSchema = z.object({
  aisling: z.enum(["left", "right"]).nullable(),
  ciaran: z.enum(["left", "right"]).nullable(),
});

export const swipeCalendarSchema = z.object({
  aisling: z.enum(["yes", "no"]).nullable(),
  ciaran: z.enum(["yes", "no"]).nullable(),
});

// --- ChoreV2 ---
export const choreV2Schema = baseEntitySchema.extend({
  title: z.string().min(1).max(200),
  type: z.enum(["one-off", "repeat"]),
  frequency: z.enum(["daily", "twice-week", "weekly", "biweekly", "monthly", "custom", "once"]),
  frequencyDetail: z.string().optional(),
  dueAt: z.string().optional(),
  pain: z.number().min(1).max(10),
  basePoints: z.number().min(0).max(1000),
  swipes: swipeChoreSchema,
  status: z.enum(["deck", "assigned", "open", "race", "bonus", "done"]),
  assignedTo: personKeySchema.nullable().optional(),
  multiplier: z.number().min(0.5).max(5),
  isOpenDoubled: z.boolean().optional(),
  completedBy: personKeySchema.nullable().optional(),
  completedAt: z.string().optional(),
  // race / claim fields (app uses both camel and snake)
  completed_by: personKeySchema.nullable().optional(),
  completed_at: z.string().optional(),
  claimed_by: personKeySchema.or(z.string()).nullable().optional(),
  claimedBy: personKeySchema.or(z.string()).nullable().optional(),
  claimed_at: z.string().optional(),
  marked_done_by: personKeySchema.nullable().optional(),
  race_claimed_at: z.string().optional(),
  race_started_at: z.string().optional(),
  awardedPoints: z.number().optional(),
  awardedMultiplier: z.number().optional(),
  urgencyBonusApplied: z.boolean().optional(),
  timeWindowHours: z.number().min(1).max(24 * 90).optional(),
  templateId: z.string().optional(),
  recurrence: recurrenceRuleSchema.optional(),
  dayOfMonth: z.number().min(1).max(31).optional(),
  originalDom: z.number().min(1).max(31).optional(),
  localTime: z.string().optional(),
  timezone: z.string().optional(),
  updatedBy: personKeySchema.or(z.string()).optional(),
});
export type ChoreV2 = z.infer<typeof choreV2Schema>;

// --- CalendarEventV2 ---
export const calendarEventV2Schema = baseEntitySchema.extend({
  title: z.string().min(1).max(200),
  type: z.enum(["one-off", "repeat"]).optional().default("one-off"),
  frequency: z.enum(["daily", "twice-week", "weekly", "biweekly", "monthly", "custom", "once"]).optional(),
  frequencyDetail: z.string().optional(),
  dueAt: z.string(), // ISO required
  endAt: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  pain: z.number().min(1).max(10).optional(),
  basePoints: z.number().optional(),
  swipes: swipeCalendarSchema,
  // full app statuses (paper spec)
  status: z.enum(["draft","proposed","awaiting_aisling","awaiting_ciaran","needs_discussion","awaiting","discussion","agreed","declined","cancelled","completed","open","dismissed"]),
  proposer: personKeySchema.optional(),
  assignedTo: personKeySchema.nullable().optional(),
  allDay: z.boolean().optional(),
  dayOfMonth: z.number().min(1).max(31).optional(),
  originalDom: z.number().optional(),
  localTime: z.string().optional(),
  timezone: z.string().optional(),
  recurrence: recurrenceRuleSchema.optional(),
  recurrenceRule: z.string().optional(),
  templateId: z.string().optional(),
  occurrenceId: z.string().optional(),
  seriesId: z.string().optional(),
  occurrenceDate: z.string().optional(),
  isTemplate: z.boolean().optional(),
  isOverride: z.boolean().optional(),
  recurrenceUntil: z.string().optional(),
  pinned: z.boolean().optional(),
  pinnedAt: z.string().optional(),
  mutationId: z.string().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  attendees: z.array(personKeySchema).optional(),
  reminderMinutes: z.number().optional(),
  responseDeadline: z.string().optional(),
  responses: z.array(z.any()).optional(),
});
export type CalendarEventV2 = z.infer<typeof calendarEventV2Schema>;

// --- ShoppingItemV2 ---
export const shoppingCategorySchema = z.enum([
  "Food","Household","Toiletries","Clothes","Bills","Trips","Entertainment","Personal","Other",
  // legacy lowercase for compat migration
  "personal","other","toiletries","household"
]);
export const shoppingFrequencySchema = z.enum([
  "daily",
  "every-2d",
  "weekly",
  "biweekly",
  "monthly",
  "as-needed",
  "twice-week",
  "once",
  "custom"
]);

export const shoppingItemV2Schema = baseEntitySchema.extend({
  item: z.string().min(1).max(200),
  qty: z.number().min(0).max(999),
  cat: shoppingCategorySchema,
  purchased: z.boolean(),
  addedBy: personKeySchema,
  lastDoneAt: z.string().optional(),
  repeatCount: z.number().int().min(0),
  history: z.array(z.string()).optional(),
  frequency: shoppingFrequencySchema,
  needDays: z.string().optional(),
  notes: z.string().max(1000).optional(),
  tags: z.array(z.string()).optional(),
  recurrence: recurrenceRuleSchema.optional(),
});
export type ShoppingItemV2 = z.infer<typeof shoppingItemV2Schema>;

// --- NoteMemo ---
export const noteMemoSchema = baseEntitySchema.extend({
  body: z.string().min(1).max(5000),
  author: personKeySchema,
  seenBy: z.object({
    aisling: z.boolean(),
    ciaran: z.boolean(),
  }),
  isLove: z.boolean(),
  photoDataUrl: z.string().optional(), // base64 or storage url
  rotation: z.number().optional(),
  pinnedAt: z.string().optional(),
  archivedAt: z.string().optional(),
  editedAt: z.string().optional(),
});
export type NoteMemo = z.infer<typeof noteMemoSchema>;

// --- safeParse helpers (do not throw) ---
export function safeParseChore(input: unknown) {
  return choreV2Schema.safeParse(input);
}
export function safeParseCalendar(input: unknown) {
  return calendarEventV2Schema.safeParse(input);
}
export function safeParseShopping(input: unknown) {
  return shoppingItemV2Schema.safeParse(input);
}
export function safeParseNote(input: unknown) {
  return noteMemoSchema.safeParse(input);
}

export function safeParseChoresArray(arr: unknown) {
  const list = Array.isArray(arr) ? arr : [];
  return list.map((x) => safeParseChore(x)).filter((r) => r.success).map((r) => (r as any).data as ChoreV2);
}
export function safeParseCalendarArray(arr: unknown) {
  const list = Array.isArray(arr) ? arr : [];
  return list.map((x) => safeParseCalendar(x)).filter((r) => r.success).map((r) => (r as any).data);
}
export function safeParseShoppingArray(arr: unknown) {
  const list = Array.isArray(arr) ? arr : [];
  return list.map((x) => safeParseShopping(x)).filter((r) => r.success).map((r) => (r as any).data);
}
export function safeParseNotesArray(arr: unknown) {
  const list = Array.isArray(arr) ? arr : [];
  return list.map((x) => safeParseNote(x)).filter((r) => r.success).map((r) => (r as any).data);
}

// --- realtime payload --- strict: validated arrays only, no any fallback
export const remoteDataSchema = z.object({
  chores: z.array(choreV2Schema).default([]),
  calendar: z.array(calendarEventV2Schema).default([]),
  shopping: z.array(shoppingItemV2Schema).default([]),
  notes: z.array(noteMemoSchema).default([]),
  meta: z.any().optional(),
  updated_at: z.string().optional(),
  revision: z.number().optional(),
});
export type RemoteDataValidated = z.infer<typeof remoteDataSchema>;
