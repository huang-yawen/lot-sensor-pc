/**
 * 【文件职责】创建并导出 Promise 风格 MySQL 连接池。
 * 所有 repository/service 经此模块访问本机数据库，避免每个请求重复建立连接。
 * 【配置中心关联】无。DB_HOST、DB_PORT、DB_USER、DB_PASSWORD、DB_NAME 都是环境变量；
 * 远程联调模式仍应连接运行后端的本地数据库，不应改为云服务器数据库。
 */
const mysql = require('mysql2/promise')

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'task',
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
    queueLimit: 0,
    dateStrings: true,
})

// 启动时检测数据库连接
pool.getConnection()
    .then(conn => {
        console.log('✅ 数据库连接成功')
        conn.release()
    })
    .catch(err => {
        console.error('❌ Database connection failed:', err.message)
    })

module.exports = pool
