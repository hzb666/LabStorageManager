import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import './fontLoader'

import './custom.css'

export default {
  extends: DefaultTheme,
  Layout,
}
