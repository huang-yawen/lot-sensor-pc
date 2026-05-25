const express = require('express');
const cors = require('cors');
const path = require('path');
require('./config/env');
const sensorRoutes = require('./routes/sensor');
const client=require('./mqtt/index')
const app = express();
const port = Number(process.env.PORT) || 3000;
app.use(cors());
app.use(express.json());
     
app.use('/', sensorRoutes);
       
const distPath = process.env.FRONTEND_DIST_PATH
  ? path.resolve(process.env.FRONTEND_DIST_PATH)
  : path.join(__dirname, '../../dist');
app.use(express.static(distPath));

app.get('/', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});
console.log('Dist Path:', distPath);

app.listen(port, () => {
  console.log(`Server started: http://localhost:${port}`);
});
