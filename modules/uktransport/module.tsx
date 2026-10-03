import type { KitModuleDef } from '@kit-host'
import { setEngineVersion } from '@kit/cypher'
import { CONFIG } from './config'
import { TransportPage } from './page'

setEngineVersion('3.0')

const demo: KitModuleDef = {
  id: 'uktransport',
  title: CONFIG.title,
  icon: 'train',
  nav: { order: 10 },
  page: TransportPage,
  defaultGraph: CONFIG.graph,
  chrome: { topBar: false },
}
export default demo
