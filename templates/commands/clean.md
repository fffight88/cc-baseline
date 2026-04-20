Bash 도구를 사용하여 Claude 고아 프로세스를 정리해주세요. 아래 명령어를 즉시 실행하세요:

pgrep -f "claude" | while read pid; do ppid=$(ps -o ppid= -p $pid 2>/dev/null | tr -d " "); if [[ "$ppid" == "1" ]]; then echo "종료: PID $pid"; kill $pid 2>/dev/null; fi; done && echo "Claude 고아 프로세스 정리 완료"
