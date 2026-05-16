const mysql = require('mysql2')
const pool = mysql.createPool(
    'mysql://root:123456@localhost:3306/task?allowPublicKeyRetrieval=true&ssl=false')
const promisePool = pool.promise()
module.exports = promisePool;
promisePool.getConnection()
  .then(conn => {
    console.log('数据库连接成功');
    conn.release();
  })
  .catch(err => console.error('数据库连接失败:', err));