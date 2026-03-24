<script setup lang="ts">
type OutlineItem = {
  title: string
  link: string
  level: number
  children?: OutlineItem[]
}

const props = withDefaults(
  defineProps<{
    headers: OutlineItem[]
    root?: boolean
    activeHash?: string | null
    activeGroupLink?: string | null
    expandedLinks?: string[]
  }>(),
  {
    root: false,
    activeHash: null,
    activeGroupLink: null,
    expandedLinks: () => [],
  },
)

const emit = defineEmits<{
  toggleGroup: [link: string]
}>()

function onClick(event: Event) {
  const element = event.currentTarget as HTMLAnchorElement
  const id = element.href.split('#')[1]
  const heading = document.getElementById(decodeURIComponent(id))
  heading?.focus({ preventScroll: true })
}

function isExpanded(link: string) {
  return props.expandedLinks.includes(link)
}

function isActive(link: string) {
  if (props.root) {
    return props.activeGroupLink === link
  }

  return props.activeHash === link
}
</script>

<template>
  <ul class="VPDocOutlineItem wiki-doc-outline" :class="root ? 'root' : 'nested'">
    <li
      v-for="{ children = [], link, title } in headers"
      :key="link"
      class="wiki-doc-outline-item"
      :class="{ 'is-expanded': root && isExpanded(link) }"
    >
      <template v-if="root">
        <div class="wiki-outline-heading">
          <a
            class="outline-link wiki-outline-root-link"
            :class="{ active: isActive(link) }"
            :href="link"
            :title="title"
            @click="onClick($event)"
          >
            {{ title }}
          </a>

          <button
            v-if="children.length"
            type="button"
            class="wiki-outline-toggle"
            :aria-expanded="isExpanded(link) ? 'true' : 'false'"
            aria-label="切换当前目录"
            @click="emit('toggleGroup', link)"
          >
            <span class="wiki-outline-toggle-icon" aria-hidden="true"></span>
          </button>
        </div>

        <div
          v-if="children.length"
          class="wiki-outline-children"
          :class="{ 'is-expanded': isExpanded(link) }"
        >
          <div class="wiki-outline-children-inner">
            <Menu
              :headers="children"
              :expanded-links="expandedLinks"
              :active-hash="activeHash"
              :active-group-link="activeGroupLink"
              @toggle-group="emit('toggleGroup', $event)"
            />
          </div>
        </div>
      </template>

      <template v-else>
        <a
          class="outline-link"
          :class="{ active: isActive(link) }"
          :href="link"
          :title="title"
          @click="onClick($event)"
        >
          {{ title }}
        </a>

        <Menu
          v-if="children.length"
          :headers="children"
          :expanded-links="expandedLinks"
          :active-hash="activeHash"
          :active-group-link="activeGroupLink"
          @toggle-group="emit('toggleGroup', $event)"
        />
      </template>
    </li>
  </ul>
</template>

<style scoped>
.root {
  position: relative;
  z-index: 1;
}

.nested {
  padding-right: 16px;
  padding-left: 16px;
}

.wiki-outline-heading {
  position: relative;
}

.wiki-outline-heading > .outline-link {
  padding-right: 18px;
}

.outline-link {
  display: block;
  overflow: hidden;
  color: var(--vp-c-text-2);
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 32px;
  font-size: 14px;
  font-weight: 400;
  transition: color 0.5s;
}

.outline-link:hover,
.outline-link.active {
  color: var(--vp-c-text-1);
  transition: color 0.25s;
}

.outline-link.active {
  font-weight: 600;
}

.nested .outline-link.active {
  font-weight: 500;
}

.outline-link.nested {
  padding-left: 13px;
}

.wiki-outline-toggle {
  position: absolute;
  top: 7px;
  right: 0;
  width: 18px;
  height: 18px;
  border: 0;
  padding: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--vp-c-text-3);
  cursor: pointer;
  transition:
    color 0.2s ease,
    background-color 0.2s ease;
}

.wiki-outline-toggle:hover {
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-2);
}

.wiki-outline-toggle-icon {
  display: block;
  position: relative;
  width: 100%;
  height: 100%;
}

.wiki-outline-toggle-icon::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 5px;
  height: 5px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: translate(-60%, -50%) rotate(-45deg);
  transition: transform 0.2s ease;
}

.wiki-doc-outline-item.is-expanded > .wiki-outline-heading .wiki-outline-toggle-icon::before {
  transform: translate(-50%, -65%) rotate(45deg);
}

.wiki-outline-children {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows 0.22s ease,
    opacity 0.18s ease;
}

.wiki-outline-children.is-expanded {
  grid-template-rows: 1fr;
  opacity: 1;
}

.wiki-outline-children-inner {
  min-height: 0;
  overflow: hidden;
}
</style>
