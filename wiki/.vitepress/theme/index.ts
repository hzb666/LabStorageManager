import DefaultTheme from 'vitepress/theme'
import MermaidAuto from './components/MermaidAuto.vue'
import InlineCodeRef from './components/InlineCodeRef.vue'
import Layout from './Layout.vue'
import './fontLoader'

import './custom.css'

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp(ctx) {
    DefaultTheme.enhanceApp?.(ctx)
    ctx.app.component('Mermaid', MermaidAuto)
    ctx.app.component('InlineCodeRef', InlineCodeRef)
  }
}
