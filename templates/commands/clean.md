Use the Bash tool to clean up orphaned Claude processes and E2E test artifacts. Execute the following commands immediately:

pgrep -f "claude" | while read pid; do ppid=$(ps -o ppid= -p $pid 2>/dev/null | tr -d " "); if [[ "$ppid" == "1" ]]; then echo "Killing: PID $pid"; kill $pid 2>/dev/null; fi; done && echo "Claude orphan process cleanup complete"

Then kill stale playwright-mcp processes older than 6h (forgotten sessions in other terminals), but protect the current session's own MCP children — killing those would disconnect this very session's playwright. First walk up from this shell to the highest "claude" ancestor and exclude its descendants from the age-based kill. Don't lower the 6h threshold — long e2e loops in other terminals may be active:

SELF_CLAUDE=""; _p=$$; while [ -n "$_p" ] && [ "$_p" != "1" ]; do ps -o args= -p "$_p" 2>/dev/null | grep -q "claude" && SELF_CLAUDE="$_p"; _p=$(ps -o ppid= -p "$_p" 2>/dev/null | tr -d ' '); done; PROTECTED=" "; if [ -n "$SELF_CLAUDE" ]; then _q="$SELF_CLAUDE"; while [ -n "$_q" ]; do _n=""; for _x in $_q; do PROTECTED="$PROTECTED$_x "; _n="$_n $(pgrep -P "$_x" 2>/dev/null)"; done; _q="$_n"; done; fi; ps -eo pid,etimes,args | grep "playwright-mcp" | grep -v grep | awk '$2 > 21600 {print $1, $2}' | while read pid secs; do case "$PROTECTED" in *" $pid "*) echo "Protecting current session's playwright-mcp: PID $pid (up $((secs/3600))h)"; continue;; esac; echo "Killing stale playwright-mcp: PID $pid (up $((secs/3600))h)"; kill $pid 2>/dev/null; done && echo "Stale MCP cleanup complete"

Then clean up E2E test log files and browser session state:

find . -path "./e2e-results/fail-*.md" -delete 2>/dev/null; rm -f .claude/browser-session.json 2>/dev/null; echo "E2E artifacts cleanup complete"
