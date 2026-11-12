import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

test('folder picker creates an enabled dsh-meme pack and uploads chosen images', async () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const state = []
  let position = 0
  const React = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) {
      const index = position++
      if (index >= state.length) state.push(initial)
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
    },
    useEffect() {},
  }
  const requests = []
  let module
  const document = {
    currentScript: { src: 'http://localhost/plugins/dsh-companion-mood/client.js' },
    createElement: () => ({ dataset: {}, remove() {} }), head: { append() {} },
  }
  class FileReader {
    readAsDataURL() { this.result = 'data:image/png;base64,YWJj'; this.onload() }
  }
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: value => { module = value.factory(() => React) } } },
    document, URL, FileReader,
    fetch: async (_url, options) => {
      if (options.body) requests.push(JSON.parse(options.body))
      return { ok: true, json: async () => ({ ok: true, packs: [] }) }
    },
  })
  let renderPanel
  const slots = { inject: (_name, callback) => callback(), register: (options, render) => { if (options.name === 'settings.section') renderPanel = render } }
  module.apply({ get: () => slots, effect: callback => callback() })
  const render = () => { position = 0; return renderPanel().type() }
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return null
    if (predicate(node)) return node
    for (const child of node.children || []) {
      const found = find(child, predicate)
      if (found) return found
    }
    return null
  }
  let tree = render()
  find(tree, node => node.type === 'button' && node.children.includes('导入目录')).props.onClick()
  tree = render()
  const picker = find(tree, node => node.type === 'input' && node.props.type === 'file')
  const nativeInput = {}
  picker.props.ref(nativeInput)
  assert.equal(nativeInput.webkitdirectory, true)
  picker.props.onChange({ target: { files: [{ name: 'happy.png', size: 3, webkitRelativePath: '我的表情/开心/happy.png' }] } })
  tree = render()
  const button = find(tree, node => node.type === 'button' && String(node.children[0]).startsWith('导入 1 个文件'))
  await button.props.onClick()
  assert.equal(requests[0].op, 'createMemePack')
  assert.equal(requests[0].name, '我的表情')
  assert.equal(requests[1].op, 'upload')
  assert.equal(requests[1].fileName, 'happy.png')
  assert.equal(requests[1].dataBase64, 'YWJj')
})
