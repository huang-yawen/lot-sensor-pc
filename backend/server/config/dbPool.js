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