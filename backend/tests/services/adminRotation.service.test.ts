import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AdminRotationService,
  type AddAdminInput,
  type CreateProposalInput,
  type RemoveAdminInput,
  type ChangeRolesInput,
} from "../../src/services/adminRotation.service.js";

// Mock audit service
vi.mock("../../src/services/audit.service.js", () => ({
  AuditService: {
    getInstance: vi.fn(() => ({
      log: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

// Mock logger
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

type MockRow = Record<string, unknown>;

function createMockKnex() {
  let tableData: Record<string, MockRow[]> = {
    admin_accounts: [],
    admin_rotation_events: [],
    admin_rotation_proposals: [],
  };

  const knex = vi.fn((tableName: string) => {
    let whereFilters: Array<(row: MockRow) => boolean> = [];
    let limitVal: number | null = null;
    let offsetVal: number = 0;
    let orderByCol: string | null = null;
    let orderDir: string = "asc";

    const queryBuilder: any = {
      where: vi.fn((arg1: any, arg2?: any) => {
        if (typeof arg1 === "string" && arg2 !== undefined) {
          whereFilters.push((row) => row[arg1] === arg2);
        } else if (typeof arg1 === "object" && arg1 !== null) {
          whereFilters.push((row) => {
            for (const [k, v] of Object.entries(arg1)) {
              if (row[k] !== v) return false;
            }
            return true;
          });
        }
        return queryBuilder;
      }),
      orderBy: vi.fn((col: string, dir: string = "asc") => {
        orderByCol = col;
        orderDir = dir;
        return queryBuilder;
      }),
      limit: vi.fn((n: number) => {
        limitVal = n;
        return queryBuilder;
      }),
      offset: vi.fn((n: number) => {
        offsetVal = n;
        return queryBuilder;
      }),
      then: (resolve: (v: any) => any, reject?: (e: any) => any) => {
        let rows = tableData[tableName] ?? [];
        for (const filterFn of whereFilters) {
          rows = rows.filter(filterFn);
        }
        if (orderByCol) {
          rows = [...rows].sort((a, b) => {
            const valA = a[orderByCol!] ?? "";
            const valB = b[orderByCol!] ?? "";
            return orderDir === "desc"
              ? String(valB).localeCompare(String(valA))
              : String(valA).localeCompare(String(valB));
          });
        }
        if (offsetVal) rows = rows.slice(offsetVal);
        if (limitVal !== null) rows = rows.slice(0, limitVal);
        return Promise.resolve(rows).then(resolve, reject);
      },
      first: vi.fn(async () => {
        let rows = tableData[tableName] ?? [];
        for (const filterFn of whereFilters) {
          rows = rows.filter(filterFn);
        }
        return rows[0] ?? null;
      }),
      count: vi.fn(() => {
        let rows = tableData[tableName] ?? [];
        for (const filterFn of whereFilters) {
          rows = rows.filter(filterFn);
        }
        const countRes = [{ count: String(rows.length) }];
        const countBuilder: any = {
          first: vi.fn(async () => countRes[0]),
          then: (resolve: (v: any) => any, reject?: (e: any) => any) => {
            return Promise.resolve(countRes).then(resolve, reject);
          },
        };
        return countBuilder;
      }),
      insert: vi.fn((data: any) => {
        const inserted = {
          id: data.id || `rec-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          created_at: new Date(),
          updated_at: new Date(),
          ...data,
        };
        tableData[tableName] = [...(tableData[tableName] ?? []), inserted];

        const insertChain: any = {
          returning: vi.fn(async () => [inserted]),
        };
        return insertChain;
      }),
      update: vi.fn((updateData: any) => ({
        returning: vi.fn(async () => {
          let rows = tableData[tableName] ?? [];
          const matchingIndices: number[] = [];
          rows.forEach((row, idx) => {
            if (whereFilters.every((fn) => fn(row))) {
              matchingIndices.push(idx);
            }
          });

          const updatedRows: MockRow[] = [];
          for (const idx of matchingIndices) {
            const updated = { ...rows[idx], ...updateData, updated_at: new Date() };
            rows[idx] = updated;
            updatedRows.push(updated);
          }
          tableData[tableName] = rows;
          return updatedRows;
        }),
      })),
    };

    return queryBuilder;
  });

  return {
    knex,
    setTableData: (table: string, data: MockRow[]) => {
      tableData[table] = data;
    },
    getTableData: (table: string) => tableData[table] ?? [],
    reset: () => {
      tableData = {
        admin_accounts: [],
        admin_rotation_events: [],
        admin_rotation_proposals: [],
      };
    },
  };
}

const mockDb = createMockKnex();

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: () => mockDb.knex,
}));

describe("AdminRotationService Unit Tests", () => {
  let service: AdminRotationService;

  beforeEach(() => {
    mockDb.reset();
    vi.clearAllMocks();
    service = AdminRotationService.getInstance();
  });

  describe("Admin Account Management", () => {
    it("adds a new admin account with valid roles and audit log", async () => {
      const input: AddAdminInput = {
        address: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
        name: "Alice Security",
        email: "alice@example.com",
        roles: ["super_admin", "operator"],
        addedBy: "GMASTER_ADMIN_ADDR",
      };

      const admin = await service.addAdmin(input);
      expect(admin.id).toBeDefined();
      expect(admin.address).toBe(input.address);
      expect(admin.roles).toEqual(["super_admin", "operator"]);
      expect(admin.isActive).toBe(true);

      const events = mockDb.getTableData("admin_rotation_events");
      expect(events.length).toBe(1);
      expect(events[0].event_type).toBe("added");
    });

    it("rejects duplicate admin address", async () => {
      mockDb.setTableData("admin_accounts", [
        {
          id: "adm-1",
          address: "GEXISTING",
          name: "Existing",
          roles: JSON.stringify(["super_admin"]),
          is_active: true,
          added_by: "ROOT",
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const input: AddAdminInput = {
        address: "GEXISTING",
        name: "Duplicate",
        roles: ["super_admin"],
        addedBy: "ROOT",
      };

      await expect(service.addAdmin(input)).rejects.toThrow("Admin account already exists: GEXISTING");
    });

    it("rejects invalid role assignment", async () => {
      const input = {
        address: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
        name: "Bad Roles",
        roles: ["invalid_role" as any],
        addedBy: "GMASTER_ADMIN_ADDR",
      };

      await expect(service.addAdmin(input)).rejects.toThrow("Invalid role: invalid_role");
    });

    it("prevents removing admin if active count falls below minimum safeguard (2)", async () => {
      mockDb.setTableData("admin_accounts", [
        {
          id: "adm-1",
          address: "GADDR1",
          name: "Admin 1",
          roles: JSON.stringify(["super_admin"]),
          is_active: true,
          added_by: "ROOT",
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: "adm-2",
          address: "GADDR2",
          name: "Admin 2",
          roles: JSON.stringify(["super_admin"]),
          is_active: true,
          added_by: "ROOT",
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const input: RemoveAdminInput = {
        address: "GADDR1",
        removedBy: "GADDR2",
        reason: "Attempting below threshold",
      };

      await expect(service.removeAdmin(input)).rejects.toThrow(
        "Cannot remove admin: minimum admin count (2) would be violated"
      );
    });

    it("allows removing admin when sufficient active admins remain", async () => {
      mockDb.setTableData("admin_accounts", [
        {
          id: "adm-1",
          address: "GADDR1",
          name: "Admin 1",
          roles: JSON.stringify(["super_admin"]),
          is_active: true,
          added_by: "ROOT",
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: "adm-2",
          address: "GADDR2",
          name: "Admin 2",
          roles: JSON.stringify(["super_admin"]),
          is_active: true,
          added_by: "ROOT",
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: "adm-3",
          address: "GADDR3",
          name: "Admin 3",
          roles: JSON.stringify(["super_admin"]),
          is_active: true,
          added_by: "ROOT",
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const input: RemoveAdminInput = {
        address: "GADDR1",
        removedBy: "GADDR2",
        reason: "Routine deactivation",
      };

      const removed = await service.removeAdmin(input);
      expect(removed.isActive).toBe(false);
      expect(removed.deactivatedBy).toBe("GADDR2");
    });

    it("changes admin roles", async () => {
      mockDb.setTableData("admin_accounts", [
        {
          id: "adm-1",
          address: "GADDR1",
          name: "Admin 1",
          roles: JSON.stringify(["super_admin"]),
          is_active: true,
          added_by: "ROOT",
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const input: ChangeRolesInput = {
        address: "GADDR1",
        newRoles: ["operator", "auditor"],
        changedBy: "GROOT",
      };

      const updated = await service.changeRoles(input);
      expect(updated.roles).toEqual(["operator", "auditor"]);
    });

    it("activates an inactive admin account", async () => {
      mockDb.setTableData("admin_accounts", [
        {
          id: "adm-1",
          address: "GADDR1",
          name: "Admin 1",
          roles: JSON.stringify(["super_admin"]),
          is_active: false,
          added_by: "ROOT",
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const activated = await service.activateAdmin("GADDR1", "GROOT");
      expect(activated.isActive).toBe(true);
    });
  });

  describe("Multi-Sig Rotation Proposal Workflow", () => {
    beforeEach(() => {
      mockDb.setTableData("admin_accounts", [
        {
          id: "adm-1",
          address: "GADDR1",
          name: "Admin 1",
          roles: JSON.stringify(["super_admin"]),
          is_active: true,
          added_by: "ROOT",
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: "adm-2",
          address: "GADDR2",
          name: "Admin 2",
          roles: JSON.stringify(["super_admin"]),
          is_active: true,
          added_by: "ROOT",
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: "adm-3",
          address: "GADDR3",
          name: "Admin 3",
          roles: JSON.stringify(["super_admin"]),
          is_active: true,
          added_by: "ROOT",
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);
    });

    it("creates a proposal and auto-approves by proposer", async () => {
      const input: CreateProposalInput = {
        proposalType: "add_admin",
        targetAddress: "GNEW_ADMIN_ADDR",
        proposedBy: "GADDR1",
        proposedChanges: { name: "New Admin", roles: ["operator"] },
        requiredApprovals: 2,
      };

      const proposal = await service.createProposal(input);
      expect(proposal.id).toBeDefined();
      expect(proposal.status).toBe("pending");
      expect(proposal.approvals).toEqual(["GADDR1"]);
      expect(proposal.requiredApprovals).toBe(2);
    });

    it("approves proposal and marks status as approved when quorum is reached", async () => {
      const input: CreateProposalInput = {
        proposalType: "add_admin",
        targetAddress: "GNEW_ADMIN_ADDR",
        proposedBy: "GADDR1",
        proposedChanges: { name: "New Admin", roles: ["super_admin"] },
        requiredApprovals: 2,
      };

      const proposal = await service.createProposal(input);
      const approved = await service.approveProposal(proposal.id, "GADDR2");

      expect(approved.status).toBe("approved");
      expect(approved.approvals).toContain("GADDR1");
      expect(approved.approvals).toContain("GADDR2");

      // Execute proposal
      await service.executeProposal(proposal.id, "GADDR2");

      const newAdmin = await service.getAdminByAddress("GNEW_ADMIN_ADDR");
      expect(newAdmin).not.toBeNull();
      expect(newAdmin?.name).toBe("New Admin");
    });

    it("rejects duplicate approval from the same admin", async () => {
      const proposal = await service.createProposal({
        proposalType: "change_roles",
        targetAddress: "GADDR1",
        proposedBy: "GADDR1",
        proposedChanges: { newRoles: ["operator"] },
        requiredApprovals: 2,
      });

      await expect(service.approveProposal(proposal.id, "GADDR1")).rejects.toThrow(
        "Already approved by this address"
      );
    });

    it("rejects proposal with reason", async () => {
      const proposal = await service.createProposal({
        proposalType: "remove_admin",
        targetAddress: "GADDR3",
        proposedBy: "GADDR1",
        proposedChanges: {},
        requiredApprovals: 2,
      });

      const rejected = await service.rejectProposal(proposal.id, "GADDR2", "Not authorized");
      expect(rejected.status).toBe("rejected");
      expect(rejected.rejectionReason).toBe("Not authorized");
    });
  });

  describe("Query and list methods", () => {
    it("returns list of admins and rotation proposals", async () => {
      mockDb.setTableData("admin_accounts", [
        {
          id: "adm-1",
          address: "G1",
          name: "Admin 1",
          roles: JSON.stringify(["super_admin"]),
          is_active: true,
          added_by: "ROOT",
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const admins = await service.listAdmins();
      expect(admins.length).toBe(1);
      expect(admins[0].address).toBe("G1");

      const proposals = await service.listProposals();
      expect(Array.isArray(proposals)).toBe(true);

      const events = await service.getRotationEvents();
      expect(Array.isArray(events)).toBe(true);
    });
  });
});
