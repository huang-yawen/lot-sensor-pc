require('./env')
const mysql = require('mysql2')

// 所有查询共用连接池，数据库参数优先读取 backend/.env。
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'task',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  dateStrings: true// 开启日期字符串解析,把日期当成一般的字符串进行返回
})
const promisePool = pool.promise()
module.exports = promisePool;
promisePool.getConnection()
  .then(conn => {
    console.log('Database connected');
    conn.release();
  })
  .catch(err => console.error('Database connection failed:', err.message));
