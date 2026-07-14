#!/usr/bin/env bash
# Real MCP protocol round-trip: spawns dist/index.js as a stdio server and feeds
# it raw newline-delimited JSON-RPC (initialize handshake, tools/list, tools/call)
# exactly as Claude Desktop / Claude Code would. No importing of the functions.
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
source /opt/ros/lyrical/setup.bash
export QT_QPA_PLATFORM=offscreen
cd "$HOME/projects/linux-ros-mcp-bridge"

SANDBOX=/tmp/mcp-patch-sandbox.txt
printf 'alpha\nSECRET = 123\nomega\n' > "$SANDBOX"

# turtlesim must be live for sample_ros_topic / list_ros_nodes to have something.
ros2 run turtlesim turtlesim_node >/tmp/turtle.log 2>&1 &
TPID=$!
sleep 5

# --- request phases (staggered so the lifecycle is deterministic) ---
cat > /tmp/req.a <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"raw-jsonrpc-test","version":"0.0.1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
EOF

cat > /tmp/req.b <<'EOF'
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
EOF

# $SANDBOX expands here (unquoted heredoc delimiter). Note: sample_ros_topic is
# called with NO message_type, to prove the arg is truly optional over the wire.
cat > /tmp/req.c <<EOF
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"patch_file","arguments":{"path":"$SANDBOX","search":"SECRET = 123","replace":"SECRET = 999"}}}
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"sample_ros_topic","arguments":{"topic_name":"/turtle1/pose"}}}
{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"list_ros_nodes","arguments":{}}}
EOF

{ cat /tmp/req.a; sleep 1.5; cat /tmp/req.b; sleep 2; cat /tmp/req.c; sleep 10; } \
  | node dist/index.js >/tmp/mcp-out.jsonl 2>/tmp/mcp-server.stderr

echo "===== server stderr (startup banner) ====="
cat /tmp/mcp-server.stderr
echo
echo "===== RAW stdout: newline-delimited JSON-RPC ====="
echo "bytes: $(wc -c < /tmp/mcp-out.jsonl)   lines: $(wc -l < /tmp/mcp-out.jsonl)"
echo "----- id=1 initialize, raw (first 320 chars) -----"
head -1 /tmp/mcp-out.jsonl | cut -c1-320
echo
echo "===== PARSED REPORT ====="
node mcp-report.mjs /tmp/mcp-out.jsonl
echo
echo "===== /tmp/mcp-patch-sandbox.txt ON DISK AFTER patch_file call ====="
cat "$SANDBOX"

kill -9 "$TPID" 2>/dev/null
echo
echo "DONE."
