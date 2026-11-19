#!/bin/bash
# QA r2 #344 live Q2 delivery: $1 = config name (cfg-m1|cfg-m1-old), $2 = relay port, $3 = tag
S=/home/ec2-user/.local-operator/sessions/0635fc7e7783/scratchpad/qa344r2
source $S/env-$1.sh
cd /home/ec2-user/local-operator/.worktrees/qa-344-core
QA_TAG=$3 QA_RELAY=http://127.0.0.1:$2 QA_PW_FILE=$S/pw QA_M1_OUT=$S/results/m1-$3.json timeout 170 .venv/bin/python $S/rig/m1_driver2.py
