#!/bin/bash

URL="https://aokfmtjflwzbhsywngjt.supabase.co"
ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFva2ZtdGpmbHd6YmhzeXduZ2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMTk1MTQsImV4cCI6MjA5NDc5NTUxNH0.PBqlOShLv6uBn-KLbUn9gJvSbdCqiD0C6APbSuD2c7E"
TEST_PANEL_ID="f5ec2e78-c00e-4287-8005-366b078f6941"
EXCEL_PANEL_ID="92842e87-5b22-4d48-b8b3-e0e8887bd6f4"

run_rpc() {
  local func=$1
  local data=$2
  
  response=$(curl -s -w "\nSTATUS:%{http_code} TIME:%{time_total}s" -X POST "$URL/rest/v1/rpc/$func" \
    -H "apikey: $ANON" \
    -H "Authorization: Bearer $ANON" \
    -H "Content-Type: application/json" \
    -d "$data")
  
  echo "$response"
}

print_result() {
  local num=$1
  local name=$2
  local response=$3
  
  body=$(echo "$response" | sed '$d')
  status=$(echo "$response" | grep "STATUS:" | cut -d: -f2 | cut -d' ' -f1)
  time=$(echo "$response" | grep "TIME:" | cut -d: -f2)
  
  # Simple pass/fail logic based on task description
  # This is a bit manual but works for the report.
  
  echo "Test #$num: $name"
  echo "Status: $status, Time: $time"
  echo "Body: ${body:0:80}"
  echo "-----------------------------------"
}

# 1. validate_access_key with p_key="FAKEKEYXXX"
res1=$(run_rpc "validate_access_key" '{"p_key": "FAKEKEYXXX"}')
print_result 1 "validate_access_key (Invalid)" "$res1"

# 2. validate_access_key with p_key="Test200"
res2=$(run_rpc "validate_access_key" '{"p_key": "Test200"}')
print_result 2 "validate_access_key (Panel-scoped key global)" "$res2"

# 3. validate_panel_access_key with p_key="Test200", p_panel_id=TEST_PANEL_ID
res3=$(run_rpc "validate_panel_access_key" "{\"p_key\": \"Test200\", \"p_panel_id\": \"$TEST_PANEL_ID\"}")
print_result 3 "validate_panel_access_key (Valid)" "$res3"

# 4. validate_panel_access_key with p_key="Test200", p_panel_id=EXCEL_PANEL_ID
res4=$(run_rpc "validate_panel_access_key" "{\"p_key\": \"Test200\", \"p_panel_id\": \"$EXCEL_PANEL_ID\"}")
print_result 4 "validate_panel_access_key (Wrong Panel)" "$res4"

# 5. validate_panel_access_key with p_key="FAKEKEY", p_panel_id=TEST_PANEL_ID
res5=$(run_rpc "validate_panel_access_key" "{\"p_key\": \"FAKEKEY\", \"p_panel_id\": \"$TEST_PANEL_ID\"}")
print_result 5 "validate_panel_access_key (Invalid Key)" "$res5"

# 6. validate_panel_access_key with p_key="Test200", p_panel_id=TEST_PANEL_ID again
res6=$(run_rpc "validate_panel_access_key" "{\"p_key\": \"Test200\", \"p_panel_id\": \"$TEST_PANEL_ID\"}")
print_result 6 "validate_panel_access_key (Valid Repeat)" "$res6"

# 7. verify_panel_password with p_panel_id=TEST_PANEL_ID, p_password="Test69"
res7=$(run_rpc "verify_panel_password" "{\"p_panel_id\": \"$TEST_PANEL_ID\", \"p_password\": \"Test69\"}")
print_result 7 "verify_panel_password (Correct)" "$res7"

# 8. verify_panel_password with p_panel_id=TEST_PANEL_ID, p_password="wrongpass"
res8=$(run_rpc "verify_panel_password" "{\"p_panel_id\": \"$TEST_PANEL_ID\", \"p_password\": \"wrongpass\"}")
print_result 8 "verify_panel_password (Wrong Password)" "$res8"

# 9. verify_panel_password with p_panel_id=EXCEL_PANEL_ID, p_password="wrongpass"
res9=$(run_rpc "verify_panel_password" "{\"p_panel_id\": \"$EXCEL_PANEL_ID\", \"p_password\": \"wrongpass\"}")
print_result 9 "verify_panel_password (Wrong Panel & Pass)" "$res9"

# 10. admin_list_keys with p_password="stk7890"
res10=$(run_rpc "admin_list_keys" '{"p_password": "stk7890"}')
print_result 10 "admin_list_keys (Global Admin)" "$res10"

# 11. admin_list_keys with p_password="wrongpass"
res11=$(run_rpc "admin_list_keys" '{"p_password": "wrongpass"}')
print_result 11 "admin_list_keys (Wrong Pass)" "$res11"

# 12. panel_admin_list_keys with p_panel_id=TEST_PANEL_ID, p_password="Test69"
res12=$(run_rpc "panel_admin_list_keys" "{\"p_panel_id\": \"$TEST_PANEL_ID\", \"p_password\": \"Test69\"}")
print_result 12 "panel_admin_list_keys (Valid)" "$res12"

# 13. panel_admin_list_keys with p_panel_id=TEST_PANEL_ID, p_password="wrongpass"
res13=$(run_rpc "panel_admin_list_keys" "{\"p_panel_id\": \"$TEST_PANEL_ID\", \"p_password\": \"wrongpass\"}")
print_result 13 "panel_admin_list_keys (Wrong Pass)" "$res13"

# 14. admin_list_keys with no body
res14=$(curl -s -w "\nSTATUS:%{http_code} TIME:%{time_total}s" -X POST "$URL/rest/v1/rpc/admin_list_keys" \
    -H "apikey: $ANON" \
    -H "Authorization: Bearer $ANON" \
    -H "Content-Type: application/json")
print_result 14 "admin_list_keys (No Body)" "$res14"

# 15. SQL injection in password
res15=$(run_rpc "verify_panel_password" "{\"p_panel_id\": \"$TEST_PANEL_ID\", \"p_password\": \"' OR '1'='1\"}")
print_result 15 "SQL Injection Check" "$res15"
