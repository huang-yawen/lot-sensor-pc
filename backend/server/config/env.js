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
