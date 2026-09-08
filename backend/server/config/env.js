/**
 * 【文件职责】读取 .env 并在启动前补齐、校验后端环境变量。
 * 【配置】无。环境变量用于部署机密和网络地址；MQTT 主题、字段映射等可热更新
 * 场景参数由 systemConfig.js 管理，不能在这里替代。
 */
const fs = require('fs')
const path = require('path')

const envPaths = [
    path.join(__dirname, '../../.env'),
    path.join(__dirname, '../.env')
]

function loadEnvFile(envPath) {
    if (!fs.existsSync(envPath)) return

    const envText = fs.readFileSync(envPath, 'utf8')

    envText.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) return

        const separatorIndex = trimmed.indexOf('=')
        if (separatorIndex === -1) return

        const key = trimmed.slice(0, separatorIndex).trim().replace(/^\uFEFF/, '')
        let value = trimmed.slice(separatorIndex + 1).trim()

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1)
        }

        if (key && process.env[key] === undefined) {
            process.env[key] = value
        }
    })
}

envPaths.forEach(loadEnvFile)

module.exports = process.env
