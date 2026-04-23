import { UserRoles, type UserRole } from '@/lib/constants'

export function canWriteNonPublicData(role: UserRole | null | undefined): boolean {
  return Boolean(role && role !== UserRoles.PUBLIC)
}
