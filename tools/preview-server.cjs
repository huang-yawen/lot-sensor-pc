/**
 * 【文件职责】本地静态服务器，用来在浏览器里预览 tools/ 下的演示页面。
 *   （根 package.json 是 type:module，所以本文件用 .cjs 后缀强制 CommonJS）
 *
 * 用法：
 *   node tools/preview-server.cjs            # 起服务，按提示打开浏览器
 *   node tools/preview-server.cjs --check    # 自检：起服务 → 探测关键资源是否 200 → 退出
 */
const http = require('http')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const PORT = Number(process.env.PREVIEW_PORT) || 5599
const ENTRY = '/tools/judgment-action-dialog-preview.html'
const CHECK_ONLY = process.argv.includes('--check')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(String(req.url).split('?')[0])
  const rel = urlPath === '/' ? ENTRY : urlPath
  const filePath = path.join(ROOT, rel)
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403)
    res.end('forbidden')
    return
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end('not found: ' + rel)
      return
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' })
    res.end(data)
  })
})

server.listen(PORT, () => {
  if (CHECK_ONLY) {
    const targets = [
      ENTRY,
      '/node_modules/vue/dist/vue.global.js',
      '/node_modules/element-plus/dist/index.css',
      '/node_modules/element-plus/dist/index.full.js',
    ]
    let pending = targets.length
    for (const t of targets) {
      http.get({ host: 'localhost', port: PORT, path: t }, (res) => {
        console.log(`${res.statusCode}  ${t}`)
        res.resume()
        if (--pending === 0) server.close()
      }).on('error', (e) => {
        console.log(`ERR ${t}: ${e.message}`)
        if (--pending === 0) server.close()
      })
    }
    return
  }
  console.log('预览地址: http://localhost:' + PORT + ENTRY)
  console.log('(Ctrl+C 结束)')
})
