<script setup lang="ts">
import { getScrollOffset, onContentUpdated, useData } from 'vitepress'
import {
  getHeaders,
  resolveTitle,
} from 'vitepress/dist/client/theme-default/composables/outline.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import OutlineTree from './OutlineTree.vue'

type OutlineItem = {
  element?: HTMLElement
  title: string
  link: string
  level: number
  children?: OutlineItem[]
}

const { frontmatter, theme } = useData()

const headers = shallowRef<OutlineItem[]>([])
const container = ref<HTMLElement | null>(null)
const content = ref<HTMLElement | null>(null)
const marker = ref<HTMLElement | null>(null)
const activeHash = ref<string | null>(null)
const manualOverrides = ref<Record<string, boolean>>({})
let scrollFrame = 0
let markerFrame = 0
let markerTrackingUntil = 0

const outlineTitle = computed(() => {
  const title = resolveTitle(theme.value as never)
  return title === 'On this page' ? '本页目录' : title
})

const activeTopLevelLink = computed(() => findTopLevelOwner(headers.value, activeHash.value))
const shouldFollowActiveHash = computed(
  () =>
    Boolean(activeHash.value) &&
    (!activeTopLevelLink.value || expandedLinks.value.includes(activeTopLevelLink.value)),
)
const markerTargetLink = computed(() =>
  shouldFollowActiveHash.value ? activeHash.value : activeTopLevelLink.value,
)

const expandedLinks = computed(() => {
  const links = new Set<string>()

  Object.entries(manualOverrides.value).forEach(([link, expanded]) => {
    if (expanded) {
      links.add(link)
    }
  })

  if (activeTopLevelLink.value) {
    if (manualOverrides.value[activeTopLevelLink.value] !== false) {
      links.add(activeTopLevelLink.value)
    }
  }

  return Array.from(links)
})

const hasOutline = computed(() => headers.value.length > 0)

onContentUpdated(async () => {
  headers.value = getHeaders(frontmatter.value.outline ?? theme.value.outline) as OutlineItem[]
  manualOverrides.value = {}

  await nextTick()
  syncActiveHashFromScroll()
  trackMarkerPosition()
})

watch(activeHash, async () => {
  await nextTick()
  trackMarkerPosition()
})

watch(
  () => expandedLinks.value.join('|'),
  async () => {
    await nextTick()
    trackMarkerPosition(320)
  },
)

watch(activeTopLevelLink, (nextLink, previousLink) => {
  if (!nextLink || nextLink === previousLink) {
    return
  }

  const nextOverrides = { ...manualOverrides.value }
  delete nextOverrides[nextLink]
  manualOverrides.value = nextOverrides

  void nextTick().then(() => {
    trackMarkerPosition(320)
  })
})

onMounted(() => {
  window.addEventListener('scroll', scheduleSyncActiveHash, { passive: true })
  window.addEventListener('resize', scheduleSyncActiveHash)
  scheduleSyncActiveHash()
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', scheduleSyncActiveHash)
  window.removeEventListener('resize', scheduleSyncActiveHash)

  if (scrollFrame) {
    window.cancelAnimationFrame(scrollFrame)
  }

  if (markerFrame) {
    window.cancelAnimationFrame(markerFrame)
  }
})

function scheduleSyncActiveHash() {
  if (scrollFrame) {
    return
  }

  scrollFrame = window.requestAnimationFrame(() => {
    scrollFrame = 0
    syncActiveHashFromScroll()
  })
}

function syncActiveHashFromScroll() {
  const flattenedHeaders = flattenHeaders(headers.value)
    .map((item) => ({
      link: item.link,
      top: item.element ? getAbsoluteTop(item.element) : Number.NaN,
    }))
    .filter(({ top }) => !Number.isNaN(top))
    .sort((left, right) => left.top - right.top)

  if (!flattenedHeaders.length) {
    activeHash.value = null
    return
  }

  const scrollY = window.scrollY
  const innerHeight = window.innerHeight
  const offsetHeight = document.body.offsetHeight
  const isBottom = Math.abs(scrollY + innerHeight - offsetHeight) < 1

  if (scrollY < 1) {
    activeHash.value = null
    return
  }

  if (isBottom) {
    activeHash.value = flattenedHeaders[flattenedHeaders.length - 1]?.link ?? null
    return
  }

  let nextActiveHash: string | null = null

  for (const { link, top } of flattenedHeaders) {
    if (top > scrollY + getScrollOffset() + 4) {
      break
    }

    nextActiveHash = link
  }

  activeHash.value = nextActiveHash
}

function syncMarker() {
  if (!marker.value || !container.value || !content.value) {
    return
  }

  const activeLink =
    (markerTargetLink.value ? findOutlineLinkByHref(markerTargetLink.value) : null) ??
    container.value.querySelector<HTMLAnchorElement>('.outline-link.active')

  if (!activeLink) {
    marker.value.style.top = '33px'
    marker.value.style.opacity = '0'
    return
  }

  const contentRect = content.value.getBoundingClientRect()
  const activeRect = activeLink.getBoundingClientRect()
  const relativeTop = activeRect.top - contentRect.top

  marker.value.style.top = `${relativeTop + 7}px`
  marker.value.style.opacity = '1'
}

function trackMarkerPosition(durationMs = 0) {
  if (durationMs <= 0) {
    syncMarker()
    return
  }

  markerTrackingUntil = Math.max(markerTrackingUntil, performance.now() + durationMs)

  if (markerFrame) {
    return
  }

  const step = () => {
    markerFrame = 0
    syncMarker()

    if (performance.now() < markerTrackingUntil) {
      markerFrame = window.requestAnimationFrame(step)
    }
  }

  markerFrame = window.requestAnimationFrame(step)
}

function findOutlineLinkByHref(targetHref: string) {
  const links = container.value?.querySelectorAll<HTMLAnchorElement>('.outline-link')
  if (!links) {
    return null
  }

  for (const link of Array.from(links)) {
    if (link.getAttribute('href') === targetHref) {
      return link
    }
  }

  return null
}

function toggleGroup(link: string) {
  manualOverrides.value = {
    ...manualOverrides.value,
    [link]: !expandedLinks.value.includes(link),
  }
}

function findTopLevelOwner(items: OutlineItem[], target: string | null): string | null {
  if (!target) {
    return null
  }

  for (const item of items) {
    if (item.link === target || containsLink(item.children ?? [], target)) {
      return item.link
    }
  }

  return null
}

function containsLink(items: OutlineItem[], target: string): boolean {
  for (const item of items) {
    if (item.link === target || containsLink(item.children ?? [], target)) {
      return true
    }
  }

  return false
}

function flattenHeaders(items: OutlineItem[]): OutlineItem[] {
  const flattened: OutlineItem[] = []

  for (const item of items) {
    flattened.push(item)

    if (item.children?.length) {
      flattened.push(...flattenHeaders(item.children))
    }
  }

  return flattened
}

function getAbsoluteTop(element: HTMLElement) {
  let offsetTop = 0
  let current: HTMLElement | null = element

  while (current && current !== document.body) {
    offsetTop += current.offsetTop
    current = current.offsetParent as HTMLElement | null
  }

  return current ? offsetTop : Number.NaN
}
</script>

<template>
  <nav
    ref="container"
    aria-labelledby="doc-outline-aria-label"
    class="VPDocAsideOutline wiki-doc-aside-outline"
    :class="{ 'has-outline': hasOutline }"
  >
    <div ref="content" class="content">
      <div ref="marker" class="outline-marker" />

      <div
        id="doc-outline-aria-label"
        aria-level="2"
        class="outline-title"
        role="heading"
      >
        {{ outlineTitle }}
      </div>

      <OutlineTree
        :headers="headers"
        :expanded-links="expandedLinks"
        :active-hash="activeHash"
        :active-group-link="activeTopLevelLink"
        :root="true"
        @toggle-group="toggleGroup"
      />
    </div>
  </nav>
</template>

<style scoped>
.VPDocAsideOutline {
  display: none;
}

.VPDocAsideOutline.has-outline {
  display: block;
}

.content {
  position: relative;
  border-left: 1px solid var(--vp-c-divider);
  padding-left: 16px;
  font-size: 13px;
  font-weight: 500;
}

.outline-marker {
  position: absolute;
  top: 32px;
  left: -1px;
  z-index: 0;
  opacity: 0;
  width: 2px;
  height: 18px;
  border-radius: 2px;
  background-color: var(--vp-c-brand-1);
  transition:
    top 0.25s cubic-bezier(0, 1, 0.5, 1),
    background-color 0.5s,
    opacity 0.25s;
}

.outline-title {
  line-height: 32px;
  font-size: 14px;
  font-weight: 600;
}
</style>
