import { AppError, PERMISSIONS } from '@cl/contract';

export type Permission = (typeof PERMISSIONS)[number];
export interface Actor {
  id: string;
  permissions: Permission[];
}

/** No login yet: every request is the `local` actor. LOCAL_ACTOR_PERMISSIONS can narrow what it may do. */
export function localActor(env: Record<string, string | undefined> = process.env): Actor {
  const raw = env.LOCAL_ACTOR_PERMISSIONS;
  const permissions = raw === undefined ? [...PERMISSIONS] : (raw.split(',').map((s) => s.trim()).filter((p) => (PERMISSIONS as readonly string[]).includes(p)) as Permission[]);
  return { id: 'local', permissions };
}
export function requirePermission(actor: Actor, permission: Permission) {
  if (!actor.permissions.includes(permission)) throw new AppError('FORBIDDEN', `Thao tác này cần quyền ${permission}. Tác nhân "${actor.id}" hiện có: ${actor.permissions.join(', ') || '(không có)'}.`, 403, { required: permission });
}
