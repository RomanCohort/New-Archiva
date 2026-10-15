/**
 * AIRI 舞台探针 —— 用 Playwright 真的开一次网页版，看它到底渲染成什么样。
 *
 * 为什么要有这个：Live2D 渲没渲出来、provider 配没配上，光看 dist 里的文件
 * 是猜的。这个脚本拿一个**持久化 profile**（默认 .airi-browser-profile/），
 * 所以多次运行之间 localStorage 是留着的 —— 配一次，后面就能反复复验。
 *
 * 用法：
 *   node tools/airi-probe.mjs --shot out.png
 *   node tools/airi-probe.mjs --eval "location.href" --eval "document.title"
 *   node tools/airi-probe.mjs --click "text=设置" --sleep 1500 --shot settings.png
 *   node tools/airi-probe.mjs --fill "#base-url::http://127.0.0.1:8000/v1"
 *   node tools/airi-probe.mjs --storage            # 打印 localStorage + IndexedDB 库名
 *   node tools/airi-probe.mjs --headed             # 想看真窗口时加这个
 */
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const airiRoot = resolve(join(here, '..', 'airi'))
// playwright 装在 airi 的 node_modules 里，从这里借
const require = createRequire(join(airiRoot, 'package.json'))
const { chromium } = require('playwright')

// ---- 参数 ----
const args = process.argv.slice(2)
const options = {
  url: 'http://localhost:5173/',
  shot: null,
  sleep: 4000,
  headed: false,
  storage: false,
  clicks: [],
  fills: [],
  /** 按命令行的出现顺序执行的动作（fill/click/pause），顺序很要紧：
   *  聊天是先填再点发送，切标签页是先点再填。 */
  steps: [],
  evals: [],
  setups: [],
  viewport: { width: 1600, height: 900 },
}

for (let i = 0; i < args.length; i++) {
  const raw = args[i]
  if (!raw.startsWith('--'))
    continue

  // 兼容 `--flag=value` 和 `--flag value` 两种写法
  let flag = raw
  let value = ''
  const separator = raw.indexOf('=')
  if (separator !== -1) {
    flag = raw.slice(0, separator)
    value = raw.slice(separator + 1)
  }
  else if (args[i + 1] && !args[i + 1].startsWith('--')) {
    value = args[i + 1]
    i++
  }

  switch (flag) {
    case '--url': options.url = value; break
    case '--shot': options.shot = value; break
    case '--sleep': options.sleep = Number(value); break
    case '--headed': options.headed = true; break
    case '--storage': options.storage = true; break
  case '--clear-sw': options.clearSw = true; break
    case '--click': options.clicks.push(value); options.steps.push({ kind: 'click', selector: value }); break
    case '--fill': options.fills.push(value); options.steps.push({ kind: 'fill', spec: value }); break
    case '--type': options.steps.push({ kind: 'type', spec: value }); break
    case '--pause': options.steps.push({ kind: 'pause', ms: Number(value) }); break
    // eval 也进 steps：这样它就跟 click/fill 一样按命令行顺序跑，
    // 能「填完 → 看一眼状态 → 再点」这种夹在中间的排查。
    case '--eval': options.evals.push(value); options.steps.push({ kind: 'eval', code: value }); break
    case '--setup': options.setups.push(value); break
    default: console.warn(`[probe] 忽略未知参数: ${raw}`)
  }
}

const profileDir = process.env.AIRI_PROBE_PROFILE || join(here, '..', '.airi-browser-profile')

const context = await chromium.launchPersistentContext(profileDir, {
  headless: !options.headed,
  viewport: options.viewport,
  args: [
    // headless 下 WebGL 得靠 SwiftShader，Live2D 是走 WebGL 的
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--use-gl=angle',
    '--use-angle=swiftshader',
  ],
})

const page = context.pages()[0] ?? await context.newPage()
const consoleErrors = []
const failedRequests = []

page.on('console', (msg) => {
  if (msg.type() === 'error')
    consoleErrors.push(msg.text().slice(0, 300))
})
page.on('requestfailed', (req) => {
  failedRequests.push(`${req.method()} ${req.url().slice(0, 160)} → ${req.failure()?.errorText}`)
})

console.log(`[probe] 打开 ${options.url}`)
await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch((e) => {
  console.error(`[probe] goto 失败: ${e.message}`)
})

await page.waitForTimeout(Math.min(options.sleep, 5_000))

// ---- 清 Service Worker / Cache（!）----
// AIRI 是 PWA：注册过的 SW 会拿 precache 里的**旧 index.html** 回导航请求，
// 于是页面永远加载旧 bundle —— 重新构建了却看不到新代码，就是这个原因。
if (options.clearSw || options.setups.length) {
  const cleared = await page.evaluate(async () => {
    const registrations = (await navigator.serviceWorker?.getRegistrations?.()) ?? []
    await Promise.all(registrations.map(registration => registration.unregister()))
    const cacheKeys = (await caches?.keys?.()) ?? []
    await Promise.all(cacheKeys.map(key => caches.delete(key)))
    return { caches: cacheKeys.length, registrations: registrations.length }
  })
  console.log(`[probe] 清掉 SW ${cleared.registrations} 个 / Cache ${cleared.caches} 个，重载`)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2_000)
  consoleErrors.length = 0
  failedRequests.length = 0
}

// ---- 注入设置后重载（AIRI 的设置读的是 localStorage，改完必须重载才生效）----
if (options.setups.length) {
  for (const code of options.setups) {
    try {
      const result = await page.evaluate(code)
      console.log(`[probe] setup → ${typeof result === 'string' ? result : JSON.stringify(result)}`)
    }
    catch (e) {
      console.error(`[probe] setup 失败: ${e.message.split('\n')[0]}`)
    }
  }
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2_000)
  // 注入前的首次加载读的是上一轮的旧配置，那批报错会把新结果淹掉 —— 清掉，
  // 保证「控制台错误」这一栏只反映 setup 之后的状态。
  consoleErrors.length = 0
  failedRequests.length = 0
  console.log('[probe] 控制台错误缓冲已清空（只保留重载之后的）')
}

for (const step of options.steps) {
  if (step.kind === 'pause') {
    console.log(`[probe] pause ${step.ms}ms`)
    await page.waitForTimeout(step.ms)
    continue
  }

  if (step.kind === 'click') {
    console.log(`[probe] click ${step.selector}`)
    try {
      await page.click(step.selector, { timeout: 15_000 })
      await page.waitForTimeout(800)
    }
    catch (e) {
      console.error(`[probe] click 失败: ${e.message.split('\n')[0]}`)
    }
    continue
  }

  if (step.kind === 'eval') {
    try {
      const result = await page.evaluate(step.code)
      console.log(`[probe] eval ${step.code.slice(0, 60)} → ${typeof result === 'string' ? result : JSON.stringify(result)}`)
    }
    catch (e) {
      console.error(`[probe] eval 失败: ${e.message.split('\n')[0]}`)
    }
    continue
  }

  const index = step.spec.indexOf('::')
  const selector = step.spec.slice(0, index)
  const text = step.spec.slice(index + 2)

  // fill() 是直接改 value + 派发 input，某些 Vue 组件收不到；
  // type() 走真实按键，兜底用。
  if (step.kind === 'type') {
    console.log(`[probe] type ${selector} ← ${text}`)
    try {
      await page.click(selector, { timeout: 15_000 })
      await page.keyboard.press('Control+A')
      await page.keyboard.press('Delete')
      await page.keyboard.type(text, { delay: 30 })
    }
    catch (e) {
      console.error(`[probe] type 失败: ${e.message.split('\n')[0]}`)
    }
    continue
  }

  console.log(`[probe] fill ${selector} ← ${text}`)
  try {
    await page.fill(selector, text, { timeout: 15_000 })
  }
  catch (e) {
    console.error(`[probe] fill 失败: ${e.message.split('\n')[0]}`)
  }
}

if (options.sleep > 5_000)
  await page.waitForTimeout(options.sleep - 5_000)

// ---- 状态 ----
const state = await page.evaluate(() => {
  const canvases = [...document.querySelectorAll('canvas')].map((c) => {
    // 采样几个点看画布是真有内容还是全黑/全透明
    let painted = null
    try {
      const gl = c.getContext('webgl2') || c.getContext('webgl')
      if (gl) {
        const w = c.width
        const h = c.height
        const px = new Uint8Array(4 * 4)
        const samples = []
        for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.3], [0.35, 0.45], [0.65, 0.45]]) {
          const buf = new Uint8Array(4)
          gl.readPixels(Math.floor(w * fx), Math.floor(h * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf)
          samples.push([...buf])
        }
        painted = samples
      }
    }
    catch (e) {
      painted = `readPixels 失败: ${e.message}`
    }
    return { width: c.width, height: c.height, painted }
  })

  // 没导航成功时停在 about:blank，读 localStorage 会 SecurityError
  let localStorageKeys = []
  try {
    localStorageKeys = Object.keys(localStorage)
  }
  catch (e) {
    localStorageKeys = [`(读不到: ${e.name})`]
  }

  return {
    url: location.href,
    title: document.title,
    canvases,
    webgl: (() => {
      try {
        const c = document.createElement('canvas')
        const gl = c.getContext('webgl2') || c.getContext('webgl')
        if (!gl)
          return 'no webgl'
        const dbg = gl.getExtension('WEBGL_debug_renderer_info')
        return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'webgl ok (renderer 未知)'
      }
      catch (e) { return `err ${e.message}` }
    })(),
    localStorageKeys,
    bodyTextHead: (document.body?.innerText || '').slice(0, 600),
  }
})

console.log('[probe] url:', state.url)
console.log('[probe] title:', state.title)
console.log('[probe] webgl:', state.webgl)
console.log('[probe] canvas:', JSON.stringify(state.canvases))
console.log('[probe] body 前 600 字:\n' + state.bodyTextHead)

if (options.storage) {
  const dump = await page.evaluate(() => {
    const out = {}
    for (const k of Object.keys(localStorage))
      out[k] = (localStorage.getItem(k) || '').slice(0, 200)
    return out
  })
  console.log('[probe] localStorage:')
  for (const [k, v] of Object.entries(dump))
    console.log(`  ${k} = ${v}`)
}

if (options.shot) {
  const shotPath = resolve(options.shot)
  await page.screenshot({ path: shotPath })
  console.log(`[probe] 截图 → ${shotPath}`)
}

if (consoleErrors.length) {
  console.log(`[probe] 控制台错误 ${consoleErrors.length} 条（去重前 8 条）:`)
  for (const e of [...new Set(consoleErrors)].slice(0, 8))
    console.log('  ' + e)
}
if (failedRequests.length) {
  console.log(`[probe] 请求失败 ${failedRequests.length} 条（前 8）:`)
  for (const r of [...new Set(failedRequests)].slice(0, 8))
    console.log('  ' + r)
}

await context.close()
