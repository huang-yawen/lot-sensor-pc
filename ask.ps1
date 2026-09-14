param(
    [Parameter(Mandatory=$true)]
    [string]$File,
    [string]$Prompt = "请详细解释这个文件的功能和逻辑，用中文回答"
)

$ollama = "C:\Users\lenovo\AppData\Local\Programs\Ollama\ollama.exe"
$model = "qwen2.5-coder:7b"

if (-not (Test-Path $File)) {
    Write-Host "文件不存在: $File" -ForegroundColor Red
    exit 1
}

$content = Get-Content $File -Raw -Encoding UTF8
$input = "$content`n`n---`n$Prompt"

Write-Host "正在分析: $File" -ForegroundColor Cyan
$input | & $ollama run $model --nowordwrap
