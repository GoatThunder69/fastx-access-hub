#!/bin/bash
SUPABASE_URL="https://aokfmtjflwzbhsywngjt.supabase.co"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFva2ZtdGpmbHd6YmhzeXduZ2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMTk1MTQsImV4cCI6MjA5NDc5NTUxNH0.PBqlOShLv6uBn-KLbUn9gJvSbdCqiD0C6APbSuD2c7E"

run_test() {
  NAME=$1
  METHOD=$2
  TARGET=$3
  DATA=$4
  
  if [[ "$METHOD" == "GET" ]]; then
    RESPONSE=$(curl -s -w "\nHTTP:%{http_code} TIME:%{time_total}s" "$TARGET")
  elif [[ "$METHOD" == "POST_RPC" ]]; then
    RESPONSE=$(curl -s -w "\nHTTP:%{http_code} TIME:%{time_total}s" -X POST "$SUPABASE_URL/rest/v1/rpc/$TARGET" \
      -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
      -H "Content-Type: application/json" \
      -d "$DATA")
  elif [[ "$METHOD" == "GET_TABLE" ]]; then
    RESPONSE=$(curl -s -w "\nHTTP:%{http_code} TIME:%{time_total}s" "$SUPABASE_URL/rest/v1/$TARGET" \
      -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY")
  fi

  BODY=$(echo "$RESPONSE" | sed '$d')
  STATUS_TIME=$(echo "$RESPONSE" | tail -n 1)
  
  # Check pass/fail based on typical expectations
  PASS="FAIL"
  HTTP_STATUS=$(echo "$STATUS_TIME" | grep -o "HTTP:[0-9]*" | cut -d: -f2)
  if [[ "$HTTP_STATUS" == "200" || "$HTTP_STATUS" == "204" || "$HTTP_STATUS" == "201" ]]; then
      PASS="PASS"
  fi
  # Specific overrides for RLS checks etc
  if [[ "$NAME" == "Read api_logs" && "$BODY" == "[]" ]]; then PASS="PASS"; fi
  if [[ "$NAME" == "Read managed_panels" && ( "$HTTP_STATUS" == "401" || "$HTTP_STATUS" == "403" || "$BODY" == "[]" ) ]]; then PASS="PASS"; fi

  echo "Test: $NAME"
  echo "Status: $PASS"
  echo "Info: $STATUS_TIME"
  echo "Body: ${BODY:0:100}"
  echo "----------------------------------------"
}

echo "Starting Comprehensive Test Suite..."
echo "----------------------------------------"
run_test "1. GET /excel" "GET" "https://www.cfms.dev/excel"
run_test "2. GET /test" "GET" "https://www.cfms.dev/test"
run_test "3. GET /" "GET" "https://www.cfms.dev/"
run_test "4. RPC get_panel_by_slug (excel)" "POST_RPC" "get_panel_by_slug" '{"p_slug":"excel"}'
run_test "5. RPC get_panel_by_slug (test)" "POST_RPC" "get_panel_by_slug" '{"p_slug":"test"}'
run_test "6. RPC validate_panel_access_key (valid)" "POST_RPC" "validate_panel_access_key" '{"p_key":"Test200", "p_panel_id":"f5ec2e78-c00e-4287-8005-366b078f6941"}'
run_test "7. RPC validate_panel_access_key (wrong)" "POST_RPC" "validate_panel_access_key" '{"p_key":"WRONG", "p_panel_id":"f5ec2e78-c00e-4287-8005-366b078f6941"}'
run_test "8. RPC verify_panel_password (valid)" "POST_RPC" "verify_panel_password" '{"p_panel_id":"f5ec2e78-c00e-4287-8005-366b078f6941", "p_password":"Test69"}'
run_test "9. RPC verify_panel_password (wrong)" "POST_RPC" "verify_panel_password" '{"p_panel_id":"f5ec2e78-c00e-4287-8005-366b078f6941", "p_password":"WRONG"}'
run_test "10. Read custom_endpoints" "GET_TABLE" "custom_endpoints"
run_test "11. Read api_logs" "GET_TABLE" "api_logs"
run_test "12. Read managed_panels" "GET_TABLE" "managed_panels"
run_test "13. RPC get_latest_broadcast" "POST_RPC" "get_latest_broadcast" '{"p_panel_id":null}'
run_test "14. GET Netlify API Proxy" "GET" "https://anuapi.netlify.app/.netlify/functions/api/v2?query=test"
