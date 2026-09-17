$env:DB_HOST = "127.0.0.1"
$env:DB_PORT = "3306"
$env:DB_USER = "root"
$env:DB_PASSWORD = "123456"
$env:DB_NAME = "competition"
Set-Location -LiteralPath "D:\HUYa的桌面\LOT\lot-sensor-pc\backend\server"
& "D:\Program Files\node.js\node.exe" _tmp_compare_duration.js
