import crypto from "crypto";
import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";
import { AuditService } from "./audit.service.js";

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

export type AdminRole = "super_admin" | "operator" | "auditor" | "viewer";

export type AdminRotationEventType =
  | "added"
  | "removed"
  | "activated"
  | "deactivated"
  | "role_changed";

export type ProposalType = "add_admin" | "remove_admin" | "change_roles";

export type ProposalStatus = "pending" | "approved" | "rejected" | "executed" | "expired";

export interface AdminAccount {
  id: string;
  address: string;
  name: string;
  email: string | null;
  roles: AdminRole[];
  isActive: boolean;
  addedBy: string;
  activatedAt: Date | null;
  deactivatedAt: Date | null;
  deactivatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminRotationEvent {
  id: string;
  eventType: AdminRotationEventType;
  adminAddress: string;
  actorAddress: string;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface AdminRotationProposal {
  id: string;
  proposalType: ProposalType;
  targetAddress: string;
  proposedBy: string;
  proposedChanges: Record<string, unknown>;
  status: ProposalStatus;
  approvals: string[];
  requiredApprovals: number;
  expiresAt: Date;
  executedAt: Date | null;
  executedBy: string | null;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AddAdminInput {
  address: string;
  name: string;
  email?: string;
  roles: AdminRole[];
  addedBy: string;
  reason?: string;
}

export interface RemoveAdminInput {
  address: string;
  removedBy: string;
  reason?: string;
}

export interface ChangeRolesInput {
  address: string;
  newRoles: AdminRole[];
  changedBy: string;
  reason?: string;
}

export interface CreateProposalInput {
  proposalType: ProposalType;
  targetAddress: string;
  proposedBy: string;
  proposedChanges: Record<string, unknown>;
  requiredApprovals?: number;
  expiresInHours?: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const MINIMUM_ADMIN_COUNT = 2;
const DEFAULT_REQUIRED_APPROVALS = 2;
const DEFAULT_PROPOSAL_EXPIRY_HOURS = 72;

// =============================================================================
// ADMIN ROTATION SERVICE
// =============================================================================

export class AdminRotationService {
  private static instance: AdminRotationService;
  private auditService: AuditService;

  private constructor() {
    this.auditService = AuditService.getInstance();
  }

  public static getInstance(): AdminRotationService {
    if (!AdminRotationService.instance) {
      AdminRotationService.instance = new AdminRotationService();
    }
    return AdminRotationService.instance;
  }

  // ---------------------------------------------------------------------------
  // ADMIN MANAGEMENT
  // ---------------------------------------------------------------------------

  /**
   * Add a new admin account with safeguards
   */
  public async addAdmin(input: AddAdminInput): Promise<AdminAccount> {
    const db = getDatabase();

    // Check if admin already exists
    const existing = await db("admin_accounts")
      .where({ address: input.address })
      .first();

    if (existing) {
      throw new Error(`Admin account already exists: ${input.address}`);
    }

    // Validate roles
    this.validateRoles(input.roles);

    // Create admin account
    const [row] = await db("admin_accounts")
      .insert({
        id: crypto.randomUUID(),
        address: input.address,
        name: input.name,
        email: input.email ?? null,
        roles: JSON.stringify(input.roles),
        is_active: true,
        added_by: input.addedBy,
        activated_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning("*");

    const admin = this.mapAdminRow(row);

    // Log rotation event
    await this.logRotationEvent({
      eventType: "added",
      adminAddress: admin.address,
      actorAddress: input.addedBy,
      afterState: { roles: admin.roles, isActive: admin.isActive },
      reason: input.reason ?? null,
    });

    // Log to audit service
    await this.auditService.log({
      action: "admin.user_permission_changed",
      actorId: input.addedBy,
      actorType: "user",
      resourceType: "admin_account",
      resourceId: admin.id,
      after: { address: admin.address, roles: admin.roles },
      severity: "critical",
    });

    logger.info(
      { adminAddress: admin.address, addedBy: input.addedBy, roles: admin.roles },
      "Admin account added"
    );

    return admin;
  }

  /**
   * Remove an admin account with minimum count safeguard
   */
  public async removeAdmin(input: RemoveAdminInput): Promise<AdminAccount> {
    const db = getDatabase();

    // Check minimum admin count
    await this.enforceMinimumAdminCount();

    // Get admin account
    const admin = await this.getAdminByAddress(input.address);
    if (!admin) {
      throw new Error(`Admin account not found: ${input.address}`);
    }

    if (!admin.isActive) {
      throw new Error(`Admin account is already inactive: ${input.address}`);
    }

    // Deactivate admin
    const [updated] = await db("admin_accounts")
      .where({ address: input.address })
      .update({
        is_active: false,
        deactivated_at: new Date(),
        deactivated_by: input.removedBy,
        updated_at: new Date(),
      })
      .returning("*");

    const updatedAdmin = this.mapAdminRow(updated);

    // Log rotation event
    await this.logRotationEvent({
      eventType: "removed",
      adminAddress: admin.address,
      actorAddress: input.removedBy,
      beforeState: { roles: admin.roles, isActive: admin.isActive },
      afterState: { roles: updatedAdmin.roles, isActive: updatedAdmin.isActive },
      reason: input.reason ?? null,
    });

    // Log to audit service
    await this.auditService.log({
      action: "admin.user_permission_changed",
      actorId: input.removedBy,
      actorType: "user",
      resourceType: "admin_account",
      resourceId: admin.id,
      before: { address: admin.address, isActive: true },
      after: { address: admin.address, isActive: false },
      severity: "critical",
    });

    logger.info(
      { adminAddress: admin.address, removedBy: input.removedBy },
      "Admin account removed"
    );

    return updatedAdmin;
  }

  /**
   * Change admin roles
   */
  public async changeRoles(input: ChangeRolesInput): Promise<AdminAccount> {
    const db = getDatabase();

    // Validate roles
    this.validateRoles(input.newRoles);

    // Get admin account
    const admin = await this.getAdminByAddress(input.address);
    if (!admin) {
      throw new Error(`Admin account not found: ${input.address}`);
    }

    // Update roles
    const [updated] = await db("admin_accounts")
      .where({ address: input.address })
      .update({
        roles: JSON.stringify(input.newRoles),
        updated_at: new Date(),
      })
      .returning("*");

    const updatedAdmin = this.mapAdminRow(updated);

    // Log rotation event
    await this.logRotationEvent({
      eventType: "role_changed",
      adminAddress: admin.address,
      actorAddress: input.changedBy,
      beforeState: { roles: admin.roles },
      afterState: { roles: updatedAdmin.roles },
      reason: input.reason ?? null,
    });

    // Log to audit service
    await this.auditService.log({
      action: "admin.user_permission_changed",
      actorId: input.changedBy,
      actorType: "user",
      resourceType: "admin_account",
      resourceId: admin.id,
      before: { roles: admin.roles },
      after: { roles: updatedAdmin.roles },
      severity: "critical",
    });

    logger.info(
      { adminAddress: admin.address, oldRoles: admin.roles, newRoles: updatedAdmin.roles },
      "Admin roles changed"
    );

    return updatedAdmin;
  }

  /**
   * Activate a deactivated admin account
   */
  public async activateAdmin(address: string, activatedBy: string): Promise<AdminAccount> {
    const db = getDatabase();

    const admin = await this.getAdminByAddress(address);
    if (!admin) {
      throw new Error(`Admin account not found: ${address}`);
    }

    if (admin.isActive) {
      throw new Error(`Admin account is already active: ${address}`);
    }

    const [updated] = await db("admin_accounts")
      .where({ address })
      .update({
        is_active: true,
        activated_at: new Date(),
        deactivated_at: null,
        deactivated_by: null,
        updated_at: new Date(),
      })
      .returning("*");

    const updatedAdmin = this.mapAdminRow(updated);

    await this.logRotationEvent({
      eventType: "activated",
      adminAddress: address,
      actorAddress: activatedBy,
      beforeState: { isActive: false },
      afterState: { isActive: true },
      reason: null,
    });

    logger.info({ adminAddress: address, activatedBy }, "Admin account activated");

    return updatedAdmin;
  }

  // ---------------------------------------------------------------------------
  // PROPOSAL SYSTEM (Multi-sig workflow)
  // ---------------------------------------------------------------------------

  /**
   * Create a rotation proposal that requires multiple approvals
   */
  public async createProposal(input: CreateProposalInput): Promise<AdminRotationProposal> {
    const db = getDatabase();

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + (input.expiresInHours ?? DEFAULT_PROPOSAL_EXPIRY_HOURS));

    const [row] = await db("admin_rotation_proposals")
      .insert({
        id: crypto.randomUUID(),
        proposal_type: input.proposalType,
        target_address: input.targetAddress,
        proposed_by: input.proposedBy,
        proposed_changes: JSON.stringify(input.proposedChanges),
        status: "pending",
        approvals: JSON.stringify([input.proposedBy]), // Proposer auto-approves
        required_approvals: input.requiredApprovals ?? DEFAULT_REQUIRED_APPROVALS,
        expires_at: expiresAt,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning("*");

    const proposal = this.mapProposalRow(row);

    logger.info(
      { proposalId: proposal.id, proposalType: proposal.proposalType, targetAddress: proposal.targetAddress },
      "Admin rotation proposal created"
    );

    return proposal;
  }

  /**
   * Approve a rotation proposal
   */
  public async approveProposal(proposalId: string, approverAddress: string): Promise<AdminRotationProposal> {
    const db = getDatabase();

    const proposal = await this.getProposalById(proposalId);
    if (!proposal) {
      throw new Error(`Proposal not found: ${proposalId}`);
    }

    if (proposal.status !== "pending") {
      throw new Error(`Proposal is not pending: ${proposal.status}`);
    }

    if (new Date() > proposal.expiresAt) {
      await this.expireProposal(proposalId);
      throw new Error("Proposal has expired");
    }

    if (proposal.approvals.includes(approverAddress)) {
      throw new Error("Already approved by this address");
    }

    const newApprovals = [...proposal.approvals, approverAddress];
    const isApproved = newApprovals.length >= proposal.requiredApprovals;

    const [updated] = await db("admin_rotation_proposals")
      .where({ id: proposalId })
      .update({
        approvals: JSON.stringify(newApprovals),
        status: isApproved ? "approved" : "pending",
        updated_at: new Date(),
      })
      .returning("*");

    const updatedProposal = this.mapProposalRow(updated);

    logger.info(
      { proposalId, approverAddress, totalApprovals: newApprovals.length, isApproved },
      "Proposal approval recorded"
    );

    return updatedProposal;
  }

  /**
   * Execute an approved proposal
   */
  public async executeProposal(proposalId: string, executorAddress: string): Promise<void> {
    const db = getDatabase();

    const proposal = await this.getProposalById(proposalId);
    if (!proposal) {
      throw new Error(`Proposal not found: ${proposalId}`);
    }

    if (proposal.status !== "approved") {
      throw new Error(`Proposal is not approved: ${proposal.status}`);
    }

    if (new Date() > proposal.expiresAt) {
      await this.expireProposal(proposalId);
      throw new Error("Proposal has expired");
    }

    // Execute based on proposal type
    switch (proposal.proposalType) {
      case "add_admin":
        await this.addAdmin({
          address: proposal.targetAddress,
          name: (proposal.proposedChanges.name as string) ?? "Unknown",
          email: proposal.proposedChanges.email as string | undefined,
          roles: (proposal.proposedChanges.roles as AdminRole[]) ?? ["viewer"],
          addedBy: executorAddress,
          reason: "Executed from approved proposal",
        });
        break;

      case "remove_admin":
        await this.removeAdmin({
          address: proposal.targetAddress,
          removedBy: executorAddress,
          reason: "Executed from approved proposal",
        });
        break;

      case "change_roles":
        await this.changeRoles({
          address: proposal.targetAddress,
          newRoles: (proposal.proposedChanges.roles as AdminRole[]) ?? ["viewer"],
          changedBy: executorAddress,
          reason: "Executed from approved proposal",
        });
        break;

      default:
        throw new Error(`Unknown proposal type: ${proposal.proposalType}`);
    }

    // Mark proposal as executed
    await db("admin_rotation_proposals")
      .where({ id: proposalId })
      .update({
        status: "executed",
        executed_at: new Date(),
        executed_by: executorAddress,
        updated_at: new Date(),
      });

    logger.info({ proposalId, executorAddress }, "Proposal executed successfully");
  }

  /**
   * Reject a proposal
   */
  public async rejectProposal(proposalId: string, rejectorAddress: string, reason: string): Promise<AdminRotationProposal> {
    const db = getDatabase();

    const [updated] = await db("admin_rotation_proposals")
      .where({ id: proposalId, status: "pending" })
      .update({
        status: "rejected",
        rejection_reason: reason,
        updated_at: new Date(),
      })
      .returning("*");

    if (!updated) {
      throw new Error("Proposal not found or not in pending status");
    }

    logger.info({ proposalId, rejectorAddress, reason }, "Proposal rejected");

    return this.mapProposalRow(updated);
  }

  // ---------------------------------------------------------------------------
  // QUERY METHODS
  // ---------------------------------------------------------------------------

  public async getAdminByAddress(address: string): Promise<AdminAccount | null> {
    const db = getDatabase();
    const row = await db("admin_accounts").where({ address }).first();
    return row ? this.mapAdminRow(row) : null;
  }

  public async listAdmins(activeOnly = false): Promise<AdminAccount[]> {
    const db = getDatabase();
    let query = db("admin_accounts");

    if (activeOnly) {
      query = query.where({ is_active: true });
    }

    const rows = await query.orderBy("created_at", "desc");
    return rows.map(this.mapAdminRow);
  }

  public async getActiveAdminCount(): Promise<number> {
    const db = getDatabase();
    const result = await db("admin_accounts")
      .where({ is_active: true })
      .count("* as count")
      .first();
    return Number(result?.count ?? 0);
  }

  public async getRotationEvents(adminAddress?: string, limit = 100): Promise<AdminRotationEvent[]> {
    const db = getDatabase();
    let query = db("admin_rotation_events");

    if (adminAddress) {
      query = query.where({ admin_address: adminAddress });
    }

    const rows = await query.orderBy("created_at", "desc").limit(limit);
    return rows.map(this.mapEventRow);
  }

  public async getProposalById(id: string): Promise<AdminRotationProposal | null> {
    const db = getDatabase();
    const row = await db("admin_rotation_proposals").where({ id }).first();
    return row ? this.mapProposalRow(row) : null;
  }

  public async listProposals(status?: ProposalStatus): Promise<AdminRotationProposal[]> {
    const db = getDatabase();
    let query = db("admin_rotation_proposals");

    if (status) {
      query = query.where({ status });
    }

    const rows = await query.orderBy("created_at", "desc");
    return rows.map(this.mapProposalRow);
  }

  // ---------------------------------------------------------------------------
  // SAFEGUARDS
  // ---------------------------------------------------------------------------

  private async enforceMinimumAdminCount(): Promise<void> {
    const activeCount = await this.getActiveAdminCount();

    if (activeCount <= MINIMUM_ADMIN_COUNT) {
      throw new Error(
        `Cannot remove admin: minimum admin count (${MINIMUM_ADMIN_COUNT}) would be violated. Current active admins: ${activeCount}`
      );
    }
  }

  private validateRoles(roles: AdminRole[]): void {
    const validRoles: AdminRole[] = ["super_admin", "operator", "auditor", "viewer"];

    for (const role of roles) {
      if (!validRoles.includes(role)) {
        throw new Error(`Invalid role: ${role}`);
      }
    }

    if (roles.length === 0) {
      throw new Error("At least one role is required");
    }
  }

  // ---------------------------------------------------------------------------
  // INTERNAL HELPERS
  // ---------------------------------------------------------------------------

  private async logRotationEvent(params: {
    eventType: AdminRotationEventType;
    adminAddress: string;
    actorAddress: string;
    beforeState?: Record<string, unknown> | null;
    afterState?: Record<string, unknown> | null;
    reason?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const db = getDatabase();

    await db("admin_rotation_events").insert({
      id: crypto.randomUUID(),
      event_type: params.eventType,
      admin_address: params.adminAddress,
      actor_address: params.actorAddress,
      before_state: params.beforeState ? JSON.stringify(params.beforeState) : null,
      after_state: params.afterState ? JSON.stringify(params.afterState) : null,
      reason: params.reason ?? null,
      metadata: JSON.stringify(params.metadata ?? {}),
      created_at: new Date(),
    });
  }

  private async expireProposal(proposalId: string): Promise<void> {
    const db = getDatabase();
    await db("admin_rotation_proposals")
      .where({ id: proposalId })
      .update({ status: "expired", updated_at: new Date() });
  }

  private mapAdminRow(row: AdminAccountRow): AdminAccount {
    return {
      id: row.id,
      address: row.address,
      name: row.name,
      email: row.email,
      roles: parseJsonField<AdminRole[]>(row.roles, []),
      isActive: Boolean(row.is_active),
      addedBy: row.added_by,
      activatedAt: parseNullableDateField(row.activated_at),
      deactivatedAt: parseNullableDateField(row.deactivated_at),
      deactivatedBy: row.deactivated_by,
      createdAt: parseDateField(row.created_at),
      updatedAt: parseDateField(row.updated_at),
    };
  }

  private mapEventRow(row: AdminRotationEventRow): AdminRotationEvent {
    return {
      id: row.id,
      eventType: row.event_type,
      adminAddress: row.admin_address,
      actorAddress: row.actor_address,
      beforeState: parseJsonField<Record<string, unknown> | null>(row.before_state, null),
      afterState: parseJsonField<Record<string, unknown> | null>(row.after_state, null),
      reason: row.reason,
      metadata: parseJsonField<Record<string, unknown>>(row.metadata, {}),
      createdAt: parseDateField(row.created_at),
    };
  }

  private mapProposalRow(row: AdminRotationProposalRow): AdminRotationProposal {
    return {
      id: row.id,
      proposalType: row.proposal_type,
      targetAddress: row.target_address,
      proposedBy: row.proposed_by,
      proposedChanges: parseJsonField<Record<string, unknown>>(row.proposed_changes, {}),
      status: row.status,
      approvals: parseJsonField<string[]>(row.approvals, []),
      requiredApprovals: Number(row.required_approvals),
      expiresAt: parseDateField(row.expires_at),
      executedAt: parseNullableDateField(row.executed_at),
      executedBy: row.executed_by,
      rejectionReason: row.rejection_reason,
      createdAt: parseDateField(row.created_at),
      updatedAt: parseDateField(row.updated_at),
    };
  }
}

export interface AdminAccountRow {
  id: string;
  address: string;
  name: string;
  email: string | null;
  roles: string | string[];
  is_active: boolean | number;
  added_by: string;
  activated_at: Date | string | null;
  deactivated_at: Date | string | null;
  deactivated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface AdminRotationEventRow {
  id: string;
  event_type: AdminRotationEventType;
  admin_address: string;
  actor_address: string;
  before_state: string | Record<string, unknown> | null;
  after_state: string | Record<string, unknown> | null;
  reason: string | null;
  metadata: string | Record<string, unknown>;
  created_at: Date | string;
}

export interface AdminRotationProposalRow {
  id: string;
  proposal_type: RotationProposalType;
  target_address: string;
  proposed_by: string;
  proposed_changes: string | Record<string, unknown>;
  status: RotationProposalStatus;
  approvals: string | string[];
  required_approvals: number;
  expires_at: Date | string;
  executed_at: Date | string | null;
  executed_by: string | null;
  rejection_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function parseJsonField<T>(field: unknown, fallback: T): T {
  if (field === null || field === undefined) return fallback;
  if (typeof field === "object") return field as T;
  if (typeof field === "string") {
    try {
      return JSON.parse(field) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function parseDateField(field: Date | string | number | unknown): Date {
  if (field instanceof Date) return field;
  if (typeof field === "string" || typeof field === "number") return new Date(field);
  return new Date();
}

function parseNullableDateField(field: Date | string | number | null | undefined): Date | null {
  if (!field) return null;
  if (field instanceof Date) return field;
  return new Date(field as string | number);
}


