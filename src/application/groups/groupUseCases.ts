import { randomUUID } from "node:crypto";
import type { AppContainer } from "@ports/context";
import type { DeviceGroup, EscalationStep } from "@domain/entities";

export async function createGroup(
  app: AppContainer,
  tenantId: string,
  actorUserId: string,
  input: { name: string; escalationChain?: EscalationStep[] }
): Promise<DeviceGroup> {
  const now = app.clock.nowIso();
  const group: DeviceGroup = {
    id: randomUUID(),
    tenantId,
    name: input.name,
    escalationChain: input.escalationChain ?? [],
    createdAt: now,
    updatedAt: now,
  };
  const created = await app.repos.group.create(group);

  await app.repos.audit.record({
    tenantId,
    userId: actorUserId,
    action: "group.create",
    entityType: "device_group",
    entityId: created.id,
    detail: { name: created.name },
    createdAt: now,
  });

  return created;
}

export async function updateGroup(
  app: AppContainer,
  tenantId: string,
  actorUserId: string,
  groupId: string,
  patch: Partial<Pick<DeviceGroup, "name" | "escalationChain">>
): Promise<DeviceGroup | null> {
  const updated = await app.repos.group.update(tenantId, groupId, patch);
  if (!updated) return null;

  await app.repos.audit.record({
    tenantId,
    userId: actorUserId,
    action: "group.update",
    entityType: "device_group",
    entityId: groupId,
    detail: { patch: Object.keys(patch) },
    createdAt: app.clock.nowIso(),
  });

  return updated;
}

export async function deleteGroup(app: AppContainer, tenantId: string, actorUserId: string, groupId: string): Promise<boolean> {
  const deleted = await app.repos.group.delete(tenantId, groupId);
  if (deleted) {
    await app.repos.audit.record({
      tenantId,
      userId: actorUserId,
      action: "group.delete",
      entityType: "device_group",
      entityId: groupId,
      detail: null,
      createdAt: app.clock.nowIso(),
    });
  }
  return deleted;
}
