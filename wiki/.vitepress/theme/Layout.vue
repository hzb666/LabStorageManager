<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import { withBase } from 'vitepress'
import Outline from './Outline.vue'

const logoSrc = withBase('/favicon.svg')
</script>

<template>
  <DefaultTheme.Layout>
    <template #nav-bar-title-before>
      <span class="wiki-nav-logo-wrap" aria-hidden="true">
        <img class="wiki-nav-logo" :src="logoSrc" alt="" />
      </span>
    </template>

    <template #aside-outline-before>
      <Outline />
    </template>

    <template #home-hero-image>
      <div class="wiki-hero-logo-shell">
        <img class="wiki-hero-logo" :src="logoSrc" alt="LabStorageManager 图标" />
      </div>
    </template>
  </DefaultTheme.Layout>
</template>
