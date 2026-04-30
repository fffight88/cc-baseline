Use the Bash tool to clean up orphaned Claude processes. Execute the following command immediately:

pgrep -f "claude" | while read pid; do ppid=$(ps -o ppid= -p $pid 2>/dev/null | tr -d " "); if [[ "$ppid" == "1" ]]; then echo "Killing: PID $pid"; kill $pid 2>/dev/null; fi; done && echo "Claude orphan process cleanup complete"
