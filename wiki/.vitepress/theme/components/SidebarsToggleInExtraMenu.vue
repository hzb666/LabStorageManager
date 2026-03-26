<script setup lang="ts">
import { inBrowser } from 'vitepress'
import { useSidebar } from 'vitepress/dist/client/theme-default/composables/sidebar'
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import SidebarsToggle from './SidebarsToggle.vue'

const target = ref<HTMLElement | null>(null)
const MAX_RETRY = 8
const ANCHOR_CLASS = 'wiki-sidebars-extra-group'
const { hasSidebar } = useSidebar()

async function resolveTarget() {
  if (!inBrowser) return

  for (let i = 0; i < MAX_RETRY; i += 1) {
    await nextTick()
    const menu = document.querySelector('.VPNavBar .extra .menu .VPMenu') as HTMLElement | null
    if (!menu) {
      await new Promise((resolve) => window.setTimeout(resolve, 50))
      continue
    }

    let anchor = menu.querySelector(`.${ANCHOR_CLASS}`) as HTMLElement | null
    if (!anchor) {
      const appearanceItem = menu.querySelector('.item.appearance') as HTMLElement | null
      const appearanceGroup = appearanceItem?.closest('.group') as HTMLElement | null

      anchor = document.createElement('div')
      anchor.className = `group ${ANCHOR_CLASS}`

      if (appearanceGroup && appearanceGroup.parentElement === menu) {
        appearanceGroup.insertAdjacentElement('afterend', anchor)
      } else {
        menu.appendChild(anchor)
      }
    }

    target.value = anchor
    if (target.value) return
    await new Promise((resolve) => window.setTimeout(resolve, 50))
  }
}

onMounted(() => {
  resolveTarget()
})

onBeforeUnmount(() => {
  target.value?.remove()
})
</script>

<template>
  <Teleport v-if="target && hasSidebar" :to="target">
    <SidebarsToggle mode="menu" />
  </Teleport>
</template>
