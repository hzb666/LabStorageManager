import { announcementAPI } from '@/api/client'

export const PUBLIC_ANNOUNCEMENTS_QUERY_KEY = ['announcements', 'public'] as const
export const PUBLIC_ANNOUNCEMENTS_STALE_TIME_MS = 60 * 1000
const PUBLIC_ANNOUNCEMENTS_GC_TIME_MS = 10 * 60 * 1000

export function getPublicAnnouncementsQueryOptions() {
  return {
    queryKey: PUBLIC_ANNOUNCEMENTS_QUERY_KEY,
    queryFn: async () => {
      const response = await announcementAPI.getPublic()
      return response.data
    },
    staleTime: PUBLIC_ANNOUNCEMENTS_STALE_TIME_MS,
    gcTime: PUBLIC_ANNOUNCEMENTS_GC_TIME_MS,
    refetchOnWindowFocus: false,
  }
}
