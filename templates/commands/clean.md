Use the Bash tool to clean up orphaned Claude processes and E2E test artifacts. Execute the following commands immediately:

pgrep -f "claude" | while read pid; do ppid=$(ps -o ppid= -p $pid 2>/dev/null | tr -d " "); if [[ "$ppid" == "1" ]]; then echo "Killing: PID $pid"; kill $pid 2>/dev/null; fi; done && echo "Claude orphan process cleanup complete"

Then clean up E2E test log files and browser session state:

find . -path "./e2e-results/fail-*.md" -delete 2>/dev/null; rm -f .claude/browser-session.json 2>/dev/null; echo "E2E artifacts cleanup complete"
