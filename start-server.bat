@echo off
REM 启动公众号自动化写作工具 - 后台运行模式
REM 日志输出到 server.log 文件

cd /d "%~dp0"
echo Starting WeChat Auto Writer server...
echo [%date% %time%] Starting server... > server.log

node server.js >> server.log 2>&1

if %errorlevel% neq 0 (
    echo Server failed to start. Check server.log for details.
    echo [%date% %time%] Server failed with error code %errorlevel% >> server.log
) else (
    echo Server stopped.
    echo [%date% %time%] Server stopped normally >> server.log
)
