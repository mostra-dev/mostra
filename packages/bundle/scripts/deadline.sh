# shellcheck shell=sh disable=SC2154 # `work`, `windows` and `die` are the sourcing script's.
# Deadlines for the smoke tests' steps (#124), in POSIX sh. A step that stalls fails within its own
# limit and prints what was running and every log so far, rather than holding the job until GitHub
# ends it at its limit (and, once, lost its log with it). Sourced by smoke.sh and npm-smoke.sh after
# they set `work`, `windows` and `die`.

# Its input with the values of capability parameters (`#t=`, `#l=`, `?token=` …) replaced: the
# runs' logs hold capability links, and what is printed or kept from them mustn't (STANDARDS).
redact() { sed -E "s/([?#&][A-Za-z]{1,12}=)[^&#[:space:]\"']+/\\1[redacted]/g"; }

# The processes below $1, from `ps` (POSIX).
descendants() {
  ps -A -o pid= -o ppid= 2>/dev/null | awk -v root="$1" '
    { kids[$2] = kids[$2] " " $1 }
    END {
      queue = root
      while (queue != "") {
        n = split(queue, at, " ")
        queue = ""
        for (i = 1; i <= n; i++) {
          m = split(kids[at[i]], below, " ")
          for (j = 1; j <= m; j++) { print below[j]; queue = queue " " below[j] }
        }
      }
    }'
}

# Ends $1 and everything it started that still runs.
end_tree() {
  if $windows; then
    dl_winpid=$(cat "/proc/$1/winpid" 2>/dev/null || true)
    [ -z "$dl_winpid" ] || taskkill //F //T //PID "$dl_winpid" > /dev/null 2>&1 || true
  fi
  for dl_pid in $(descendants "$1") "$1"; do kill -9 "$dl_pid" 2> /dev/null || true; done
}

# What a stall leaves to read: every process with its age and state, then the last lines of each of
# the run's logs and of the daemon's.
report_stall() {
  printf '\n----- processes -----\n'
  if $windows; then
    ps -W 2> /dev/null || tasklist 2> /dev/null || true
  else
    ps -A -o pid,ppid,pgid,etime,stat,command 2> /dev/null || ps -ef || true
  fi
  for dl_log in $(find "$work/logs" "$work/home/logs" -type f 2> /dev/null | sort); do
    printf '\n----- %s (its last 40 lines) -----\n' "$dl_log"
    tail -n 40 "$dl_log" | redact || true
  done
}

# bounded <seconds> <step> <stdout file> <stderr file> <command…>: runs the command with its output
# in the two files and returns its status. Past the limit it prints what was running and the logs
# so far, ends the command and what it started, and fails naming the step.
bounded() {
  dl_limit=$1
  dl_name=$2
  dl_out=$3
  dl_err=$4
  shift 4
  "$@" > "$dl_out" 2> "$dl_err" &
  dl_running=$!
  dl_since=$(date +%s)
  while kill -0 "$dl_running" 2> /dev/null; do
    if [ $(($(date +%s) - dl_since)) -ge "$dl_limit" ]; then
      report_stall >&2
      end_tree "$dl_running"
      die "$dl_name didn't finish within $dl_limit s (what was running and the logs are above)"
    fi
    sleep 1
  done
  wait "$dl_running"
}
