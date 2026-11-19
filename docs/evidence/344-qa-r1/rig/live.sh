#!/bin/bash
# Live M1 delivery for capture.mjs's live pass (cfg-m1 relay :4396).
source ~/.local-operator/sessions/2478198d9a62/scratchpad/rig344/env-m1.sh
cd ~/local-operator/.worktrees/qa-344-core
QA_MID=${QA_MID:-bcmsg_livebr$RANDOM} QA_SEQ=${QA_SEQ:-95$((RANDOM%9))} QA_RELAY=http://127.0.0.1:4396 QA_PW_FILE=~/.local-operator/sessions/2478198d9a62/scratchpad/rig344/pw QA_M1_OUT=~/.local-operator/sessions/2478198d9a62/scratchpad/rig344/m1-browser-$(date +%s).json timeout 150 .venv/bin/python ~/.local-operator/sessions/2478198d9a62/scratchpad/rig344/m1_driver.py
