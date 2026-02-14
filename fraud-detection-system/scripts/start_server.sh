#!/usr/bin/env bash
cd /home/cybernet/upi/fraud-detection-system/backend
source /home/cybernet/upi/venv/bin/activate
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
