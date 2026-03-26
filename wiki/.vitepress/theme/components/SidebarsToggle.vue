<script setup lang="ts">
import { inBrowser } from 'vitepress'
import VPSwitch from 'vitepress/dist/client/theme-default/components/VPSwitch.vue'
import { useSidebar } from 'vitepress/dist/client/theme-default/composables/sidebar'
import { computed, onMounted, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    mode?: 'navbar' | 'menu'
  }>(),
  {
    mode: 'navbar'
  }
)

const STORAGE_KEY = 'wiki-sidebars-hidden'
const ROOT_CLASS = 'wiki-sidebars-hidden'

const hidden = ref(false)
const isMenu = computed(() => props.mode === 'menu')
const { hasSidebar } = useSidebar()

const title = computed(() =>
  hidden.value ? '显示双侧边栏' : '隐藏双侧边栏'
)

function applyHidden(next: boolean) {
  hidden.value = next

  if (!inBrowser) return

  document.documentElement.classList.toggle(ROOT_CLASS, next)
  window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
}

function toggleHidden() {
  applyHidden(!hidden.value)
}

onMounted(() => {
  if (!inBrowser) return

  const stored = window.localStorage.getItem(STORAGE_KEY)
  applyHidden(stored === '1')
})
</script>

<template>
  <div v-if="hasSidebar && isMenu" class="WikiSidebarsToggleMenu item appearance">
    <p class="label">侧边栏</p>
    <div class="appearance-action">
      <VPSwitch
        class="WikiSidebarsToggleSwitch"
        role="switch"
        :aria-checked="hidden"
        :aria-label="title"
        :title="title"
        @click="toggleHidden"
      >
        <span class="vpi-align-left wiki-sidebars-icon wiki-sidebars-icon-shown" aria-hidden="true"></span>
        <span class="vpi-layout-list wiki-sidebars-icon wiki-sidebars-icon-hidden" aria-hidden="true"></span>
      </VPSwitch>
    </div>
  </div>

  <div v-else-if="hasSidebar" class="WikiSidebarsToggle">
    <VPSwitch
      class="WikiSidebarsToggleSwitch"
      role="switch"
      :aria-checked="hidden"
      :aria-label="title"
      :title="title"
      @click="toggleHidden"
    >
      <span class="vpi-align-left wiki-sidebars-icon wiki-sidebars-icon-shown" aria-hidden="true"></span>
      <span class="vpi-layout-list wiki-sidebars-icon wiki-sidebars-icon-hidden" aria-hidden="true"></span>
    </VPSwitch>
  </div>
</template>
