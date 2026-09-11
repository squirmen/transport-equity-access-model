# Common tasks. Set DATA to your data root and PY to a Python with the requirements.
PY ?= python
DATA ?= $(TEAM_DATA_ROOT)
TEAM = PYTHONPATH=src $(PY) -m team --data-root $(DATA)
URL ?= http://localhost:8812/web/?data=../tests/fixtures/web/

.PHONY: test test-py test-web fixture serve snapshots destinations route plan build

test: test-py test-web

test-py:
	PYTHONPATH=src $(PY) -m pytest -q tests

test-web:
	node --test tests/web/*.test.mjs

fixture:
	$(PY) tests/fixtures/make_web_fixture.py

serve:
	$(PY) -m http.server 8812

snapshots:
	$(PY) tests/web/snapshots.py --url "$(URL)" --out build/shots

destinations:
	$(TEAM) destinations

plan:
	$(TEAM) plan

route:
	$(TEAM) route --all

build:
	$(TEAM) build
