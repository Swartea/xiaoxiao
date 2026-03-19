try
	do shell script "/bin/zsh -lc " & quoted form of "for port in 3000 3001; do pids=$(lsof -tiTCP:$port -sTCP:LISTEN -n -P || true); if [[ -n $pids ]]; then kill $pids >/dev/null 2>&1 || true; sleep 1; pids=$(lsof -tiTCP:$port -sTCP:LISTEN -n -P || true); if [[ -n $pids ]]; then kill -9 $pids >/dev/null 2>&1 || true; fi; fi; done; rm -f /Volumes/VM_Data/xiaoxiao/.runtime/*.pid"
	display notification "小说工厂已停止" with title "停止小说工厂"
on error errMsg
	display alert "停止失败" message errMsg
end try
