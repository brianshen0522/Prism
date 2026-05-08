import { prism } from '../db/prism';

export const RESTRICT_USER_TRAFFIC_SETTING = 'restrict_user_traffic_to_own';

export async function getBooleanSetting(key: string, defaultValue: boolean): Promise<boolean> {
  const row = await prism.systemSetting.findUnique({ where: { key } });
  if (!row) return defaultValue;

  const value = row.value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['false', '0', 'no', 'off'].includes(value)) return false;
  return defaultValue;
}

export async function shouldRestrictUserTrafficToOwn(): Promise<boolean> {
  return getBooleanSetting(RESTRICT_USER_TRAFFIC_SETTING, true);
}

export async function canRoleViewAllTraffic(role: string): Promise<boolean> {
  if (role === 'admin' || role === 'monitor') return true;
  if (role !== 'user' && role !== 'oauth2') return false;
  return !(await shouldRestrictUserTrafficToOwn());
}
