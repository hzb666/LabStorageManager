<script setup lang="ts">
import { computed } from 'vue'
import { Mermaid as PluginMermaid } from '@leelaa/vitepress-plugin-extended'

interface MermaidAutoProps {
  content?: string
  height?: string
  theme?: string
}

const props = withDefaults(defineProps<MermaidAutoProps>(), {
  content: '',
  height: '600px',
  theme: undefined
})

const renderedContent = computed(() => {
  const source = props.content ?? ''
  const trimmed = source.trimStart()
  if (trimmed.startsWith('%%{init:')) {
    return source
  }
  const themeCSS = `
.label text,
text,
tspan,
.nodeLabel,
.edgeLabel,
.cluster-label text {
  fill: var(--wiki-mermaid-text) !important;
  color: var(--wiki-mermaid-text) !important;
}
.node rect,
.node circle,
.node ellipse,
.node polygon,
.node path,
.actor,
.labelBox,
.label-container {
  fill: var(--wiki-mermaid-node-bg) !important;
  stroke: var(--wiki-mermaid-node-border) !important;
}
.cluster rect,
.cluster polygon {
  fill: var(--wiki-mermaid-cluster-bg) !important;
  stroke: var(--wiki-mermaid-cluster-border) !important;
}
.edgeLabel rect,
.edgeLabel foreignObject,
.labelBkg {
  fill: var(--wiki-mermaid-edge-label-bg) !important;
  background-color: var(--wiki-mermaid-edge-label-bg) !important;
}
.edgePath .path,
.flowchart-link,
.relationshipLine,
.messageLine0,
.messageLine1,
.loopLine,
.marker,
marker path,
.arrowheadPath,
.arrowMarkerPath,
path.path {
  stroke: var(--wiki-mermaid-line) !important;
}
.marker path,
.arrowheadPath,
.arrowMarkerPath {
  fill: var(--wiki-mermaid-line) !important;
}
svg {
  background: var(--wiki-mermaid-bg) !important;
}
`
  const initConfig = props.theme
    ? { theme: props.theme }
    : {
        theme: 'neutral',
        themeCSS
      }
  const init = `%%{init: ${JSON.stringify(initConfig)}}%%`
  if (!trimmed) return init
  return `${init}\n${source}`
})
</script>

<template>
  <PluginMermaid
    :content="renderedContent"
    :height="props.height"
    :theme="props.theme ?? 'neutral'"
  />
</template>
