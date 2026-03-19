on portOpen(portNumber)
	try
		do shell script "/bin/zsh -lc " & quoted form of ("lsof -iTCP:" & portNumber & " -sTCP:LISTEN -n -P >/dev/null 2>&1")
		return true
	on error
		return false
	end try
end portOpen

on waitForServices()
	repeat 60 times
		if my portOpen(3000) and my portOpen(3001) then
			return true
		end if
		delay 1
	end repeat
	return false
end waitForServices

on findNodeBin()
	try
		return do shell script "/bin/zsh -lc " & quoted form of "setopt NULL_GLOB; bins=($HOME/.nvm/versions/node/*/bin); for (( idx=${#bins}; idx>=1; idx-- )); do if [[ -x ${bins[idx]}/node && -x ${bins[idx]}/corepack ]]; then print -r -- ${bins[idx]}; exit 0; fi; done; for candidate in /opt/homebrew/bin /usr/local/bin; do if [[ -x $candidate/node && -x $candidate/corepack ]]; then print -r -- $candidate; exit 0; fi; done; exit 1"
	on error
		return ""
	end try
end findNodeBin

set projectDir to "/Volumes/VM_Data/xiaoxiao"
set webUrl to "http://localhost:3000"
set nodeBin to my findNodeBin()

if my portOpen(3000) and my portOpen(3001) then
	do shell script "/usr/bin/open " & quoted form of webUrl
	display notification "小说工厂已经在运行" with title "启动小说工厂"
	return
end if

if nodeBin is "" then
	display alert "启动失败" message "未找到可用的 Node.js 运行环境。"
	return
end if

if not ((do shell script "/bin/test -x " & quoted form of (projectDir & "/apps/api/node_modules/.bin/tsx") & "; echo $?") is "0") then
	display alert "启动失败" message "缺少 API 依赖，请先在项目里安装依赖。"
	return
end if

if not ((do shell script "/bin/test -x " & quoted form of (projectDir & "/apps/web/node_modules/.bin/next") & "; echo $?") is "0") then
	display alert "启动失败" message "缺少 Web 依赖，请先在项目里安装依赖。"
	return
end if

set runtimePath to nodeBin & ":/opt/homebrew/bin:/usr/local/bin:$PATH"
set apiCommand to "export PATH=" & quoted form of runtimePath & "; cd " & quoted form of (projectDir & "/apps/api") & "; " & quoted form of (projectDir & "/apps/api/node_modules/.bin/tsx") & " watch src/main.ts"
set webCommand to "export PATH=" & quoted form of runtimePath & "; cd " & quoted form of (projectDir & "/apps/web") & "; " & quoted form of (projectDir & "/apps/web/node_modules/.bin/next") & " dev -p 3000"

tell application "Terminal"
	activate
	if not my portOpen(3001) then
		do script apiCommand
	end if
	if not my portOpen(3000) then
		do script webCommand
	end if
end tell

if my waitForServices() then
	do shell script "/usr/bin/open " & quoted form of webUrl
	display notification "前后端已经启动" with title "启动小说工厂"
else
	display alert "启动超时" message "请查看新开的 Terminal 窗口日志。"
end if
