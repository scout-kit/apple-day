# Apple Day — task runner.
#
# The npm scripts stay the source of truth for what each command *is*; this file is for
# the things npm scripts are bad at: checking prerequisites, and orchestrating the two
# long-running processes (Firestore emulator + Vite) that the app needs at once.
#
#   make up        start everything and open the app
#   make check     everything CI would run
#   make help      list every target

SHELL := /bin/bash
.DEFAULT_GOAL := help

NPM      := npm
FIREBASE := npx firebase
PY       := python3

FIRESTORE_PORT := 8080
AUTH_PORT      := 9099
UI_PORT        := 4000
VITE_PORT      := 5173

EMU_PID  := .emulator.pid
EMU_LOG  := .emulator.log

# True when something is listening on $(1).
listening = $$(lsof -ti:$(1) 2>/dev/null | head -1)

# True when that something is actually a Firestore emulator, which answers "Ok" at its
# root over plain HTTP. Holding the port is not the same as being the thing we want: 8080
# is a popular port, and pointing the rules suite at a stranger produces errors that say
# nothing about the real problem — "client sent an HTTP request to an HTTPS server" being
# the memorable one.
firestore_on = $$(curl -fsS -m 2 http://127.0.0.1:$(1)/ 2>/dev/null | head -c 2)

.PHONY: help doctor install admin seed emulators emulators-start emulators-stop \
        dev up down logs test watch test-rules typecheck build preview check \
        firstrun firstrun-admin firstrun-down bootstrap-admin \
        deploy deploy-one deploy-all deploy-rules verify clean clean-all

# ---------------------------------------------------------------------- meta

help: ## List available targets
	@echo "Apple Day"
	@echo
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "First run:  make up"

doctor: ## Check that the local prerequisites are present
	@ok=1; \
	if command -v node >/dev/null; then \
	  if node -e "const[a,b]=process.versions.node.split('.').map(Number);process.exit(((a===20&&b>=19)||(a===22&&b>=13)||a>=24)?0:1)"; then \
	    echo "  node      $$(node -v)"; \
	  else \
	    echo "  node      $$(node -v)  UNSUPPORTED"; \
	    echo "            This project needs $$(node -p "require('./package.json').engines.node" 2>/dev/null || echo '^20.19 || ^22.13 || >=24')."; \
	    echo "            An unsupported one does not fail on install — it fails much later,"; \
	    echo "            as two dozen storage tests with nothing pointing at Node."; \
	    echo "            'nvm use' picks the version in .nvmrc."; \
	    ok=0; \
	  fi; \
	else echo "  node      MISSING — see .nvmrc"; ok=0; fi; \
	if command -v java >/dev/null; then \
	  echo "  java      $$(java -version 2>&1 | head -1 | sed 's/.*version //;s/\"//g')  (Firestore emulator)"; \
	else echo "  java      MISSING — the Firestore emulator will not start without a JDK 11+"; ok=0; fi; \
	[ $$ok -eq 1 ] || { echo; echo "Fix the items above first."; exit 1; }

# ------------------------------------------------------------------- install

# A stamp file, so this only reruns when the lockfile actually changes.
node_modules: package-lock.json
	# `ci`, not `install`. `npm install` is free to resolve something newer than the
	# lockfile and rewrite it, which is how two machines end up on different versions of
	# the same dependency from the same checkout — and how a test suite starts passing in
	# one place and failing in another for reasons nothing in git can explain.
	@$(NPM) ci --no-audit --no-fund
	@touch node_modules

install: node_modules ## Install dependencies (only if the lockfile changed)

# ---------------------------------------------------------------------- data

admin: ## Let yourself in as an admin: prints an invitation link, or promotes an account already in
	@if [ -z "$(call listening,$(FIRESTORE_PORT))" ]; then \
	  echo "The emulator is not running. Start it with 'make up'."; \
	  exit 1; \
	fi
	@ADMIN_ONLY=1 ADMIN_EMAIL="$(EMAIL)" APP_ORIGIN=http://localhost:$(VITE_PORT) node scripts/seed.mjs

bootstrap-admin: ## Print an invitation to create by hand, for the first admin or a lockout (ORIGIN=..., TIER=organizer)
	@node scripts/bootstrap-admin.mjs

organizer: ## The same, one tier down: runs the event but not the setup screens
	@if [ -z "$(call listening,$(FIRESTORE_PORT))" ]; then \
	  echo "The emulator is not running. Start it with 'make up'."; \
	  exit 1; \
	fi
	@ROLE=organizer ADMIN_ONLY=1 ADMIN_EMAIL="$(EMAIL)" APP_ORIGIN=http://localhost:$(VITE_PORT) \
	  node scripts/seed.mjs

seed: ## Load data/locations.seed.json into a running emulator
	@if [ -z "$(call listening,$(FIRESTORE_PORT))" ]; then \
	  echo "The Firestore emulator is not running. Start it with 'make emulators-start'"; \
	  echo "or just use 'make up', which does everything."; \
	  exit 1; \
	fi
	@node scripts/seed.mjs

# ----------------------------------------------------------------- processes

# Only auth + firestore: Vite serves the app, so the hosting emulator is not needed
# for development (and its default port 5000 is taken by ControlCenter on macOS).
emulators: install ## Run the emulators in the foreground (Ctrl-C to stop)
	@mkdir -p seed
	@$(FIREBASE) emulators:start --only auth,firestore --import ./seed --export-on-exit

emulators-start: install ## Start the emulators in the background
	@set -e; \
	if [ -n "$(call listening,$(FIRESTORE_PORT))" ]; then \
	  echo "Emulators already running on port $(FIRESTORE_PORT)."; \
	  echo "Waiting for Auth on $(AUTH_PORT) as well."; \
	  for i in $$(seq 1 30); do \
	    [ -n "$(call listening,$(AUTH_PORT))" ] && break; \
	    sleep 1; \
	  done; \
	  exit 0; \
	fi; \
	mkdir -p seed; \
	echo "Starting emulators (log: $(EMU_LOG))…"; \
	nohup $(FIREBASE) emulators:start --only auth,firestore --import ./seed --export-on-exit \
	  > $(EMU_LOG) 2>&1 & \
	echo $$! > $(EMU_PID); \
	for i in $$(seq 1 60); do \
	  if [ -n "$(call listening,$(FIRESTORE_PORT))" ] && \
	     [ -n "$(call listening,$(AUTH_PORT))" ]; then \
	    echo "  Firestore    127.0.0.1:$(FIRESTORE_PORT)"; \
	    echo "  Auth         127.0.0.1:$(AUTH_PORT)"; \
	    echo "  Emulator UI  http://127.0.0.1:$(UI_PORT)"; \
	    exit 0; \
	  fi; \
	  sleep 1; \
	done; \
	echo "Emulators did not come up within 60s. Last lines of $(EMU_LOG):"; \
	tail -20 $(EMU_LOG); \
	exit 1

emulators-stop: ## Stop the background emulators (waits for the data export)
	@set -e; \
	if [ -z "$(call listening,$(FIRESTORE_PORT))" ] && [ ! -f $(EMU_PID) ]; then \
	  echo "Emulators are not running."; \
	  exit 0; \
	fi; \
	if [ -f $(EMU_PID) ]; then kill $$(cat $(EMU_PID)) 2>/dev/null || true; \
	else pkill -f "firebase emulators" 2>/dev/null || true; fi; \
	printf "Stopping emulators"; \
	for i in $$(seq 1 30); do \
	  if [ -z "$(call listening,$(FIRESTORE_PORT))" ]; then break; fi; \
	  printf "."; sleep 1; \
	done; \
	echo; \
	if [ -n "$(call listening,$(FIRESTORE_PORT))" ]; then \
	  echo "Still up after 30s — forcing."; \
	  pkill -9 -f "firebase emulators" 2>/dev/null || true; \
	  pkill -9 -f "cloud-firestore-emulator" 2>/dev/null || true; \
	fi; \
	rm -f $(EMU_PID); \
	if [ -n "$$(ls -A seed 2>/dev/null)" ]; then \
	  echo "Emulators stopped. Data exported to ./seed and will reload next start."; \
	else \
	  echo "Emulators stopped. No data snapshot was written."; \
	fi

# ------------------------------------------------------------------ first run
#
# What a brand-new deployment looks like, with no way to touch the data you have.
#
# A whole second emulator, on its own ports, rather than another project id inside the one
# you work in. Firestore keeps projects apart, but Auth does not: every request reaches it
# without a project in the path, and it answers them all from one set of accounts. So
# signing in against a "sandbox project" in the same emulator creates the account in the
# real one — which is a fine way to write test users into the data you care about.
#
# Nothing is imported and nothing is exported, so this starts empty every time and leaves
# nothing behind.

FIRSTRUN_PROJECT   := apple-day-firstrun
FIRSTRUN_PORT      := 5174
FIRSTRUN_FIRESTORE := 8081
FIRSTRUN_AUTH      := 9098
FIRSTRUN_UI        := 4001
FIRSTRUN_PID       := .firstrun.pid
FIRSTRUN_LOG       := .firstrun.log

DEV_PROJECT := apple-day-local

firstrun: install ## Start an empty emulator and app, to see the first-run experience
	@if [ -n "$(call listening,$(FIRSTRUN_FIRESTORE))" ]; then \
	  echo "Something is already on $(FIRSTRUN_FIRESTORE). 'make firstrun-down' first."; exit 1; \
	fi
	@echo "Starting a separate, empty emulator — your own is untouched on $(FIRESTORE_PORT)."
	@npx firebase emulators:start --config firebase.firstrun.json \
	  --project $(FIRSTRUN_PROJECT) --only auth,firestore > $(FIRSTRUN_LOG) 2>&1 & \
	  echo $$! > $(FIRSTRUN_PID)
	@for i in $$(seq 1 40); do \
	  [ -n "$(call listening,$(FIRSTRUN_FIRESTORE))" ] && break; sleep 0.5; \
	done
	@if [ -z "$(call listening,$(FIRSTRUN_FIRESTORE))" ]; then \
	  echo "The sandbox emulator did not start. See $(FIRSTRUN_LOG)."; exit 1; \
	fi
	@echo
	@echo "Empty project:  $(FIRSTRUN_PROJECT)   (its own emulator, ports $(FIRSTRUN_FIRESTORE)/$(FIRSTRUN_AUTH))"
	@echo "App:            http://localhost:$(FIRSTRUN_PORT)"
	@echo
	@echo "Open the port above, not $(VITE_PORT) — that one is your own data."
	@echo
	@echo "There is nobody on the roster yet, so start with an invitation — in another"
	@echo "terminal, before you sign in:"
	@echo "    make firstrun-admin"
	@echo
	@echo "Signing in without one is refused, and the account it made is deleted again."
	@echo
	@echo "Ctrl-C stops the app; 'make firstrun-down' stops the sandbox emulator."
	@echo
	@VITE_USE_EMULATOR=1 \
	  VITE_EMULATOR_PROJECT=$(FIRSTRUN_PROJECT) \
	  VITE_EMULATOR_FIRESTORE_PORT=$(FIRSTRUN_FIRESTORE) \
	  VITE_EMULATOR_AUTH_PORT=$(FIRSTRUN_AUTH) \
	  $(NPM) run dev -- --port $(FIRSTRUN_PORT)

firstrun-admin: ## Print an invitation for the sandbox, or promote an account already in it
	@if [ -z "$(call listening,$(FIRSTRUN_FIRESTORE))" ]; then \
	  echo "The sandbox is not running. Start it with 'make firstrun'."; exit 1; \
	fi
	@ADMIN_ONLY=1 ADMIN_EMAIL="$(EMAIL)" APP_ORIGIN=http://localhost:$(FIRSTRUN_PORT) \
	  GCLOUD_PROJECT=$(FIRSTRUN_PROJECT) \
	  FIRESTORE_EMULATOR_HOST=127.0.0.1:$(FIRSTRUN_FIRESTORE) \
	  FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:$(FIRSTRUN_AUTH) node scripts/seed.mjs

firstrun-down: ## Stop the sandbox emulator
	@if [ -f $(FIRSTRUN_PID) ]; then kill $$(cat $(FIRSTRUN_PID)) 2>/dev/null || true; rm -f $(FIRSTRUN_PID); fi
	@pid=$$(lsof -ti:$(FIRSTRUN_FIRESTORE) 2>/dev/null | head -1); [ -n "$$pid" ] && kill $$pid 2>/dev/null || true
	@echo "Sandbox stopped. Nothing it held is kept."

dev: install ## Run the Vite dev server against the emulator (Ctrl-C to stop)
	@if [ -z "$(call listening,$(FIRESTORE_PORT))" ]; then \
	  echo "Note: the emulator is not running, so the app will have no data."; \
	  echo "      'make up' starts both."; echo; \
	fi
	@$(NPM) run dev

up: install ## Start the emulator, seed it, and run the app
	@$(MAKE) --no-print-directory emulators-start
	@if [ -f "data/locations.seed.json" ]; then \
	  node scripts/seed.mjs; \
	else \
	  echo "No seed data — starting with an empty database."; \
	  echo "Add locations on the Locations screen, or see 'make seed' for loading a file."; \
	fi
	@echo
	@echo "App:         http://localhost:$(VITE_PORT)"
	@echo "Emulator UI: http://127.0.0.1:$(UI_PORT)"
	@echo
	@echo "Sign in as an organizer, then run 'make seed' once more — it grants"
	@echo "organizer rights to the accounts that exist in the Auth emulator, and"
	@echo "your uid does not exist until you have signed in."
	@echo
	@VITE_USE_EMULATOR=1 $(NPM) run dev

down: emulators-stop ## Stop everything started by 'make up'
	@pkill -f "vite" 2>/dev/null || true
	@echo "Dev server stopped."

logs: ## Tail the background emulator log
	@tail -f $(EMU_LOG)

# -------------------------------------------------------------------- checks

typecheck: install ## Typecheck without emitting
	@$(NPM) run typecheck

test: install ## Domain and render tests (no emulator needed)
	@$(NPM) test

watch: install ## Tests in watch mode
	@$(NPM) run test:watch

test-rules: install ## Security-rules tests (reuses a running emulator, or starts one)
	@set -e; \
	if [ "$(call firestore_on,$(FIRESTORE_PORT))" = "Ok" ]; then \
	  echo "Reusing the Firestore emulator already on port $(FIRESTORE_PORT)."; \
	  echo "The suite runs in its own project, so your dev data is untouched."; \
	  FIRESTORE_EMULATOR_HOST=127.0.0.1:$(FIRESTORE_PORT) \
	    npx vitest run --config vitest.rules.config.ts; \
	elif [ -n "$(call listening,$(FIRESTORE_PORT))" ]; then \
	  echo "Port $(FIRESTORE_PORT) is taken, but not by a Firestore emulator."; \
	  echo; \
	  lsof -i:$(FIRESTORE_PORT) 2>/dev/null | head -3; \
	  echo; \
	  echo "Running the rules against it would test somebody else's server. Stop it, or"; \
	  echo "set FIRESTORE_PORT to a free port and try again."; \
	  exit 1; \
	else \
	  $(NPM) run test:rules; \
	fi

build: install ## Production build
	@$(NPM) run build

preview: build ## Serve the production build locally
	@$(NPM) run preview

check: typecheck test test-rules build ## Everything CI would run
	@echo
	@echo "All checks passed."

# -------------------------------------------------------------------- deploy

# --------------------------------------------------------------------- deploy
#
# Every deploy names a group, and there is no unscoped path to one.
#
# The Firebase config is inlined into the bundle by Vite at build time, so a build belongs
# to exactly one project. Deploying an existing `dist/` to a second project would put that
# group's site in front of the first group's Firestore — and it would look entirely normal
# doing it: the page loads, sign-in works, and the data is somebody else's. So the build and
# the deploy take the same name, from the same command, and neither can be run without it.

GROUP ?=

define need_group
	@if [ ! -f ".firebaserc" ]; then \
	  echo "No .firebaserc. It names the Firebase projects to deploy to and is not"; \
	  echo "committed, because those are one installation's, not the app's."; \
	  echo "Copy .firebaserc.example to .firebaserc and fill in your project ids."; \
	  exit 1; \
	fi
	@if [ -z "$(GROUP)" ]; then \
	  echo "Name a group: make $(1) GROUP=<alias>"; \
	  echo "Aliases in .firebaserc:"; \
	  node -e "const p=JSON.parse(require('fs').readFileSync('.firebaserc','utf8')).projects; for (const k of Object.keys(p)) if (k!=='default') console.log('  '+k+'  ->  '+p[k])"; \
	  exit 1; \
	fi
	@node -e "const p=JSON.parse(require('fs').readFileSync('.firebaserc','utf8')).projects; if(!p['$(GROUP)']){console.error('No alias \'$(GROUP)\' in .firebaserc.');process.exit(1)}"
	@if [ ! -f ".env.$(GROUP)" ]; then \
	  echo "Missing .env.$(GROUP) — the build would use whatever config it found instead,"; \
	  echo "and point this group's site at another group's data. See .env.example."; \
	  exit 1; \
	fi
endef

deploy-rules: install ## Deploy only the Firestore rules and indexes (GROUP=<alias>)
	$(call need_group,deploy-rules)
	@$(MAKE) --no-print-directory verify
	@npx firebase deploy --project "$(GROUP)" --only firestore:rules,firestore:indexes

# The gates, without the build — `deploy` does its own, for the group being deployed.
verify: typecheck test test-rules ## Everything CI would run, short of building

# Guard, build, ship. Split out so `deploy-all` can verify once and then loop over this.
deploy-one:
	$(call need_group,deploy-one)
	@echo "Building $(GROUP) from .env.$(GROUP)…"
	@node scripts/check-env.mjs "$(GROUP)"
	@npx vite build --mode "$(GROUP)"
	@npx firebase deploy --project "$(GROUP)" --only hosting,firestore:rules,firestore:indexes
	@echo "Deployed $(GROUP)."

deploy: ## Build and deploy hosting + rules for one group (GROUP=<alias>)
	$(call need_group,deploy)
	@$(MAKE) --no-print-directory verify
	@$(MAKE) --no-print-directory deploy-one GROUP=$(GROUP)

deploy-all: ## Deploy every alias in .firebaserc, one at a time
	@$(MAKE) --no-print-directory verify
	@set -e; \
	for g in $$(node -e "const p=JSON.parse(require('fs').readFileSync('.firebaserc','utf8')).projects; console.log(Object.keys(p).filter(k=>k!=='default').join(' '))"); do \
	  echo "=== $$g ==="; \
	  $(MAKE) --no-print-directory deploy-one GROUP=$$g; \
	done

clean: ## Remove build output and local logs
	@rm -rf dist .emulator.log *.tsbuildinfo firebase-debug.log firestore-debug.log ui-debug.log
	@echo "Cleaned build output."

clean-all: clean ## Also remove node_modules and the emulator data snapshot
	@rm -rf node_modules seed
	@echo "Removed node_modules and the emulator snapshot (./seed)."
