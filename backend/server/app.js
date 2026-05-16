const express = require('express');
const cors = require('cors');
const path = require('path');
const sensorRoutes = require('./routes/sensor');
const client=require('./mqtt/index')
const app = express();
app.use(cors());
app.use(express.json());
     
app.use('/', sensorRoutes);
       
const distPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(distPath));

app.get('/', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});
console.log('Dist Path:', distPath);  // 这里输出拼接后的路径

app.listen(3000, () => {
  console.log('服务器已启动：http://localhost:3000');
});
