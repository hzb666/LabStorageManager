import DefaultTheme from 'vitepress/theme-without-fonts'
import MermaidAuto from './components/MermaidAuto.vue'
import InlineCodeRef from './components/InlineCodeRef.vue'
import LandingHome from './components/LandingHome.vue'
import Layout from './Layout.vue'

import './custom.css'
import './fontLoader'

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp(ctx) {
    DefaultTheme.enhanceApp?.(ctx)
    ctx.app.component('Mermaid', MermaidAuto)
    ctx.app.component('InlineCodeRef', InlineCodeRef)
    ctx.app.component('LandingHome', LandingHome)
  }
}
