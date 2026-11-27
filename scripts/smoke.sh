#!/usr/bin/env bash
# API の通し確認（ローカル: bash scripts/smoke.sh http://localhost:8787）
set -euo pipefail
B=${1:-http://localhost:8787}
E="test$(date +%s)@example.com"
j() { curl -s -X "$1" "$B$2" -H 'Content-Type: application/json' ${T:+-H "Authorization: Bearer $T"} ${3:+-d "$3"}; }
echo "== register";   R=$(j POST /api/auth/register "{\"email\":\"$E\",\"password\":\"password1234\",\"name\":\"テスト 太郎\",\"consent\":\"2026-11-v1\"}"); echo "$R"
T=$(echo "$R" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
MID=$(echo "$R" | python3 -c 'import sys,json;print(json.load(sys.stdin)["member"]["id"])')
echo "== me";         j GET /api/me; echo
echo "== update";     j PUT /api/me '{"name":"テスト 太郎","address":"東京都練馬区","emergency":"花子 090"}'; echo
echo "== cert";       C=$(j POST /api/certificates); echo "$C"
CT=$(echo "$C" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
echo "== verify";     T= j GET "/api/verify/$CT"; echo
echo "== verify bad"; T= j GET "/api/verify/xxxx"; echo
echo "== request";    Q=$(j POST /api/requests '{"catalog_id":6,"note":"通院同行希望","preferred_at":"12/3 午前"}'); echo "$Q"
RID=$(echo "$Q" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
echo "== pet";        j POST /api/pets '{"name":"Buddy","species":"犬","care":"朝夕2回","caretaker":"花子","caretaker_consent":true}'; echo
j GET /api/pets; echo
echo "== wishes";     j PUT /api/wishes '{"medical":"延命は希望しない","funeral":"家族葬"}'; j GET /api/wishes; echo
echo "== contracts";  j POST /api/contracts '{"provider":"A社","category":"死後事務"}' >/dev/null; j POST /api/contracts '{"provider":"B社","category":"死後事務"}' >/dev/null; j GET /api/contracts; echo
echo "== donate";     j POST /api/donations '{"amount":300,"frequency":"once"}'; echo
echo "== staff denied"; j GET /api/staff/summary; echo
echo "MEMBER=$MID REQ=$RID TOKEN=$T"
