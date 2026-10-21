// @ts-nocheck
import type { Knex } from "knex";
import { getDatabase } from "../database/connection.js";

/**
 * Dead-letter investigation workspace (backend foundation).
 *
 * The outbox already parks undeliverable events in a dead-letter state, but
 * there is nowhere to record what a human concluded about one. In practice that
 * means the same poison message gets re-examined by a different person each
 * time it resurfaces, and a decision to stop retrying lives only in someone's
 * memory.
 *
 * This adds the case file: an investigation attached to a dead-letter entry,
 * with an explicit lifecycle, an assignee, notes, and a recorded resolution.
 *
 * ── Why a state machine rather than a status string ─────────────────────────
 *
 * The states carry different permissions. Only an investigation that reached a
 * conclusion may trigger a replay, and a case closed as `discarded` must not be
 * silently reopened by an automated retry. Encoding the transitions makes those
 * rules checkable in one place instead of re-derived at each call site.
 *
 * The UI is out of scope here; this is the persistence and transition contract
 * it will sit on.
 */

export type InvestigationStatus =
  | "open"
  | "investigating"
  | "awaiting_fix"
  | "resolved"
  | "discarded";

export type InvestigationResolution =
  | "replayed"
  | "fixed_upstream"
  | "duplicate"
  | "not_reproducible"
  | "discarded";

export interface Investigation {
  id: string;
  deadLetterId: string;
  status: InvestigationStatus;
  assignee: string | null;
  resolution: InvestigationResolution | null;
  resolutionNote: string | null;
  openedAt: string;
  closedAt: string | null;
}

/**
 * Permitted transitions.
 *
 * `resolved` and `discarded` are terminal on purpose: a closed case that can be
 * reopened in place loses the record of what was decided the first time.
 * Reopening creates a new investigation against the same dead-letter entry, so
 * both decisions stay on the record.
 */
export const ALLOWED_TRANSITIONS: Record<InvestigationStatus, InvestigationStatus[]> = {
  open: ["investigating", "discarded"],
  investigating: ["awaiting_fix", "resolved", "discarded"],
  awaiting_fix: ["investigating", "resolved", "discarded"],
  resolved: [],
  discarded: [],
};

export const TERMINAL_STATUSES: InvestigationStatus[] = ["resolved", "discarded"];

/** Resolutions that require a note explaining the decision. */
const RESOLUTIONS_REQUIRING_NOTE: InvestigationResolution[] = [
  "discarded",
  "not_reproducible",
];

// ── Pure transition rules ───────────────────────────────────────────────────

export function isTerminal(status: InvestigationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: InvestigationStatus, to: InvestigationStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Validate a transition, returning the reason when it is rejected.
 *
 * Returns a result rather than throwing so route handlers can map a rejection
 * onto a 409 without wrapping normal flow in a try/catch.
 */
export function validateTransition(
  from: InvestigationStatus,
  to: InvestigationStatus
): { ok: true } | { ok: false; reason: string } {
  if (from === to) return { ok: false, reason: `investigation is already ${to}` };
  if (isTerminal(from)) {
    return {
      ok: false,
      reason: `investigation is closed as ${from}; open a new one against the same dead-letter entry`,
    };
  }
  if (!canTransition(from, to)) {
    return { ok: false, reason: `cannot move from ${from} to ${to}` };
  }
  return { ok: true };
}

/**
 * Whether a dead-letter entry may be replayed.
 *
 * Replay is gated on a concluded investigation: replaying a poison message
 * before anyone has established why it failed just re-parks it, and each cycle
 * costs another retry budget.
 */
export function canReplay(investigation: Pick<Investigation, "status" | "resolution">): boolean {
  if (investigation.status !== "resolved") return false;
  // A case resolved as duplicate or discarded has nothing to replay.
  return investigation.resolution === "replayed" || investigation.resolution === "fixed_upstream";
}

/** Validate the fields required to close a case. */
export function validateResolution(
  resolution: InvestigationResolution,
  note: string | null
): { ok: true } | { ok: false; reason: string } {
  if (RESOLUTIONS_REQUIRING_NOTE.includes(resolution) && !note?.trim()) {
    return { ok: false, reason: `a note is required when resolving as ${resolution}` };
  }
  return { ok: true };
}

const map = (r: any): Investigation => ({
  id: r.id,
  deadLetterId: r.dead_letter_id,
  status: r.status,
  assignee: r.assignee ?? null,
  resolution: r.resolution ?? null,
  resolutionNote: r.resolution_note ?? null,
  openedAt: new Date(r.opened_at).toISOString(),
  closedAt: r.closed_at ? new Date(r.closed_at).toISOString() : null,
});

export class DeadLetterInvestigationService {
  constructor(private readonly db: Knex = getDatabase()) {}

  /**
   * Open a case, or return the existing open one.
   *
   * Idempotent per dead-letter entry so two operators opening the same case do
   * not create competing investigations.
   */
  async open(input: { deadLetterId: string; assignee?: string | null }): Promise<Investigation> {
    const existing = await this.db("dead_letter_investigations")
      .where({ dead_letter_id: input.deadLetterId })
      .whereNotIn("status", TERMINAL_STATUSES)
      .first();

    if (existing) return map(existing);

    const [row] = await this.db("dead_letter_investigations")
      .insert({
        dead_letter_id: input.deadLetterId,
        status: "open",
        assignee: input.assignee ?? null,
        opened_at: new Date(),
      })
      .returning("*");

    return map(row);
  }

  async transition(input: {
    investigationId: string;
    to: InvestigationStatus;
    actor: string;
    resolution?: InvestigationResolution;
    note?: string;
  }): Promise<{ ok: true; investigation: Investigation } | { ok: false; reason: string }> {
    return this.db.transaction(async (tx) => {
      const current = await tx("dead_letter_investigations")
        .where({ id: input.investigationId })
        .forUpdate()
        .first();

      if (!current) return { ok: false as const, reason: "investigation not found" };

      const check = validateTransition(current.status, input.to);
      if (!check.ok) return { ok: false as const, reason: (check as { ok: false; reason: string }).reason };

      const closing = isTerminal(input.to);
      if (closing) {
        if (!input.resolution) {
          return { ok: false as const, reason: `a resolution is required to close as ${input.to}` };
        }
        const noteCheck = validateResolution(input.resolution, input.note ?? null);
        if (!noteCheck.ok) return { ok: false as const, reason: (noteCheck as { ok: false; reason: string }).reason };
      }

      const [row] = await tx("dead_letter_investigations")
        .where({ id: input.investigationId })
        .update({
          status: input.to,
          resolution: closing ? input.resolution : null,
          resolution_note: closing ? (input.note ?? null) : null,
          closed_at: closing ? new Date() : null,
          updated_at: new Date(),
        })
        .returning("*");

      await tx("dead_letter_investigation_notes").insert({
        investigation_id: input.investigationId,
        actor: input.actor,
        body: input.note ?? `status changed to ${input.to}`,
        kind: "transition",
      });

      return { ok: true as const, investigation: map(row) };
    });
  }

  async addNote(input: { investigationId: string; actor: string; body: string }): Promise<void> {
    await this.db("dead_letter_investigation_notes").insert({
      investigation_id: input.investigationId,
      actor: input.actor,
      body: input.body,
      kind: "comment",
    });
  }

  async get(investigationId: string): Promise<Investigation | null> {
    const row = await this.db("dead_letter_investigations").where({ id: investigationId }).first();
    return row ? map(row) : null;
  }

  async listOpen(limit = 50): Promise<Investigation[]> {
    const rows = await this.db("dead_letter_investigations")
      .whereNotIn("status", TERMINAL_STATUSES)
      .orderBy("opened_at", "asc")
      .limit(limit);
    return rows.map(map);
  }
}

export const deadLetterInvestigationService = new DeadLetterInvestigationService();
