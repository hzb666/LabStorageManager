<script setup lang="ts">
import DefaultTheme from 'vitepress/theme-without-fonts'
import { withBase } from 'vitepress'
import { nextTick, onBeforeUnmount, onMounted } from 'vue'
import AsideOutline from './AsideOutline.vue'
import SidebarsToggle from './components/SidebarsToggle.vue'
import SidebarsToggleInExtraMenu from './components/SidebarsToggleInExtraMenu.vue'

const logoSrc = withBase('/favicon.svg')

let tableObserver: MutationObserver | null = null

function wrapDocTables(root: ParentNode = document) {
  const tables = root.querySelectorAll<HTMLTableElement>('.vp-doc table')

  tables.forEach((table) => {
    if (table.parentElement?.classList.contains('wiki-table-scroll')) {
      return
    }

    const wrapper = document.createElement('div')
    wrapper.className = 'wiki-table-scroll'
    table.parentNode?.insertBefore(wrapper, table)
    wrapper.appendChild(table)
  })
}

onMounted(async () => {
  await nextTick()
  wrapDocTables()

  const contentRoot = document.querySelector('.VPContent')
  if (!contentRoot) return

  tableObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return

        if (node.matches('.vp-doc table')) {
          wrapDocTables(node.parentElement ?? node)
          return
        }

        if (node.querySelector('.vp-doc table')) {
          wrapDocTables(node)
        }
      })
    }
  })

  tableObserver.observe(contentRoot, {
    childList: true,
    subtree: true
  })
})

onBeforeUnmount(() => {
  tableObserver?.disconnect()
  tableObserver = null
})
</script>

<template>
  <DefaultTheme.Layout>
    <template #nav-bar-title-before>
      <span class="wiki-nav-logo-wrap" aria-hidden="true">
        <img class="wiki-nav-logo" :src="logoSrc" alt="" />
      </span>
    </template>

    <template #aside-outline-before>
      <AsideOutline />
    </template>

    <template #nav-bar-content-after>
      <SidebarsToggle />
      <SidebarsToggleInExtraMenu />
    </template>

    <template #home-hero-image>
      <div class="wiki-hero-logo-shell">
        <img class="wiki-hero-logo" :src="logoSrc" alt="LabStorageManager 图标" />
      </div>
    </template>
  </DefaultTheme.Layout>
</template>
