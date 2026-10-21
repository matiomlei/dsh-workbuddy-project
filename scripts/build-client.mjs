import { readFileSync, writeFileSync } from 'node:fs'
const base = new URL('../', import.meta.url)
const legacy = readFileSync(new URL('client/legacy.js',base),'utf8')
const delivery = readFileSync(new URL('client/delivery-panel.js',base),'utf8')
writeFileSync(new URL('lib/client.js',base), legacy.replace('    function apply(ctx) {',delivery+'\n    function apply(ctx) {\n      mountDeliveryClient(ctx)').replace("order: 25, label: '项目'","order: 25, label: '会话项目'"))
